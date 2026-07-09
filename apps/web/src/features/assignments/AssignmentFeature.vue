<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarDate } from '@internationalized/date'
import { AssignmentService } from '@/features/assignments/services/assignment.service'
import { Users, UserCheck, UserMinus, UserX, ChevronLeft, ChevronRight, Filter, Sparkles, Calendar as CalendarIcon, CalendarPlus, X, Plus, Paperclip, Mic, Send, Bot, CheckCircle, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/composables/useAuth'

const resources = ref([])
const { user: currentUser } = useAuth()
const timelineDate = ref(new Date())
const timelineScrollContainer = ref(null)

const calendarDateVal = computed({
  get: () => {
    const d = timelineDate.value
    return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
  },
  set: (val) => {
    if (val) {
      timelineDate.value = new Date(val.year, val.month - 1, val.day)
      refreshResources()
    }
  }
})

const idOf = (value) => value?._id ?? value ?? null
const departmentId = computed(() => idOf(currentUser.value?.department))
const timelineDateLabel = computed(() => {
  const today = new Date()
  if (timelineDate.value.toDateString() === today.toDateString()) return 'Hôm nay'
  return timelineDate.value.toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
})

const refreshResources = async () => {
  resources.value = await AssignmentService.listAssignees(departmentId.value, timelineDate.value)
  scrollToTimeStick()
}

const scrollToTimeStick = () => {
  nextTick(() => {
    const container = timelineScrollContainer.value
    if (!container) return

    const scrollWidth = container.scrollWidth
    const clientWidth = container.clientWidth
    const maxScroll = scrollWidth - clientWidth
    if (maxScroll <= 0) return

    const today = new Date()
    const date = new Date(timelineDate.value)
    const isToday = date.getDate() === today.getDate() &&
                    date.getMonth() === today.getMonth() &&
                    date.getFullYear() === today.getFullYear()

    if (!isToday) {
      container.scrollTo({ left: 0, behavior: 'smooth' })
      return
    }

    const h = today.getHours()
    const m = today.getMinutes()
    const currentMins = (h - startHour.value) * 60 + m

    if (currentMins < 0) {
      container.scrollTo({ left: 0, behavior: 'smooth' })
    } else if (currentMins > TOTAL_MINS.value) {
      container.scrollTo({ left: maxScroll, behavior: 'smooth' })
    } else {
      const percent = currentMins / TOTAL_MINS.value
      const target = scrollWidth * percent - clientWidth / 2
      container.scrollTo({
        left: Math.max(0, Math.min(target, maxScroll)),
        behavior: 'smooth'
      })
    }
  })
}

// --- RIGHT-CLICK DRAG-TO-SCROLL (Kéo cuộn ngang bằng chuột phải) ---
const handleMouseDown = (e) => {
  if (e.button !== 2) return
  e.preventDefault()

  const container = timelineScrollContainer.value
  if (!container) return

  const startX = e.pageX
  const startScrollLeft = container.scrollLeft

  const handleMouseMove = (moveEvent) => {
    const dx = moveEvent.pageX - startX
    container.scrollLeft = startScrollLeft - dx
  }

  const handleMouseUp = (upEvent) => {
    if (upEvent.button === 2) {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

const changeTimelineDay = async (days) => {
  const next = new Date(timelineDate.value)
  next.setDate(next.getDate() + days)
  timelineDate.value = next
  await refreshResources()
}

onMounted(async () => {
  await refreshResources()
})

// --- DERIVED STATS (tính từ dữ liệu thật thay vì hard-code) ---
const stats = computed(() => {
  const list = resources.value
  const total = list.length
  const free = list.filter(r => r.status === 'free').length
  const busy = list.filter(r => r.status === 'busy').length
  const overload = list.filter(r => r.status === 'overload').length
  const hoursUsed = Number(list.reduce((sum, r) => sum + r.totalHours, 0).toFixed(1))
  const hoursTotal = total * 8
  const hoursPct = hoursTotal ? Math.round((hoursUsed / hoursTotal) * 100) : 0
  return { total, free, busy, overload, hoursUsed, hoursTotal, hoursPct }
})

// --- STATISTICS COUNT-UP ANIMATION LOGIC ---
const displayTotal = ref(0)
const displayFree = ref(0)
const displayBusy = ref(0)
const displayOverload = ref(0)
const displayHoursUsed = ref(0)
const displayHoursTotal = ref(0)
const displayHoursPct = ref(0)

const getDisplayVal = (key) => {
  if (key === 'total') return displayTotal.value
  if (key === 'free') return displayFree.value
  if (key === 'busy') return displayBusy.value
  if (key === 'overload') return displayOverload.value
  return 0
}

const animateValue = (refVar, targetVal, duration = 800, isFloat = false) => {
  const startVal = refVar.value
  if (startVal === targetVal) return

  const startTime = performance.now()
  const step = (now) => {
    const elapsed = now - startTime
    const progress = Math.min(elapsed / duration, 1)
    
    // easeOutQuad
    const ease = progress * (2 - progress)
    
    const current = startVal + (targetVal - startVal) * ease
    refVar.value = isFloat ? Number(current.toFixed(1)) : Math.round(current)

    if (progress < 1) {
      requestAnimationFrame(step)
    } else {
      refVar.value = targetVal
    }
  }
  requestAnimationFrame(step)
}

watch(stats, (newStats) => {
  if (!newStats) return
  animateValue(displayTotal, newStats.total)
  animateValue(displayFree, newStats.free)
  animateValue(displayBusy, newStats.busy)
  animateValue(displayOverload, newStats.overload)
  animateValue(displayHoursUsed, newStats.hoursUsed, 800, true)
  animateValue(displayHoursTotal, newStats.hoursTotal)
  animateValue(displayHoursPct, newStats.hoursPct)
}, { deep: true, immediate: true })

// --- UI CONFIG (gom cấu hình lặp lại về một chỗ) ---
const statCards = [
  { key: 'total', label: 'Tổng nhân viên', icon: Users, iconClass: 'bg-indigo-50 text-indigo-500' },
  { key: 'free', label: 'Đang rảnh', icon: UserCheck, iconClass: 'bg-emerald-50 text-emerald-500' },
  { key: 'busy', label: 'Đang bận', icon: UserMinus, iconClass: 'bg-amber-50 text-amber-500' },
  { key: 'overload', label: 'Quá tải', icon: UserX, iconClass: 'bg-rose-50 text-rose-500' },
]

const filterTabs = [
  { value: 'all', label: 'Tất cả' },
  { value: 'free', label: 'Rảnh' },
  { value: 'busy', label: 'Đang bận' },
  { value: 'overload', label: 'Quá tải' },
]

const statusMeta = {
  free: { label: 'Rảnh', dot: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  busy: { label: 'Đang bận', dot: 'bg-amber-500', text: 'text-amber-700', badge: 'bg-amber-50 text-amber-700 border-amber-100' },
  overload: { label: 'Quá tải', dot: 'bg-rose-500', text: 'text-rose-700', badge: 'bg-rose-50 text-rose-700 border-rose-100' },
}

const legendItems = [
  { label: 'Rảnh', class: 'bg-emerald-100 border-emerald-200' },
  { label: 'Đang bận', class: 'bg-amber-100 border-amber-200' },
  { label: 'Quá tải', class: 'bg-rose-100 border-rose-200' },
  { label: 'Nghỉ phép', class: 'bg-blue-50 border-blue-100' },
  { label: 'Không làm việc', class: 'bg-zinc-100 border-zinc-200' },
]

const filterStatus = ref('all') // all, free, busy, overload

// --- TAB INDICATOR (hiệu ứng trượt cho tab đang chọn) ---
const tabRefs = {}
const tabIndicatorStyle = ref({ opacity: 0 })
const updateTabIndicator = () => {
  const el = tabRefs[filterStatus.value]
  if (!el) return
  tabIndicatorStyle.value = { left: `${el.offsetLeft}px`, width: `${el.offsetWidth}px`, opacity: 1 }
}
watch(filterStatus, () => nextTick(updateTabIndicator))
onMounted(() => {
  nextTick(updateTabIndicator)
  window.addEventListener('resize', updateTabIndicator)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateTabIndicator)
  removeTimelineListeners()
})

const filteredResources = computed(() => {
  if (filterStatus.value === 'all') return resources.value
  return resources.value.filter(r => r.status === filterStatus.value)
})

// --- TIMELINE LOGIC ---
const startHour = computed(() => {
  const hasTaskAtOrBefore8 = resources.value.some(user => 
    user.tasks?.some(task => {
      const [h, m] = task.start.split(':').map(Number)
      return h < 8 || (h === 8 && m === 0)
    })
  )
  return hasTaskAtOrBefore8 ? 7 : 8
})

const endHour = computed(() => {
  let maxMins = 18 * 60 // Minimum is 18:00
  resources.value.forEach(user => {
    user.tasks?.forEach(task => {
      const [h, m] = task.end.split(':').map(Number)
      const endMins = h * 60 + m
      if (endMins + 60 > maxMins) {
        maxMins = endMins + 60
      }
    })
  })
  return Math.ceil(maxMins / 60)
})

const TOTAL_MINS = computed(() => (endHour.value - startHour.value) * 60)
const SNAP_MINS = 15
const MIN_TASK_MINS = 15

const hourMarks = computed(() => {
  const marks = []
  for (let h = startHour.value; h < endHour.value; h++) {
    marks.push(h)
  }
  return marks
})

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const timeToTimelineMinutes = (time) => {
  const [hour, minute] = time.split(':').map(Number)
  return (hour - startHour.value) * 60 + minute
}
const timelineMinutesToTime = (minutes) => {
  const total = startHour.value * 60 + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const getTaskPosition = (start, end) => {
  const startMins = clamp(timeToTimelineMinutes(start), 0, TOTAL_MINS.value)
  const endMins = clamp(timeToTimelineMinutes(end), 0, TOTAL_MINS.value)
  const duration = Math.max(endMins - startMins, MIN_TASK_MINS)
  
  return {
    left: `${(startMins / TOTAL_MINS.value) * 100}%`,
    width: `${(duration / TOTAL_MINS.value) * 100}%`
  }
}

// --- TIME TICK/STICK LOGIC (hiển thị mốc giờ hiện tại cho ngày hôm nay) ---
const currentTimePos = ref(null)
let timeTickInterval = null

const updateTimeStick = () => {
  const today = new Date()
  const date = new Date(timelineDate.value)
  const isToday = date.getDate() === today.getDate() &&
                  date.getMonth() === today.getMonth() &&
                  date.getFullYear() === today.getFullYear()

  if (!isToday) {
    currentTimePos.value = null
    return
  }

  const h = today.getHours()
  const m = today.getMinutes()
  const mins = (h - startHour.value) * 60 + m
  if (mins >= 0 && mins <= TOTAL_MINS.value) {
    currentTimePos.value = `${(mins / TOTAL_MINS.value) * 100}%`
  } else {
    currentTimePos.value = null
  }
}

watch([timelineDate, startHour, TOTAL_MINS], updateTimeStick, { immediate: true })

onMounted(() => {
  updateTimeStick()
  timeTickInterval = window.setInterval(updateTimeStick, 60000)
})

onBeforeUnmount(() => {
  if (timeTickInterval) clearInterval(timeTickInterval)
})

const timelineDrag = ref(null)
const timelineSavingTaskId = ref(null)
const timelineError = ref('')
const suppressedTaskClickId = ref(null)

const removeTimelineListeners = () => {
  window.removeEventListener('pointermove', handleTaskPointerMove)
  window.removeEventListener('pointerup', finishTaskPointer)
  window.removeEventListener('pointercancel', cancelTaskPointer)
}

const startTaskPointer = (event, task, assignee, mode) => {
  if (!task.id || event.button !== 0 || timelineSavingTaskId.value) return
  const taskBlock = event.currentTarget.closest('[data-task-block]')
  const track = taskBlock?.parentElement
  if (!track?.clientWidth) return

  event.preventDefault()
  event.stopPropagation()
  timelineError.value = ''
  timelineDrag.value = {
    task,
    assignee,
    mode,
    pointerId: event.pointerId,
    taskBlock,
    originX: event.clientX,
    trackWidth: track.clientWidth,
    initialStart: timeToTimelineMinutes(task.start),
    initialEnd: timeToTimelineMinutes(task.end),
    initialEstimatedMinutes: task.estimatedMinutes,
    initialSegmentMinutes: timeToTimelineMinutes(task.end) - timeToTimelineMinutes(task.start),
    initialScheduleSegments: task.scheduleSegments.map((segment) => (
      segment ? { ...segment } : segment
    )),
    moved: false,
  }
  taskBlock.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleTaskPointerMove, { passive: false })
  window.addEventListener('pointerup', finishTaskPointer, { once: true })
  window.addEventListener('pointercancel', cancelTaskPointer, { once: true })
}

function handleTaskPointerMove(event) {
  const drag = timelineDrag.value
  if (!drag || event.pointerId !== drag.pointerId) return
  event.preventDefault()

  const rawDelta = ((event.clientX - drag.originX) / drag.trackWidth) * TOTAL_MINS.value
  const delta = Math.round(rawDelta / SNAP_MINS) * SNAP_MINS
  if (delta === 0) return

  let nextStart = drag.initialStart
  let nextEnd = drag.initialEnd
  if (drag.mode === 'move') {
    const boundedDelta = clamp(delta, -drag.initialStart, TOTAL_MINS.value - drag.initialEnd)
    nextStart += boundedDelta
    nextEnd += boundedDelta
  } else if (drag.mode === 'resize-start') {
    nextStart = clamp(drag.initialStart + delta, 0, drag.initialEnd - MIN_TASK_MINS)
  } else {
    nextEnd = clamp(drag.initialEnd + delta, drag.initialStart + MIN_TASK_MINS, TOTAL_MINS.value)
  }

  drag.moved = true
  drag.task.start = timelineMinutesToTime(nextStart)
  drag.task.end = timelineMinutesToTime(nextEnd)
  if (drag.mode !== 'move') {
    drag.task.estimatedMinutes = (
      drag.initialEstimatedMinutes
      - drag.initialSegmentMinutes
      + (nextEnd - nextStart)
    )
  }
}

const scheduledDateAt = (source, timelineMinutes) => {
  const date = new Date(source)
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  safeDate.setHours(startHour.value, 0, 0, 0)
  safeDate.setMinutes(safeDate.getMinutes() + timelineMinutes)
  return safeDate
}

async function finishTaskPointer() {
  const drag = timelineDrag.value
  if (drag?.taskBlock?.hasPointerCapture?.(drag.pointerId)) {
    drag.taskBlock.releasePointerCapture(drag.pointerId)
  }
  removeTimelineListeners()
  timelineDrag.value = null
  if (!drag?.moved) return

  suppressedTaskClickId.value = drag.task.id
  window.setTimeout(() => {
    if (suppressedTaskClickId.value === drag.task.id) suppressedTaskClickId.value = null
  }, 200)

  const nextStart = timeToTimelineMinutes(drag.task.start)
  const nextEnd = timeToTimelineMinutes(drag.task.end)
  const baseDate = drag.task.scheduledStartAt || timelineDate.value
  const startAt = scheduledDateAt(baseDate, nextStart)
  const endAt = scheduledDateAt(baseDate, nextEnd)
  const scheduleSegments = drag.initialScheduleSegments.map((segment, index) => (
    index === drag.task.segmentIndex
      ? { startAt: startAt.toISOString(), endAt: endAt.toISOString() }
      : segment
  )).filter(Boolean)

  timelineSavingTaskId.value = drag.task.id
  try {
    await AssignmentService.updateTaskTime(drag.task.id, {
      scheduleSegments,
      estimatedMinutes: drag.task.estimatedMinutes,
    })
    await refreshResources()
  } catch (e) {
    drag.task.start = timelineMinutesToTime(drag.initialStart)
    drag.task.end = timelineMinutesToTime(drag.initialEnd)
    drag.task.estimatedMinutes = drag.initialEstimatedMinutes
    drag.task.scheduleSegments = drag.initialScheduleSegments
    timelineError.value = e.message || 'Không thể cập nhật lịch thực hiện.'
  } finally {
    timelineSavingTaskId.value = null
  }
}

function cancelTaskPointer() {
  const drag = timelineDrag.value
  if (drag?.taskBlock?.hasPointerCapture?.(drag.pointerId)) {
    drag.taskBlock.releasePointerCapture(drag.pointerId)
  }
  removeTimelineListeners()
  timelineDrag.value = null
  if (!drag) return
  drag.task.start = timelineMinutesToTime(drag.initialStart)
  drag.task.end = timelineMinutesToTime(drag.initialEnd)
  drag.task.estimatedMinutes = drag.initialEstimatedMinutes
  drag.task.scheduleSegments = drag.initialScheduleSegments
}

const handleTaskClick = (task, assignee) => {
  if (suppressedTaskClickId.value === task.id) return
  openTaskTime(task, assignee)
}

// --- FORM STATE ---
// Màn hình lớn (>= 1536px, tương đương FullHD 24"): panel hiển thị sẵn bên phải.
// Màn hình nhỏ hơn (laptop 13", tablet, mobile): ẩn mặc định, mở dạng overlay khi bấm nút.
const DESKTOP_QUERY = '(min-width: 1536px)'
const isDesktop = typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
const isFormOpen = ref(false)
const isAiModalOpen = ref(isDesktop)

if (typeof window !== 'undefined') {
  // Tự đồng bộ khi người dùng resize qua lại mốc desktop
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', (e) => {
    isAiModalOpen.value = e.matches
    isFormOpen.value = false
  })
}

const openForm = () => {
  isFormOpen.value = true
}

const closeForm = () => {
  isFormOpen.value = false
  setTimeout(() => {
    resetForm()
  }, 400)
}
const formAssignee = ref('')
const formTitle = ref('')
const formDesc = ref('')
const formDate = ref(new Date().toISOString().slice(0, 10))
const formStartTime = ref('14:00')
const formEndTime = ref('17:00')

const formSelectedUser = computed(() => resources.value.find(r => r.id === formAssignee.value))

const calculatedDurationHours = computed(() => {
  if (!formStartTime.value || !formEndTime.value) return 0
  const [sH, sM] = formStartTime.value.split(':').map(Number)
  const [eH, eM] = formEndTime.value.split(':').map(Number)
  const diff = (eH * 60 + eM) - (sH * 60 + sM)
  return diff > 0 ? (diff / 60).toFixed(1) : 0
})

const predictedTotal = computed(() => {
  if (!formSelectedUser.value) return 0
  return formSelectedUser.value.totalHours + Number(calculatedDurationHours.value)
})

const predictedStatus = computed(() => {
  const t = predictedTotal.value
  if (t <= 6) return 'safe'
  if (t <= 8) return 'warning'
  return 'danger'
})

const isFormValid = computed(() =>
  Boolean(formSelectedUser.value) && formTitle.value.trim().length > 0 && Number(calculatedDurationHours.value) > 0
)

const resetForm = () => {
  formAssignee.value = ''
  formTitle.value = ''
  formDesc.value = ''
  formStartTime.value = '14:00'
  formEndTime.value = '17:00'
}

const isTaskTimeOpen = ref(false)
const taskTimeTarget = ref(null)
const taskTimeForm = ref({ estimatedMinutes: 60, dueAt: '' })
const updatingTaskTime = ref(false)

const openTaskTime = (task, assignee) => {
  if (!task.id) return
  taskTimeTarget.value = { task, assignee }
  taskTimeForm.value = {
    estimatedMinutes: task.estimatedMinutes ?? 60,
    dueAt: task.dueAt ? String(task.dueAt).slice(0, 10) : '',
  }
  isTaskTimeOpen.value = true
}

const submitTaskTime = async () => {
  if (!taskTimeTarget.value?.task?.id || !taskTimeForm.value.estimatedMinutes) return
  updatingTaskTime.value = true
  try {
    const payload = {
      estimatedMinutes: Number(taskTimeForm.value.estimatedMinutes),
      dueAt: taskTimeForm.value.dueAt || undefined,
    }
    if (taskTimeTarget.value.task.scheduledStartAt) {
      const startAt = new Date(taskTimeTarget.value.task.scheduledStartAt)
      payload.scheduledStartAt = startAt.toISOString()
      payload.scheduledEndAt = new Date(
        startAt.getTime() + Number(taskTimeForm.value.estimatedMinutes) * 60000
      ).toISOString()
    }
    await AssignmentService.updateTaskTime(taskTimeTarget.value.task.id, payload)
    isTaskTimeOpen.value = false
    await refreshResources()
  } catch (e) {
    console.error('Update task time failed:', e.message)
  } finally {
    updatingTaskTime.value = false
  }
}

const submitAssignment = async () => {
  if (!isFormValid.value) return
  const user = formSelectedUser.value
  try {
    // Map form time → estimatedMinutes for API
    const [sH, sM] = formStartTime.value.split(':').map(Number)
    const [eH, eM] = formEndTime.value.split(':').map(Number)
    const estimatedMinutes = Math.max((eH * 60 + eM) - (sH * 60 + sM), 0)
    const startAt = new Date(`${formDate.value}T${formStartTime.value}:00`)
    const endAt = new Date(`${formDate.value}T${formEndTime.value}:00`)
    const result = await AssignmentService.createTask({
      title: formTitle.value.trim(),
      description: formDesc.value.trim() || undefined,
      type: 'DAILY',
      departmentId: departmentId.value || undefined,
      assignedToUserId: user.id,
      scheduledStartAt: startAt.toISOString(),
      scheduledEndAt: endAt.toISOString(),
      estimatedMinutes,
    })
    // Optimistic UI update
    user.tasks.push({
      id: result?.data?._id,
      start: formStartTime.value,
      end: formEndTime.value,
      scheduledStartAt: startAt.toISOString(),
      scheduledEndAt: endAt.toISOString(),
      estimatedMinutes,
      name: formTitle.value.trim(),
      type: 'safe',
    })
    user.totalHours = Number((user.totalHours + Number(calculatedDurationHours.value)).toFixed(1))
    user.status = user.totalHours <= 6 ? 'free' : user.totalHours <= 8 ? 'busy' : 'overload'
    refreshResources()
  } catch (e) {
    console.error('Assign task failed:', e.message)
  } finally {
    resetForm()
  }
}

const isMeetingOpen = ref(false)
const meetingCreating = ref(false)
const meetingError = ref('')
const meetingForm = ref({
  title: '',
  description: '',
  location: '',
  durationMinutes: 60,
  attendeeUserIds: [],
  strategy: 'NEAREST_FREE',
  date: new Date().toISOString().slice(0, 10),
  time: '09:00',
})

const nearestBusinessStart = () => {
  const date = new Date(Math.ceil((Date.now() + 15 * 60000) / (15 * 60000)) * 15 * 60000)
  const moveToNextWorkday = () => {
    date.setDate(date.getDate() + 1)
    while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1)
    date.setHours(8, 0, 0, 0)
  }
  if ([0, 6].includes(date.getDay()) || date.getHours() >= 17) {
    moveToNextWorkday()
  } else if (date.getHours() < 8) {
    date.setHours(8, 0, 0, 0)
  } else if (date.getHours() >= 12 && date.getHours() < 13) {
    date.setHours(13, 0, 0, 0)
  }
  return date
}

const openMeeting = () => {
  const suggestedStart = nearestBusinessStart()
  const localDate = [
    suggestedStart.getFullYear(),
    String(suggestedStart.getMonth() + 1).padStart(2, '0'),
    String(suggestedStart.getDate()).padStart(2, '0'),
  ].join('-')
  const localTime = `${String(suggestedStart.getHours()).padStart(2, '0')}:${String(suggestedStart.getMinutes()).padStart(2, '0')}`
  meetingError.value = ''
  meetingForm.value = {
    title: '',
    description: '',
    location: '',
    durationMinutes: 60,
    attendeeUserIds: resources.value.map((resource) => resource.id),
    strategy: 'NEAREST_FREE',
    date: localDate,
    time: localTime,
  }
  isMeetingOpen.value = true
}

const toggleMeetingAttendee = (userId) => {
  const attendeeIds = meetingForm.value.attendeeUserIds
  meetingForm.value.attendeeUserIds = attendeeIds.includes(userId)
    ? attendeeIds.filter((id) => id !== userId)
    : [...attendeeIds, userId]
}

const submitMeeting = async () => {
  if (!meetingForm.value.title.trim() || meetingForm.value.attendeeUserIds.length === 0) return
  meetingCreating.value = true
  meetingError.value = ''
  try {
    const payload = {
      title: meetingForm.value.title.trim(),
      description: meetingForm.value.description.trim() || undefined,
      location: meetingForm.value.location.trim() || undefined,
      durationMinutes: Number(meetingForm.value.durationMinutes),
      attendeeUserIds: meetingForm.value.attendeeUserIds,
      strategy: meetingForm.value.strategy,
    }
    if (payload.strategy === 'INSERT_AND_SPLIT') {
      payload.startAt = new Date(
        `${meetingForm.value.date}T${meetingForm.value.time}:00`
      ).toISOString()
    }
    const result = await AssignmentService.createMeeting(payload)
    const meetingStart = new Date(result.data.startAt)
    timelineDate.value = meetingStart
    isMeetingOpen.value = false
    await refreshResources()
  } catch (error) {
    meetingError.value = error.message || 'Không thể tạo cuộc họp.'
  } finally {
    meetingCreating.value = false
  }
}

// --- AI CHAT STATE ---
let aiTimeout = null
const aiInputText = ref('')
const isAiTyping = ref(false)
const isRecordingVoice = ref(false)
const aiMessages = ref([
  { id: 1, role: 'ai', type: 'text', content: 'Xin chào sếp, sếp muốn giao việc gì hôm nay? Hãy gõ yêu cầu hoặc thu âm cho tôi biết.' }
])

const openAiModal = () => {
  isRecordingVoice.value = false
  isAiTyping.value = false
  isAiModalOpen.value = true
}

const closeAiModal = () => {
  isAiModalOpen.value = false
  if (aiTimeout) {
    clearTimeout(aiTimeout)
    aiTimeout = null
  }
  setTimeout(() => {
    isRecordingVoice.value = false
    isAiTyping.value = false
  }, 400)
}

const toggleVoice = () => {
  isRecordingVoice.value = !isRecordingVoice.value
}

const handleAiSubmit = () => {
  if (!aiInputText.value.trim() && !isRecordingVoice.value) return
  aiMessages.value.push({ id: Date.now(), role: 'user', type: 'text', content: aiInputText.value || 'Ghi âm yêu cầu...' })
  aiInputText.value = ''
  isRecordingVoice.value = false
  isAiTyping.value = true
  
  if (aiTimeout) clearTimeout(aiTimeout)
  aiTimeout = setTimeout(() => {
    isAiTyping.value = false
    aiMessages.value.push({
      id: Date.now(),
      role: 'ai',
      type: 'proposal',
      content: 'Dựa trên yêu cầu, tôi đã phân tích và đề xuất phân công như sau:',
      proposal: {
        title: 'Thẩm định Hồ sơ Đất đai',
        desc: 'Kiểm tra kỹ các thông số quy hoạch và đối chiếu với bản đồ mới nhất.',
        assigneeId: 1, // Nguyễn Văn B
        start: '14:00',
        end: '17:00'
      }
    })
  }, 2500)
}

const acceptAiProposal = (proposal) => {
  if (!proposal) return
  
  formAssignee.value = proposal.assigneeId
  formTitle.value = proposal.title
  formDesc.value = proposal.desc
  formStartTime.value = proposal.start
  formEndTime.value = proposal.end
  
  isAiModalOpen.value = false
  setTimeout(() => {
    aiMessages.value = [
      { id: 1, role: 'ai', type: 'text', content: 'Xin chào sếp, sếp muốn giao việc gì hôm nay? Hãy tải lên công văn, gõ yêu cầu hoặc thu âm cho tôi biết.' }
    ]
  }, 100)
}
</script>

<template>
  <div class="h-full w-full flex bg-zinc-50/30 font-sans text-zinc-900 overflow-hidden relative">
    
    <!-- LEFT/MAIN: Dashboard & Timeline -->
    <div class="flex-1 flex flex-col overflow-y-auto hide-scrollbar 2xl:border-r border-zinc-200/50 min-w-0">
      
      <!-- Top Overview Header -->
      <header class="px-4 sm:px-6 2xl:px-8 pt-5 sm:pt-6 2xl:pt-8 pb-5 flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight truncate">Phân công công việc</h1>
          <p class="text-zinc-500 text-sm mt-1 font-medium hidden sm:block">Điều phối nguồn lực và theo dõi lịch trình</p>
        </div>
        
        <!-- Mobile Buttons (<2xl) -->
        <div class="flex items-center gap-3 shrink-0 2xl:hidden">
          <Button @click="closeForm(); openAiModal()" class="h-9 rounded-full gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold px-4 whitespace-nowrap border border-indigo-200/50">
            <Sparkles class="w-4 h-4" /> Giao việc bằng AI
          </Button>
          <Button @click="closeAiModal(); openForm()" class="h-9 rounded-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 whitespace-nowrap">
            <Plus class="w-4 h-4" /> Giao việc mới
          </Button>
        </div>

        <!-- Desktop Sliding Tabs (>=2xl) -->
        <div class="hidden 2xl:grid relative grid-cols-2 bg-zinc-100 p-1 rounded-full isolate select-none w-[240px] shrink-0 border border-zinc-200/50">
          <div class="absolute inset-y-1 left-1 right-1 z-0 pointer-events-none">
            <div class="w-1/2 h-full bg-white rounded-full shadow-sm transition-transform duration-300 ease-out will-change-transform"
                 :style="{ transform: `translateX(${isFormOpen ? '100%' : '0%'})` }"></div>
          </div>
          
          <button @click="openAiModal(); closeForm()" 
                  class="relative rounded-full text-xs font-bold z-10 transition-colors h-8 flex items-center justify-center gap-1.5 bg-transparent border-0 outline-none cursor-pointer"
                  :class="isAiModalOpen ? 'text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'">
            <Sparkles class="w-3.5 h-3.5" /> AI Chat
          </button>
          <button @click="openForm(); closeAiModal()" 
                  class="relative rounded-full text-xs font-bold z-10 transition-colors h-8 flex items-center justify-center gap-1.5 bg-transparent border-0 outline-none cursor-pointer"
                  :class="isFormOpen ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'">
            <Plus class="w-3.5 h-3.5" /> Thủ công
          </button>
        </div>
      </header>

      <!-- Stats Cards Row: luôn hiển thị 5 card trên 1 dòng, không ẩn/xuống dòng text.
           min-w-fit giữ card không nhỏ hơn nội dung; màn hình quá hẹp sẽ trượt ngang. -->
      <div class="px-4 sm:px-6 2xl:px-8 pb-5 sm:pb-6 2xl:pb-8 flex gap-3 sm:gap-4 overflow-x-auto hide-scrollbar">
        <div v-for="card in statCards" :key="card.key"
             class="flex-1 min-w-fit bg-white rounded-2xl p-4 2xl:p-5 border border-zinc-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] flex items-center gap-3 2xl:gap-4">
          <div class="w-10 h-10 2xl:w-12 2xl:h-12 rounded-full flex items-center justify-center shrink-0" :class="card.iconClass">
            <component :is="card.icon" class="w-5 h-5 2xl:w-6 2xl:h-6" />
          </div>
          <div>
            <h2 class="text-xl 2xl:text-2xl font-bold leading-none">{{ getDisplayVal(card.key) }}</h2>
            <p class="text-[10px] 2xl:text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mt-1 whitespace-nowrap">{{ card.label }}</p>
          </div>
        </div>
        <!-- Chart Card -->
        <div class="flex-1 min-w-fit bg-white rounded-2xl p-4 2xl:p-5 border border-zinc-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] flex items-center gap-3 2xl:gap-5">
          <div class="relative w-11 h-11 2xl:w-14 2xl:h-14 shrink-0 flex items-center justify-center">
            <!-- Simple SVG Donut Chart -->
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path class="text-zinc-100" stroke-width="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path class="text-indigo-600 transition-all duration-500 ease-out" stroke-width="4" :stroke-dasharray="`${displayHoursPct}, 100`" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span class="absolute text-[10px] 2xl:text-[11px] font-bold">{{ displayHoursPct }}%</span>
          </div>
          <div>
            <p class="text-[10px] 2xl:text-[11px] font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap">Tổng thời gian</p>
            <p class="text-base 2xl:text-lg font-bold leading-tight mt-0.5 whitespace-nowrap">{{ displayHoursUsed }} / {{ displayHoursTotal }} h</p>
          </div>
        </div>
      </div>

      <!-- Timeline Section -->
      <div class="bg-white mx-4 sm:mx-6 2xl:mx-8 mb-5 sm:mb-6 2xl:mb-8 rounded-3xl border border-zinc-100 shadow-sm overflow-hidden flex flex-col">
        
        <!-- Timeline Header Controls -->
        <div class="px-4 sm:px-6 py-4 border-b border-zinc-100 flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-4 sm:gap-6 flex-wrap min-w-0">
            <h3 class="font-bold text-zinc-800 whitespace-nowrap">Trạng thái nhân viên</h3>
            <div class="relative flex bg-zinc-100/80 rounded-full p-1 overflow-x-auto hide-scrollbar max-w-full">
              <!-- Indicator trượt theo tab đang được chọn -->
              <span class="absolute top-1 bottom-1 bg-white shadow-sm rounded-full transition-all duration-300 ease-out pointer-events-none"
                    :style="tabIndicatorStyle"></span>
              <button v-for="tab in filterTabs" :key="tab.value" :ref="el => (tabRefs[tab.value] = el)" @click="filterStatus = tab.value"
                      :class="['relative z-10 px-3 sm:px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap', filterStatus === tab.value ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700']">
                {{ tab.label }}
              </button>
            </div>
          </div>
          
          <div class="flex items-center gap-2 sm:gap-3 shrink-0">
            <Button class="h-[34px] rounded-full bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700" @click="openMeeting">
              <CalendarPlus class="mr-1.5 h-4 w-4" /> Tạo cuộc họp
            </Button>
            <Popover>
              <PopoverTrigger as-child>
                <Button variant="outline" class="h-[34px] rounded-full bg-zinc-50 border border-zinc-200/60 hover:bg-zinc-100/80 px-3 py-1.5 gap-2 text-xs font-bold text-zinc-700 select-none flex items-center">
                  <CalendarIcon class="w-4 h-4 text-zinc-500" />
                  <span class="whitespace-nowrap">{{ timelineDateLabel }}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0 rounded-3xl" align="end">
                <Calendar v-model="calendarDateVal" initial-focus />
              </PopoverContent>
            </Popover>
            <div class="flex items-center bg-zinc-50 border border-zinc-200/60 rounded-full overflow-hidden">
              <button class="pl-2.5 pr-2 py-1.5 hover:bg-zinc-100 border-r border-zinc-200/60 transition-colors" @click="changeTimelineDay(-1)"><ChevronLeft class="w-4 h-4 text-zinc-600" /></button>
              <button class="pl-2 pr-2.5 py-1.5 hover:bg-zinc-100 transition-colors" @click="changeTimelineDay(1)"><ChevronRight class="w-4 h-4 text-zinc-600" /></button>
            </div>
            <Button variant="outline" size="sm" class="h-[34px] rounded-full text-xs font-bold gap-2 hidden sm:flex">
              <Filter class="w-3.5 h-3.5" /> Bộ lọc
            </Button>
          </div>
        </div>

        <div v-if="timelineError" class="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          <span>{{ timelineError }}</span>
          <button type="button" aria-label="Đóng thông báo" class="shrink-0" @click="timelineError = ''">
            <X class="h-3.5 w-3.5" />
          </button>
        </div>

        <!-- Gantt Grid Container (Cuộn dọc chung) -->
        <div class="flex-1 overflow-y-auto hide-scrollbar min-h-0 flex flex-col">
          <div class="flex min-h-fit">
            
            <!-- CỘT TRÁI: Danh sách Nhân viên (Cố định, không cuộn ngang) -->
            <div class="w-[180px] sm:w-[220px] xl:w-[260px] shrink-0 border-r border-zinc-100 bg-white flex flex-col">
              <!-- Header -->
              <div class="sticky top-0 z-30 h-[45px] px-3 sm:px-6 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between gap-2 shrink-0">
                <span class="text-[11px] font-bold text-zinc-400 uppercase whitespace-nowrap">Nhân viên</span>
                <span class="hidden sm:inline text-[11px] font-bold text-zinc-400 uppercase whitespace-nowrap">Trạng thái</span>
              </div>
              <!-- Dòng dữ liệu -->
              <div v-for="user in filteredResources" :key="user.id" 
                   class="h-[64px] px-3 sm:px-6 py-3 flex items-center justify-between gap-2 border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors bg-white shrink-0">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="relative shrink-0">
                    <Avatar class="w-8 h-8 border border-zinc-100">
                      <AvatarImage :src="user.avatar" />
                      <AvatarFallback>{{ user.name[0] }}</AvatarFallback>
                    </Avatar>
                    <span class="sm:hidden absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white" :class="statusMeta[user.status].dot"></span>
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-bold text-zinc-900 leading-none truncate">{{ user.name }}</p>
                    <p class="text-[11px] font-medium text-zinc-500 mt-1 truncate">{{ user.role }}</p>
                  </div>
                </div>
                
                <div class="hidden sm:block text-right shrink-0">
                  <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
                    <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta[user.status].dot"></span>
                    <span class="text-[11px] font-semibold" :class="statusMeta[user.status].text">{{ statusMeta[user.status].label }}</span>
                  </div>
                  <p class="text-[11px] font-semibold mt-0.5 whitespace-nowrap" 
                     :class="{'text-zinc-500': user.status !== 'overload', 'text-rose-600': user.status === 'overload'}">
                    {{ user.totalHours }}h <span class="text-zinc-300">/ 8h</span>
                  </p>
                </div>
              </div>
            </div>

            <!-- CỘT PHẢI: Timeline Canvas (Cuộn ngang) -->
            <div class="flex-1 overflow-x-auto min-w-0 select-none" 
                 ref="timelineScrollContainer"
                 @mousedown="handleMouseDown"
                 @contextmenu.prevent
            >
              <div class="min-w-[1200px] flex flex-col relative">
                <!-- Header mốc giờ (sticky top) -->
                <div class="sticky top-0 z-30 h-[45px] py-3 bg-zinc-50 border-b border-zinc-100 relative shrink-0">
                  <div class="absolute inset-0 flex">
                    <div v-for="h in hourMarks" :key="h" class="flex-1 border-l border-zinc-200/40 flex items-center">
                      <span class="pl-1.5 text-[10px] font-semibold text-zinc-400">{{ String(h).padStart(2, '0') }}:00</span>
                    </div>
                  </div>
                </div>
                <!-- Các dòng Timeline -->
                <div v-for="user in filteredResources" :key="user.id" 
                     class="h-[64px] relative border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors group shrink-0">
                  <!-- Grid lines -->
                  <div class="absolute inset-0 flex pointer-events-none">
                    <div v-for="i in hourMarks.length" :key="i" class="flex-1 border-r border-zinc-100/50 border-dashed"></div>
                  </div>
                  
                  <!-- Task Blocks -->
                  <div class="absolute inset-0 top-3 bottom-3">
                    <div v-for="task in user.tasks" :key="task.blockId"
                         data-task-block
                         class="absolute top-0 bottom-0 rounded-lg flex items-center px-3 truncate transition-colors cursor-grab active:cursor-grabbing select-none touch-none shadow-[0_1px_3px_rgba(0,0,0,0.02)]"
                         :title="`${task.name} · ${task.start} - ${task.end}`"
                         @pointerdown="startTaskPointer($event, task, user, 'move')"
                         @click="handleTaskClick(task, user)"
                         :class="{
                           'bg-emerald-100/60 text-emerald-800 border border-emerald-200/60': task.type === 'safe',
                           'bg-indigo-50 text-indigo-700 border border-indigo-100': task.type === 'safe-light',
                           'bg-amber-100/60 text-amber-900 border border-amber-200/60': task.type === 'busy',
                           'bg-rose-100/70 text-rose-900 border border-rose-200/80': task.type === 'overload',
                           'bg-rose-50 text-rose-800 border border-dashed border-rose-300': task.type === 'overload-dashed',
                           'opacity-60': timelineSavingTaskId === task.id
                         }"
                         :style="getTaskPosition(task.start, task.end)"
                    >
                      <span role="separator" aria-label="Kéo để đổi giờ bắt đầu" title="Đổi giờ bắt đầu" class="absolute inset-y-0 left-0 z-10 w-2.5 cursor-ew-resize" @pointerdown.stop="startTaskPointer($event, task, user, 'resize-start')" @click.stop></span>
                      <span class="text-[11px] font-bold truncate">{{ task.name }}</span>
                      <span role="separator" aria-label="Kéo để đổi giờ kết thúc" title="Đổi giờ kết thúc" class="absolute inset-y-0 right-0 z-10 w-2.5 cursor-ew-resize" @pointerdown.stop="startTaskPointer($event, task, user, 'resize-end')" @click.stop></span>
                    </div>
                  </div>
                </div>

                <!-- Time Stick (Vertical red line) -->
                <div v-if="currentTimePos" 
                     class="absolute top-0 bottom-0 w-[1.5px] bg-rose-500 z-40 pointer-events-none opacity-60"
                     :style="{ left: currentTimePos }"
                >
                  <div class="absolute top-[3px] -left-[4.25px] w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_1px_3px_rgba(0,0,0,0.15)] border border-white"></div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- Legend Bottom -->
        <div class="px-6 py-3 border-t border-zinc-100 flex items-center flex-wrap gap-x-6 gap-y-2 bg-zinc-50/50">
          <div v-for="item in legendItems" :key="item.label" class="flex items-center gap-2 whitespace-nowrap">
            <span class="w-3 h-3 rounded-sm border" :class="item.class"></span>
            <span class="text-[11px] font-semibold text-zinc-500">{{ item.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- RIGHT PANEL: Assignment Form
         >= 2xl (1536px, màn desktop FullHD): hiển thị inline cố định bên phải.
         < 2xl (laptop 13", tablet): drawer trượt từ phải, có backdrop.
         Mobile (< sm): bottom-sheet trượt từ dưới lên. -->
    <!-- Placeholder to reserve space on desktop and prevent layout shift -->
    <div v-if="isFormOpen || isAiModalOpen" class="hidden 2xl:block w-[380px] shrink-0 border-l border-zinc-100"></div>

    <!-- Backdrop: fade in/out, chỉ hiện khi panel là overlay -->
    <Transition name="backdrop-fade-in" type="transition">
      <div v-if="isFormOpen || isAiModalOpen" class="fixed inset-0 bg-zinc-900/40 z-[60] 2xl:hidden" @click="closeForm(); closeAiModal()"></div>
    </Transition>

    <!-- Unified Panel Shell: trượt từ dưới lên (mobile) / từ phải sang (>= sm) -->
    <Transition name="slide-in-only" :duration="350">
      <aside v-if="isFormOpen || isAiModalOpen" class="fixed z-[70] inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-3xl shadow-2xl sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:max-h-none sm:w-[400px] sm:rounded-none sm:shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.15)] 2xl:absolute 2xl:inset-auto 2xl:right-0 2xl:top-0 2xl:bottom-0 2xl:w-[380px] 2xl:max-h-none 2xl:rounded-none 2xl:shadow-none shrink-0 bg-white flex flex-col overflow-hidden border-l border-zinc-100">
        
        <!-- Sliding Container (Carousel) -->
        <div class="flex w-[200%] h-full transition-transform duration-300 ease-out will-change-transform"
             :style="{ transform: `translateX(${isFormOpen ? '-50%' : '0%'})` }">
             
          <!-- ============================================== -->
          <!-- TAB 1: AI CHAT (LEFT SIDE) -->
          <!-- ============================================== -->
          <div class="w-1/2 h-full flex flex-col relative border-r border-zinc-100">
            <!-- Header -->
            <div class="px-6 2xl:px-8 py-5 2xl:py-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                  <Sparkles class="w-3.5 h-3.5" />
                </div>
                <h2 class="text-xl font-bold text-zinc-900">Trợ lý AI</h2>
              </div>
              <button type="button" @click.stop="closeAiModal" aria-label="Đóng bảng AI" class="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-500 transition-colors 2xl:hidden shrink-0">
                <X class="w-4 h-4" />
              </button>
            </div>

            <!-- Chat Area -->
            <div class="flex-1 min-h-0 overflow-y-auto hide-scrollbar p-6 bg-zinc-50/50 flex flex-col gap-6">
              <div v-for="msg in aiMessages" :key="msg.id" class="flex flex-col gap-2">
                <!-- User Message -->
                <div v-if="msg.role === 'user'" class="self-end flex flex-col items-end max-w-[80%]">
                  <div v-if="msg.type === 'text'" class="bg-indigo-600 text-white px-5 py-3 rounded-2xl rounded-tr-sm text-[13px] font-medium leading-relaxed shadow-sm">
                    {{ msg.content }}
                  </div>
                  <div v-else-if="msg.type === 'file'" class="bg-white border border-zinc-200 text-zinc-800 px-5 py-3 rounded-2xl rounded-tr-sm flex items-center gap-3 shadow-sm">
                    <div class="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600"><Paperclip class="w-4 h-4"/></div>
                    <div>
                      <p class="text-[13px] font-bold">{{ msg.content }}</p>
                      <p class="text-[10px] font-medium text-zinc-500">Đã tải lên</p>
                    </div>
                  </div>
                </div>
                <!-- AI Message -->
                <div v-if="msg.role === 'ai'" class="self-start flex gap-3 max-w-[90%] w-full">
                  <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 mt-1">
                    <Bot class="w-4 h-4" />
                  </div>
                  <div class="flex flex-col gap-3 w-full">
                    <div v-if="msg.content" class="bg-white border border-zinc-100 text-zinc-800 px-5 py-3 rounded-2xl rounded-tl-sm text-[13px] font-medium leading-relaxed shadow-sm self-start">
                      {{ msg.content }}
                    </div>
                    <!-- Proposal Card -->
                    <div v-if="msg.type === 'proposal'" class="bg-white border border-indigo-100 shadow-md shadow-indigo-900/5 rounded-2xl p-5 w-[85%] flex flex-col gap-4">
                      <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full border border-zinc-100 overflow-hidden shrink-0">
                          <AvatarImage :src="resources.find(r => r.id === msg.proposal.assigneeId)?.avatar" />
                        </div>
                        <div>
                          <p class="text-sm font-bold text-zinc-900">{{ resources.find(r => r.id === msg.proposal.assigneeId)?.name }}</p>
                          <p class="text-[11px] text-zinc-500 font-semibold">{{ resources.find(r => r.id === msg.proposal.assigneeId)?.role }}</p>
                        </div>
                      </div>
                      <div class="space-y-1.5">
                        <p class="text-[13px] font-bold text-zinc-800">{{ msg.proposal.title }}</p>
                        <p class="text-[12px] text-zinc-600">{{ msg.proposal.desc }}</p>
                      </div>
                      <div class="flex items-center justify-between border-t border-zinc-100 pt-3 mt-1">
                        <div class="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">
                          {{ msg.proposal.start }} - {{ msg.proposal.end }}
                        </div>
                        <Button @click="acceptAiProposal(msg.proposal)" class="h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold px-4 gap-1.5 shadow-sm">
                          <CheckCircle class="w-3.5 h-3.5" /> Chấp nhận & Giao việc
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Typing Indicator -->
              <div v-if="isAiTyping" class="self-start flex gap-3">
                <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                  <Bot class="w-4 h-4" />
                </div>
                <div class="bg-white border border-zinc-100 px-5 py-3.5 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-1.5 h-[42px]">
                  <span class="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce"></span>
                  <span class="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                  <span class="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                </div>
              </div>
            </div>

            <!-- Input Bar (Footer) -->
            <div class="p-4 bg-white border-t border-zinc-100 shrink-0">
              <div :class="['rounded-full transition-all duration-300', isRecordingVoice ? 'voice-active-border shadow-lg shadow-indigo-500/20' : 'p-[1px] bg-zinc-200/60']">
                <div class="flex items-center gap-2 bg-white rounded-full p-1.5 pl-4 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all h-[46px]">
                  <input 
                    v-model="aiInputText" 
                    @keyup.enter="handleAiSubmit"
                    type="text" 
                    :placeholder="isRecordingVoice ? 'Đang lắng nghe sếp nói...' : 'Nhập yêu cầu bằng văn bản...'"
                    :disabled="isRecordingVoice"
                    class="flex-1 bg-transparent outline-none text-[13px] font-medium text-zinc-800 placeholder:text-zinc-400 min-w-0 disabled:opacity-80"
                  />
                  <div class="flex items-center gap-1 shrink-0">
                    <button @click="toggleVoice" :title="isRecordingVoice ? 'Tắt thu âm' : 'Ra lệnh bằng giọng nói'" class="w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0" :class="isRecordingVoice ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' : 'text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50'">
                      <X v-if="isRecordingVoice" class="w-4 h-4" />
                      <Mic v-else class="w-4 h-4" />
                    </button>
                    <button @click="handleAiSubmit" class="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-700 flex items-center justify-center text-white transition-colors shadow-sm ml-1 shrink-0" :class="{'opacity-50 pointer-events-none': !aiInputText.trim() && !isRecordingVoice}">
                      <Send class="w-4 h-4 -ml-0.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ============================================== -->
          <!-- TAB 2: MANUAL FORM (RIGHT SIDE) -->
          <!-- ============================================== -->
          <div class="w-1/2 h-full flex flex-col relative">
            <!-- Header -->
            <div class="px-6 2xl:px-8 py-5 2xl:py-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
              <h2 class="text-xl font-bold text-zinc-900">Giao việc mới</h2>
              <button type="button" @click.stop="closeForm" aria-label="Đóng bảng giao việc" class="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-500 transition-colors 2xl:hidden shrink-0">
                <X class="w-4 h-4" />
              </button>
            </div>

            <!-- Body -->
            <div class="p-6 2xl:p-8 pb-28 2xl:pb-28 flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto hide-scrollbar">
              
              <!-- Chọn nhân viên -->
              <div class="space-y-2.5">
                <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Chọn nhân viên</label>
                <Select v-model="formAssignee">
                  <SelectTrigger class="w-full h-14 rounded-full bg-white border-zinc-200/80 shadow-sm hover:border-zinc-300 focus:ring-2 focus:ring-zinc-900/5 px-4 transition-all">
                    <div v-if="formSelectedUser" class="flex items-center justify-between gap-2 w-full min-w-0">
                      <div class="flex items-center gap-3 min-w-0">
                        <Avatar class="w-8 h-8 border border-zinc-100 shrink-0"><AvatarImage :src="formSelectedUser.avatar"/></Avatar>
                        <div class="text-left min-w-0">
                          <p class="text-sm font-bold text-zinc-900 leading-none truncate">{{ formSelectedUser.name }}</p>
                          <p class="text-[10px] font-semibold text-zinc-500 mt-1 truncate">{{ formSelectedUser.role }}</p>
                        </div>
                      </div>
                      <div class="px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap shrink-0" :class="statusMeta[formSelectedUser.status].badge">{{ statusMeta[formSelectedUser.status].label }}</div>
                    </div>
                    <SelectValue v-else placeholder="Chọn chuyên viên..." class="font-semibold text-zinc-400" />
                  </SelectTrigger>
                  <SelectContent class="rounded-3xl border-zinc-200/60 shadow-xl p-1.5">
                    <SelectGroup>
                      <SelectItem v-for="user in resources" :key="user.id" :value="user.id" class="cursor-pointer py-3 rounded-full">
                        <div class="flex items-center justify-between w-full pr-4">
                          <div class="flex items-center gap-3">
                            <Avatar class="w-7 h-7"><AvatarImage :src="user.avatar"/></Avatar>
                            <div class="text-left">
                              <p class="text-sm font-bold text-zinc-900 leading-none">{{ user.name }}</p>
                              <p class="text-[10px] text-zinc-500 mt-1">{{ user.role }}</p>
                            </div>
                          </div>
                        </div>
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <!-- Tên & Mô tả -->
              <div class="space-y-2.5">
                <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Tên công việc</label>
                <Input v-model="formTitle" placeholder="Nhập tên công việc" class="h-11 rounded-xl bg-white border-zinc-200/80 font-semibold" />
              </div>
              
              <div class="space-y-2.5">
                <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Mô tả chi tiết</label>
                <Textarea v-model="formDesc" placeholder="Nhập mô tả..." class="resize-none h-24 rounded-xl bg-white border-zinc-200/80 font-medium text-sm" />
              </div>

              <!-- Thời gian -->
              <fieldset class="space-y-2.5 border-0 p-0 m-0">
                <legend class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider p-0">Thời gian làm việc</legend>
                <div class="border border-zinc-200/80 rounded-2xl p-4 space-y-4 bg-white">
                  <div class="flex flex-col gap-1.5">
                    <label for="work-date" class="text-[10px] font-bold text-zinc-400 uppercase">Ngày làm việc</label>
                    <input id="work-date" type="date" v-model="formDate"
                           class="w-full h-11 px-4 rounded-full border border-zinc-200/80 bg-white text-sm font-semibold text-zinc-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all" />
                  </div>
                  <div class="flex items-end gap-3">
                    <div class="flex-1 flex flex-col gap-1.5">
                      <label for="work-start" class="text-[10px] font-bold text-zinc-400 uppercase">Từ</label>
                      <input id="work-start" type="time" v-model="formStartTime"
                             class="w-full h-11 px-4 rounded-full border border-zinc-200/80 bg-white text-sm font-semibold text-zinc-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all" />
                    </div>
                    <span class="h-11 flex items-center text-zinc-300 font-bold select-none" aria-hidden="true">&rarr;</span>
                    <div class="flex-1 flex flex-col gap-1.5">
                      <label for="work-end" class="text-[10px] font-bold text-zinc-400 uppercase">Đến</label>
                      <input id="work-end" type="time" v-model="formEndTime"
                             class="w-full h-11 px-4 rounded-full border border-zinc-200/80 bg-white text-sm font-semibold text-zinc-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all" />
                    </div>
                  </div>
                  <p class="text-[11px] font-semibold" :class="Number(calculatedDurationHours) > 0 ? 'text-zinc-500' : 'text-rose-500'">
                    {{ Number(calculatedDurationHours) > 0 ? `Thời lượng: ${calculatedDurationHours} giờ` : 'Giờ kết thúc phải sau giờ bắt đầu' }}
                  </p>
                </div>
              </fieldset>

              <!-- Predictive Progress -->
              <div class="bg-zinc-50 border border-zinc-100 rounded-2xl p-5 flex flex-col gap-3 mt-2">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-[11px] font-bold text-zinc-400 uppercase">Tổng thời gian</p>
                    <p class="text-xl font-extrabold text-zinc-900 mt-1">{{ calculatedDurationHours }} giờ</p>
                  </div>
                  <div class="text-right">
                    <p class="text-[11px] font-bold text-zinc-400 uppercase">Sau khi giao việc</p>
                    <p class="text-sm font-bold mt-1" :class="{'text-emerald-600': predictedStatus==='safe', 'text-amber-600': predictedStatus==='warning', 'text-rose-600': predictedStatus==='danger'}">
                      {{ predictedTotal }}h <span class="text-zinc-400">/ 8h</span>
                    </p>
                  </div>
                </div>
                <!-- Bar -->
                <div class="h-1.5 w-full bg-zinc-200/60 rounded-full flex overflow-hidden mt-1">
                  <div class="h-full bg-zinc-400 transition-all duration-300" :style="{ width: `${Math.min((formSelectedUser?.totalHours||0)/8*100, 100)}%` }"></div>
                  <div v-if="calculatedDurationHours > 0" class="h-full transition-all duration-300" 
                       :class="{'bg-emerald-500': predictedStatus==='safe', 'bg-amber-500': predictedStatus==='warning', 'bg-rose-500': predictedStatus==='danger'}"
                       :style="{ width: `${Math.min((calculatedDurationHours)/8*100, 100)}%` }"></div>
                </div>
              </div>

              <!-- AI Suggestion Box -->
              <div v-if="formSelectedUser" class="mt-2 bg-indigo-50/50 border border-indigo-100/50 rounded-2xl p-4 flex gap-3 items-start">
                <div class="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles class="w-3.5 h-3.5 text-indigo-600" />
                </div>
                <div class="min-w-0">
                  <p class="text-[11px] font-bold text-indigo-600 uppercase tracking-wide">Gợi ý từ AI</p>
                  <p class="text-[12px] font-medium text-indigo-900/80 mt-1 leading-relaxed">
                    {{ formSelectedUser.name }} hiện còn trống {{ Math.max(8 - formSelectedUser.totalHours, 0).toFixed(1) }}h trong hôm nay{{ predictedStatus === 'danger' ? ', giao thêm công việc này sẽ gây quá tải.' : ', phù hợp để nhận công việc này.' }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Footer Actions -->
            <div class="absolute bottom-0 inset-x-0 px-6 2xl:px-8 pt-10 pb-4 bg-gradient-to-t from-white via-white/80 to-transparent grid grid-cols-2 2xl:grid-cols-1 gap-3 pointer-events-none">
              <Button variant="outline" class="pointer-events-auto h-12 rounded-full font-bold text-zinc-700 border-zinc-200/80 bg-white/90 backdrop-blur-sm hover:bg-zinc-50 2xl:hidden" @click="closeForm()">Hủy</Button>
              <Button class="pointer-events-auto h-12 rounded-full font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:shadow-none" :disabled="!isFormValid" @click="submitAssignment">Giao việc</Button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <Dialog v-model:open="isMeetingOpen">
      <DialogContent class="max-w-3xl rounded-2xl">
        <DialogTitle class="flex items-center gap-2 text-xl font-bold">
          <CalendarPlus class="h-5 w-5 text-indigo-600" /> Tạo cuộc họp phòng
        </DialogTitle>

        <div class="grid gap-5 py-2 md:grid-cols-[1fr_1.1fr]">
          <div class="space-y-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold uppercase text-zinc-500">Tên cuộc họp *</label>
              <Input v-model="meetingForm.title" class="rounded-lg" placeholder="Nhập tên cuộc họp" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="text-xs font-bold uppercase text-zinc-500">Thời lượng *</label>
                <Input v-model.number="meetingForm.durationMinutes" type="number" min="15" max="480" step="15" class="rounded-lg" />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-bold uppercase text-zinc-500">Cách xếp lịch</label>
                <Select v-model="meetingForm.strategy">
                  <SelectTrigger class="rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEAREST_FREE">Giờ trống gần nhất</SelectItem>
                    <SelectItem value="INSERT_AND_SPLIT">Chèn và tách task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div v-if="meetingForm.strategy === 'INSERT_AND_SPLIT'" class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="text-xs font-bold uppercase text-zinc-500">Ngày họp *</label>
                <Input v-model="meetingForm.date" type="date" class="rounded-lg" />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-bold uppercase text-zinc-500">Giờ bắt đầu *</label>
                <Input v-model="meetingForm.time" type="time" step="900" class="rounded-lg" />
              </div>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold uppercase text-zinc-500">Địa điểm</label>
              <Input v-model="meetingForm.location" class="rounded-lg" placeholder="Phòng họp..." />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold uppercase text-zinc-500">Nội dung</label>
              <Textarea v-model="meetingForm.description" class="h-20 resize-none rounded-lg" placeholder="Nội dung cuộc họp..." />
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <label class="text-xs font-bold uppercase text-zinc-500">Người tham dự *</label>
              <span class="text-xs font-semibold text-zinc-400">{{ meetingForm.attendeeUserIds.length }}/{{ resources.length }} người</span>
            </div>
            <div class="max-h-[360px] divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200">
              <label
                v-for="resource in resources"
                :key="resource.id"
                class="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-zinc-50"
              >
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-indigo-600"
                  :checked="meetingForm.attendeeUserIds.includes(resource.id)"
                  @change="toggleMeetingAttendee(resource.id)"
                />
                <Avatar class="h-8 w-8 border border-zinc-100">
                  <AvatarImage :src="resource.avatar" />
                  <AvatarFallback>{{ resource.name[0] }}</AvatarFallback>
                </Avatar>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-bold text-zinc-800">{{ resource.name }}</p>
                  <p class="text-[11px] font-medium text-zinc-400">{{ resource.totalHours }}h đã xếp trong ngày</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div v-if="meetingError" class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {{ meetingError }}
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="outline" class="rounded-full" @click="isMeetingOpen = false">Hủy</Button>
          <Button
            class="rounded-full bg-indigo-600 text-white hover:bg-indigo-700"
            :disabled="meetingCreating || !meetingForm.title.trim() || meetingForm.attendeeUserIds.length === 0"
            @click="submitMeeting"
          >
            <Loader2 v-if="meetingCreating" class="mr-2 h-4 w-4 animate-spin" />
            Tạo và xếp lịch
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="isTaskTimeOpen">
      <DialogContent class="rounded-3xl max-w-md">
        <DialogTitle class="text-xl font-bold">Điều chỉnh thời gian</DialogTitle>
        <div class="space-y-4 py-2">
          <div class="rounded-2xl bg-zinc-50 px-4 py-3">
            <p class="text-sm font-bold text-zinc-900">{{ taskTimeTarget?.task?.name }}</p>
            <p class="mt-1 text-xs font-medium text-zinc-500">{{ taskTimeTarget?.assignee?.name }}</p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Thời lượng (phút)</span>
              <Input v-model.number="taskTimeForm.estimatedMinutes" type="number" min="15" step="15" class="rounded-xl" />
            </div>
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Deadline</span>
              <Input v-model="taskTimeForm.dueAt" type="date" class="rounded-xl" />
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="outline" class="rounded-full" @click="isTaskTimeOpen = false">Hủy</Button>
          <Button class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white" :disabled="updatingTaskTime" @click="submitTaskTime">
            Lưu thời gian
          </Button>
        </div>
      </DialogContent>
    </Dialog>

  </div>
</template>

<style scoped>
@keyframes gradient-border {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.voice-active-border {
  background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #6366f1);
  background-size: 300% 300%;
  animation: gradient-border 3s ease infinite;
  padding: 2px;
}
.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
/* Hiệu ứng đóng/mở modal Giao việc */
.backdrop-fade-in-enter-active,
.backdrop-fade-in-leave-active {
  transition: opacity 0.25s ease-out;
}
.backdrop-fade-in-enter-from,
.backdrop-fade-in-leave-to {
  opacity: 0;
}

.slide-in-only-enter-active,
.slide-in-only-leave-active {
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}
/* Mobile: bottom-sheet trượt từ dưới lên */
.slide-in-only-enter-from,
.slide-in-only-leave-to {
  transform: translateY(100%);
}
/* >= sm: drawer trượt từ phải sang */
@media (min-width: 640px) {
  .slide-in-only-enter-from,
  .slide-in-only-leave-to {
    transform: translateX(100%);
  }
}
</style>
