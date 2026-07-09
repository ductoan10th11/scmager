import { http } from '@/shared/api/http'

const ACTIVE_STATUSES = new Set(['DRAFT', 'TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'REVISION_REQUESTED'])

const taskTypeForStatus = (status, userTotalHours) => {
  if (status === 'PENDING_REVIEW') return 'safe-light'
  if (status === 'REVISION_REQUESTED') return 'busy'
  if (userTotalHours > 8) return 'overload'
  if (userTotalHours > 6) return 'busy'
  return 'safe'
}

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60000)

const sameLocalDate = (left, right) => (
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate()
)

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
    start: normalizedStart.toTimeString().slice(0, 5),
    end: end.toTimeString().slice(0, 5),
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
          dueAt: task.dueAt,
          estimatedMinutes: task.estimatedMinutes ?? 60,
          segmentIndex,
          scheduleSegments: sourceSegments,
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
    role: user.role?.name ?? user.role?.code ?? 'Chuyên viên',
    avatar: null, // ponytail: no avatar field in current user model
    status: totalHoursFixed <= 6 ? 'free' : totalHoursFixed <= 8 ? 'busy' : 'overload',
    totalHours: totalHoursFixed,
    tasks: taskBlocks,
  }
}

export const AssignmentService = {
  // Returns reactive-ready array (called on mount)
  async listAssignees(departmentId = null, timelineDate = new Date()) {
    try {
      const params = new URLSearchParams({ limit: 100, role: 'SPECIALIST' })
      if (departmentId) params.set('departmentId', departmentId)

      const [usersRes, tasksRes] = await Promise.all([
        http(`/api/users?${params}`),
        http(`/api/tasks?limit=200`),
      ])

      const userList = usersRes?.data ?? []
      const taskList = tasksRes?.data ?? []

      return userList.map((user) => {
        const userTasks = taskList.filter(
          (t) => String(t.assignedTo?._id ?? t.assignedTo) === String(user._id)
        )
        return toAssignee(user, userTasks, timelineDate)
      })
    } catch {
      return []
    }
  },

  // Create task via API
  async createTask(payload) {
    return http('/api/tasks', { method: 'POST', body: payload })
  },

  async updateTaskTime(taskId, payload) {
    return http(`/api/tasks/${taskId}`, { method: 'PATCH', body: payload })
  },

  async createMeeting(payload) {
    return http('/api/tasks/meetings', { method: 'POST', body: payload })
  },
}
