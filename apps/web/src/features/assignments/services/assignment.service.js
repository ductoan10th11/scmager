import { http } from '@/shared/api/http'

const ACTIVE_STATUSES = new Set(['DRAFT', 'TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'REVISION_REQUESTED', 'APPROVED'])

const DECLARATION_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_REVIEW',
  RETURNED: 'REVISION_REQUESTED',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
}

const declarationToTask = (declaration) => ({
  _id: declaration._id,
  title: declaration.title,
  description: declaration.description,
  type: 'WORK_DECLARATION',
  status: DECLARATION_STATUS[declaration.status] ?? declaration.status,
  dueAt: declaration.workEndAt,
  createdAt: declaration.createdAt,
  assignedAt: declaration.workStartAt,
  scheduledStartAt: declaration.workStartAt,
  scheduledEndAt: declaration.workEndAt,
  estimatedMinutes: declaration.durationMinutes,
  assignedTo: declaration.createdBy,
  declaredPoint: declaration.declaredPoint,
  approval: declaration.approval,
  department: declaration.department,
  createdBy: declaration.createdBy,
  sourceDocument: declaration.sourceDocument,
  rawStatus: declaration.status,
  editable: declaration.status !== 'CANCELLED',
})

const taskTypeForStatus = (status, userTotalHours) => {
  if (status === 'PENDING_REVIEW') return 'safe-light'
  if (status === 'REVISION_REQUESTED') return 'busy'
  if (userTotalHours > 8) return 'overload'
  if (userTotalHours > 6) return 'busy'
  return 'safe'
}

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60000)

const vietnamParts = (value) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
)

const vietnamDateKey = (value) => {
  const parts = vietnamParts(value)
  return `${parts.year}-${parts.month}-${parts.day}`
}

const vietnamTime = (value) => {
  const parts = vietnamParts(value)
  return `${parts.hour}:${parts.minute}`
}

const sameLocalDate = (left, right) => vietnamDateKey(left) === vietnamDateKey(right)

const taskTimeRange = (task, segment, index) => {
  const startSource = segment?.startAt || task.scheduledStartAt || task.assignedAt || task.createdAt
  const start = startSource ? new Date(startSource) : new Date()
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start
  const fallbackOffset = index * 60
  const normalizedStart = segment?.startAt || task.scheduledStartAt
    ? safeStart
    : addMinutes(new Date(new Date().setHours(8, 0, 0, 0)), fallbackOffset)
  const minutes = Math.max(Number(task.estimatedMinutes ?? 60), 15)
  const end = segment?.endAt
    ? new Date(segment.endAt)
    : task.scheduledEndAt
      ? new Date(task.scheduledEndAt)
    : addMinutes(normalizedStart, minutes)

  return {
    start: vietnamTime(normalizedStart),
    end: vietnamTime(end),
    scheduledStartAt: normalizedStart.toISOString(),
    scheduledEndAt: end.toISOString(),
  }
}

// Map API user + their tasks to the shape AssignmentFeature expects
const toAssignee = (user, tasks = [], timelineDate = new Date()) => {
  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status))
  const taskBlocks = activeTasks.flatMap((task, taskIndex) => {
    const sourceSegments = Array.isArray(task.scheduleSegments) && task.scheduleSegments.length
      ? task.scheduleSegments
      : task.scheduledStartAt && task.scheduledEndAt
        ? [{ startAt: task.scheduledStartAt, endAt: task.scheduledEndAt }]
        : [null]
    return sourceSegments
      .map((segment, segmentIndex) => {
        const range = taskTimeRange(task, segment, taskIndex)
        const segmentDate = new Date(range.scheduledStartAt)
        if (!sameLocalDate(segmentDate, timelineDate)) return null
        return {
          id: task._id,
          blockId: `${task._id}-${segmentIndex}`,
          ...range,
          name: task.title,
          type: taskTypeForStatus(task.status, 0),
          taskType: task.type,
          status: task.status,
          rawStatus: task.rawStatus,
          dueAt: task.dueAt,
          description: task.description,
          declaredPoint: task.declaredPoint,
          approval: task.approval,
          department: task.department,
          createdBy: task.createdBy,
          createdAt: task.createdAt,
          sourceDocument: task.sourceDocument,
          estimatedMinutes: task.estimatedMinutes ?? 60,
          segmentIndex,
          scheduleSegments: sourceSegments,
          editable: Boolean(task.editable),
        }
      })
      .filter(Boolean)
  })
  const totalHours = taskBlocks.reduce((sum, task) => {
    const start = new Date(task.scheduledStartAt)
    const end = new Date(task.scheduledEndAt)
    return sum + Math.max(end.getTime() - start.getTime(), 0) / 3600000
  }, 0)
  const totalHoursFixed = Math.round(totalHours * 10) / 10
  taskBlocks.forEach((task) => {
    task.type = taskTypeForStatus(task.status, totalHoursFixed)
  })

  return {
    id: user._id,
    name: user.fullName,
    role: user.position || user.role?.name || user.role?.code || 'Nhân sự',
    roleCode: user.role?.code ?? null,
    roleLevel: Number(user.role?.level ?? 99),
    avatar: null, // ponytail: no avatar field in current user model
    status: totalHoursFixed <= 6 ? 'free' : totalHoursFixed <= 8 ? 'busy' : 'overload',
    totalHours: totalHoursFixed,
    tasks: taskBlocks,
  }
}

export const AssignmentService = {
  async streamAiChat(payload, onEvent, signal) {
    const response = await fetch('/api/assignment-ai/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      signal,
    })
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error?.message || 'Không thể kết nối trợ lý AI.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const consume = (block) => {
      if (!block.trim()) return
      let event = 'message'
      const dataLines = []
      block.split(/\r?\n/).forEach((line) => {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      })
      if (!dataLines.length) return
      const data = JSON.parse(dataLines.join('\n'))
      onEvent(event, data)
    }

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = done ? '' : blocks.pop() ?? ''
      blocks.forEach(consume)
      if (done) {
        consume(buffer)
        break
      }
    }
  },

  // Returns reactive-ready array (called on mount)
  async listAssignees(departmentId = null, timelineDate = new Date()) {
    try {
      const params = new URLSearchParams()
      if (departmentId) params.set('departmentId', departmentId)

      const [usersRes, declarationsRes] = await Promise.all([
        http(`/api/work-declarations/participants?${params}`),
        http('/api/work-declarations?limit=100'),
      ])

      const userList = usersRes?.data ?? []
      const taskList = (declarationsRes?.data ?? []).map(declarationToTask)

      return userList.map((user) => {
        const userTasks = taskList.filter(
          (t) => String(t.assignedTo?._id ?? t.assignedTo) === String(user._id)
        )
        return toAssignee(user, userTasks, timelineDate)
      }).sort((left, right) => (
        left.roleLevel - right.roleLevel
        || left.name.localeCompare(right.name, 'vi')
      ))
    } catch {
      return []
    }
  },

  // Create task via API
  async createTask(payload) {
    const { submit, approverId, ...body } = payload
    const result = await http('/api/work-declarations', { method: 'POST', body })
    if (submit) {
      await http(`/api/work-declarations/${result.data._id}/submit`, {
        method: 'POST',
        body: { approverId },
      })
    }
    return result
  },

  async listPendingApprovals() {
    return http('/api/work-declarations?pendingForMe=true&status=PENDING_APPROVAL&limit=100')
  },

  async listApprovals(tab) {
    if (tab === 'approved') {
      return http('/api/work-declarations?status=APPROVED&approvalActionByMe=APPROVED&limit=100')
    }
    if (tab === 'returned') {
      return http('/api/work-declarations?status=RETURNED&approvalActionByMe=RETURNED&limit=100')
    }
    return this.listPendingApprovals()
  },

  async approveTask(taskId, payload) {
    return http(`/api/work-declarations/${taskId}/approve`, {
      method: 'POST',
      body: payload,
    })
  },

  async updateTaskTime(taskId, payload) {
    const segment = payload.scheduleSegments?.[0]
    const workStartAt = segment?.startAt ?? payload.scheduledStartAt
    const workEndAt = segment?.endAt
      ?? payload.scheduledEndAt
      ?? new Date(new Date(workStartAt).getTime() + Number(payload.estimatedMinutes) * 60_000).toISOString()
    return http(`/api/work-declarations/${taskId}/schedule`, {
      method: 'PATCH',
      body: { workStartAt, workEndAt },
    })
  },

}
