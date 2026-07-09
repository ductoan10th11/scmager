import { http } from '@/shared/api/http'

const ACTIVE_STATUSES = new Set([
  'TODO',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'REVISION_REQUESTED',
  'DONE',
])

const statusStyle = {
  TODO: 'bg-blue-50 border-blue-200 text-blue-800',
  IN_PROGRESS: 'bg-amber-50 border-amber-200 text-amber-900',
  PENDING_REVIEW: 'bg-violet-50 border-violet-200 text-violet-900',
  REVISION_REQUESTED: 'bg-orange-50 border-orange-200 text-orange-900',
  DONE: 'bg-emerald-50 border-emerald-200 text-emerald-900',
}

const pad = (value) => String(value).padStart(2, '0')
const toDateStr = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const toHourFloat = (date) => date.getHours() + date.getMinutes() / 60
const toTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

const validDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const segmentToEvent = (task, segment, segmentIndex) => {
  const scheduledStart = validDate(segment?.startAt)
  const scheduledEnd = validDate(segment?.endAt)
  const deadline = validDate(task.dueAt)
  const isDeadlineOnly = !scheduledStart
  const start = scheduledStart || deadline
  if (!start) return null

  // A date-only deadline is shown at 09:00 as a deadline marker, not a work schedule.
  if (isDeadlineOnly && start.getHours() === 0 && start.getMinutes() === 0) {
    start.setHours(9, 0, 0, 0)
  }

  const estimatedHours = Math.max(Number(task.estimatedMinutes || 60) / 60, 0.25)
  const scheduledHours = scheduledEnd
    ? (scheduledEnd.getTime() - start.getTime()) / 3600000
    : estimatedHours
  const duration = Math.min(Math.max(scheduledHours, 0.25), 8)
  const end = new Date(start.getTime() + duration * 3600000)

  return {
    _id: task._id,
    id: `${task._id}-${segmentIndex}`,
    title: task.title,
    dateStr: toDateStr(start),
    startHour: toHourFloat(start),
    duration,
    type: task.type === 'INVITATION' ? 'Họp' : isDeadlineOnly ? 'Deadline' : 'Nhiệm vụ',
    timeStr: isDeadlineOnly ? `Hạn ${toTime(start)}` : `${toTime(start)} - ${toTime(end)}`,
    time: isDeadlineOnly ? `Hạn ${toTime(start)}` : `${toTime(start)} - ${toTime(end)}`,
    colorClass: statusStyle[task.status] || 'bg-white border-zinc-200 text-zinc-800',
    assignee: task.assignedTo || {},
    avatars: [],
    remainingCount: 0,
    isDeadlineOnly,
    segmentIndex,
    task,
  }
}

const taskToEvents = (task) => {
  const segments = Array.isArray(task.scheduleSegments) && task.scheduleSegments.length
    ? task.scheduleSegments
    : task.scheduledStartAt && task.scheduledEndAt
      ? [{ startAt: task.scheduledStartAt, endAt: task.scheduledEndAt }]
      : [null]
  return segments.map((segment, index) => segmentToEvent(task, segment, index)).filter(Boolean)
}

export const ScheduleService = {
  async listEvents() {
    const response = await http('/api/tasks?limit=200&assignedToMe=true')
    return (response?.data ?? [])
      .filter((task) => ACTIVE_STATUSES.has(task.status))
      .flatMap(taskToEvents)
  },

  async createEvent(event) {
    const [startText, endText] = event.time.split(' - ')
    const startAt = new Date(`${event.dateStr}T${startText}:00`)
    const endAt = new Date(`${event.dateStr}T${endText}:00`)
    const response = await http('/api/tasks', {
      method: 'POST',
      body: {
        title: event.title,
        type: 'INVITATION',
        scheduledStartAt: startAt.toISOString(),
        scheduledEndAt: endAt.toISOString(),
        estimatedMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60000),
      },
    })
    return taskToEvents(response.data)[0]
  },
}
