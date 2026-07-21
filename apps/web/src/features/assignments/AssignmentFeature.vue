<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarDate } from '@internationalized/date'
import { AssignmentService } from '@/features/assignments/services/assignment.service'
import { Users, UserCheck, UserMinus, UserX, ChevronLeft, ChevronRight, Filter, Sparkles, Calendar as CalendarIcon, X, Plus, Paperclip, Mic, Send, Bot, CheckCircle, ClipboardCheck } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/shared/api/http'

const resources = ref([])
const { user: currentUser } = useAuth()
const pendingApprovals = ref([])
const pendingApprovalCount = ref(0)
const canApprove = computed(() => Number(currentUser.value?.role?.level) <= 3 && currentUser.value?.role?.code !== 'SPECIALIST')
const route = useRoute()
const router = useRouter()
const timelineDate = ref(new Date())
const timelineScrollContainer = ref(null)
let realtimeRefreshTimer = null

const handleDeclarationChange = () => {
  if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = window.setTimeout(async () => {
    await refreshResources()
    if (isApprovalOpen.value) await loadApprovalItems(approvalTab.value).catch(() => undefined)
  }, 120)
}

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
const vietnamDateTime = (date, time) => new Date(`${date}T${time}:00+07:00`)
const departmentId = computed(() => (
  ['DEPARTMENT_LEADER', 'SPECIALIST'].includes(currentUser.value?.role?.code)
    ? idOf(currentUser.value?.department)
    : null
))
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
  const [nextResources, pendingResult] = await Promise.all([
    AssignmentService.listAssignees(departmentId.value, timelineDate.value),
    canApprove.value
      ? AssignmentService.listPendingApprovals().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ])
  resources.value = nextResources
  pendingApprovals.value = pendingResult?.data ?? []
  pendingApprovalCount.value = Number(pendingResult?.summary?.pendingApproval ?? pendingApprovals.value.length)
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
  window.addEventListener('work-declaration:changed', handleDeclarationChange)
  await Promise.all([refreshResources(), loadAiChatHistory()])
  if (!route.query.sourceDocument) return
  try {
    const result = await http(`/api/ingest-documents/${route.query.sourceDocument}`)
    const document = result.data
    formTitle.value = `Xử lý văn bản ${document.soKyHieu || 'đến'}`
    formDesc.value = document.trichYeu || ''
    formPoint.value = String(document.point ?? 0)
    formSourceDocument.value = document._id
    await openForm()
  } catch (error) {
    timelineError.value = error.message || 'Không thể tạo khai báo từ văn bản.'
  } finally {
    router.replace('/assignments')
  }
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
  window.removeEventListener('work-declaration:changed', handleDeclarationChange)
  if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer)
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

const isCompactTask = (task) => (
  timeToTimelineMinutes(task.end) - timeToTimelineMinutes(task.start) <= 30
)

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
const timelineCreate = ref(null)
const timelineSavingTaskId = ref(null)
const timelineError = ref('')
const suppressedTaskClickId = ref(null)

const removeTimelineListeners = () => {
  window.removeEventListener('pointermove', handleTaskPointerMove)
  window.removeEventListener('pointerup', finishTaskPointer)
  window.removeEventListener('pointercancel', cancelTaskPointer)
  window.removeEventListener('pointermove', handleCreatePointerMove)
  window.removeEventListener('pointerup', finishCreatePointer)
  window.removeEventListener('pointercancel', cancelCreatePointer)
}

const startTaskPointer = (event, task, assignee, mode) => {
  if (!task.id || !task.editable || event.button !== 0 || timelineSavingTaskId.value) return
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
  const sourceDate = new Date(source)
  const date = Number.isNaN(sourceDate.getTime()) ? vietnamDateKey(new Date()) : vietnamDateKey(sourceDate)
  return vietnamDateTime(date, timelineMinutesToTime(timelineMinutes))
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
  if (!task.editable) return
  openTaskTime(task, assignee)
}

const snapTimelineMinute = (clientX, trackRect) => {
  const raw = ((clientX - trackRect.left) / trackRect.width) * TOTAL_MINS.value
  return clamp(Math.round(raw / SNAP_MINS) * SNAP_MINS, 0, TOTAL_MINS.value)
}

const startCreatePointer = (event, assignee) => {
  if (event.button !== 0 || timelineDrag.value || timelineSavingTaskId.value) return
  if (event.target.closest('[data-task-block]')) return
  if (!canCreateForAssignee(assignee)) return

  const track = event.currentTarget
  const trackRect = track.getBoundingClientRect()
  if (!trackRect.width) return

  event.preventDefault()
  timelineError.value = ''
  const anchor = snapTimelineMinute(event.clientX, trackRect)
  const start = Math.min(anchor, TOTAL_MINS.value - MIN_TASK_MINS)
  timelineCreate.value = {
    assignee,
    track,
    trackRect,
    pointerId: event.pointerId,
    anchor,
    start,
    end: start + MIN_TASK_MINS,
    moved: false,
  }
  track.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleCreatePointerMove, { passive: false })
  window.addEventListener('pointerup', finishCreatePointer, { once: true })
  window.addEventListener('pointercancel', cancelCreatePointer, { once: true })
}

function handleCreatePointerMove(event) {
  const selection = timelineCreate.value
  if (!selection || event.pointerId !== selection.pointerId) return
  event.preventDefault()
  const current = snapTimelineMinute(event.clientX, selection.trackRect)
  if (current === selection.anchor) return

  selection.moved = true
  if (current > selection.anchor) {
    selection.start = Math.min(selection.anchor, TOTAL_MINS.value - MIN_TASK_MINS)
    selection.end = Math.max(current, selection.start + MIN_TASK_MINS)
  } else {
    selection.start = Math.min(current, selection.anchor - MIN_TASK_MINS)
    selection.end = Math.max(selection.anchor, selection.start + MIN_TASK_MINS)
  }
}

const releaseCreatePointer = (selection) => {
  if (selection?.track?.hasPointerCapture?.(selection.pointerId)) {
    selection.track.releasePointerCapture(selection.pointerId)
  }
  removeTimelineListeners()
  timelineCreate.value = null
}

function cancelCreatePointer() {
  releaseCreatePointer(timelineCreate.value)
}

function finishCreatePointer() {
  const selection = timelineCreate.value
  releaseCreatePointer(selection)
  if (!selection?.moved) return

  const overlaps = selection.assignee.tasks.some((task) => {
    const taskStart = timeToTimelineMinutes(task.start)
    const taskEnd = timeToTimelineMinutes(task.end)
    return selection.start < taskEnd && selection.end > taskStart
  })
  if (overlaps) {
    timelineError.value = 'Khoảng thời gian đã chọn đang trùng với một công việc khác.'
    return
  }

  resetForm()
  formDate.value = vietnamDateKey(timelineDate.value)
  formStartTime.value = timelineMinutesToTime(selection.start)
  formEndTime.value = timelineMinutesToTime(selection.end)
  closeAiModal()
  openForm(selection.assignee.id)
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

const formPoint = ref('0')
const formSourceDocument = ref('')
const formSaving = ref(false)
const formError = ref('')
const isSpecialist = computed(() => currentUser.value?.role?.code === 'SPECIALIST')

const canCreateForAssignee = (assignee) => {
  const actorId = String(idOf(currentUser.value) ?? '')
  const assigneeId = String(assignee?.id ?? '')
  if (!actorId || !assigneeId) return false
  if (actorId === assigneeId) return Boolean(idOf(currentUser.value?.organization))
  return Number(currentUser.value?.role?.level) < Number(assignee?.roleLevel)
}

const openForm = (assigneeId = idOf(currentUser.value)) => {
  formError.value = ''
  formAssignee.value = String(assigneeId ?? '')
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
const formDate = ref(vietnamDateKey(new Date()))
const formStartTime = ref(vietnamTime(new Date()))
const formEndTime = ref(vietnamTime(new Date(Date.now() + 2 * 60 * 60_000)))

const formSelectedUser = computed(() => {
  const selectedId = formAssignee.value || idOf(currentUser.value)
  const selected = resources.value.find(r => String(r.id) === String(selectedId))
  if (selected) return selected
  if (String(selectedId) !== String(idOf(currentUser.value))) return null
  return {
      id: idOf(currentUser.value),
      name: currentUser.value?.fullName,
      role: currentUser.value?.position || currentUser.value?.role?.name,
      avatar: currentUser.value?.avatarUrl,
      totalHours: 0,
      status: 'free',
    }
})

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
  Boolean(formSelectedUser.value)
  && formTitle.value.trim().length > 0
  && Number(calculatedDurationHours.value) > 0
  && Number.isFinite(Number(formPoint.value))
  && Number(formPoint.value) >= 0
)

const resetForm = () => {
  const now = new Date()
  formTitle.value = ''
  formDesc.value = ''
  formPoint.value = '0'
  formAssignee.value = String(idOf(currentUser.value) ?? '')
  formSourceDocument.value = ''
  formDate.value = vietnamDateKey(now)
  formStartTime.value = vietnamTime(now)
  formEndTime.value = vietnamTime(new Date(now.getTime() + 2 * 60 * 60_000))
  formError.value = ''
}

const isTaskTimeOpen = ref(false)
const taskTimeTarget = ref(null)
const taskTimeForm = ref({ start: '', end: '' })
const updatingTaskTime = ref(false)

const openTaskTime = (task, assignee) => {
  if (!task.id) return
  taskTimeTarget.value = { task, assignee }
  taskTimeForm.value = {
    start: task.start,
    end: task.end,
  }
  isTaskTimeOpen.value = true
}

const submitTaskTime = async () => {
  const task = taskTimeTarget.value?.task
  if (!task?.id || !taskTimeForm.value.start || !taskTimeForm.value.end) return
  const date = vietnamDateKey(task.scheduledStartAt)
  const startAt = vietnamDateTime(date, taskTimeForm.value.start)
  const endAt = vietnamDateTime(date, taskTimeForm.value.end)
  if (endAt <= startAt) {
    timelineError.value = 'Giờ kết thúc phải sau giờ bắt đầu.'
    return
  }
  updatingTaskTime.value = true
  try {
    await AssignmentService.updateTaskTime(task.id, {
      scheduledStartAt: startAt.toISOString(),
      scheduledEndAt: endAt.toISOString(),
    })
    isTaskTimeOpen.value = false
    await refreshResources()
  } catch (e) {
    timelineError.value = e.message || 'Không thể cập nhật thời gian.'
  } finally {
    updatingTaskTime.value = false
  }
}

const submitAssignment = async () => {
  if (!isFormValid.value) return
  formSaving.value = true
  formError.value = ''
  try {
    const startAt = vietnamDateTime(formDate.value, formStartTime.value)
    const endAt = vietnamDateTime(formDate.value, formEndTime.value)
    await AssignmentService.createTask({
      title: formTitle.value.trim(),
      description: formDesc.value.trim(),
      workStartAt: startAt.toISOString(),
      workEndAt: endAt.toISOString(),
      declaredPoint: Number(formPoint.value),
      sourceDocument: formSourceDocument.value || undefined,
      assigneeId: isSpecialist.value ? undefined : formSelectedUser.value.id,
      submit: isSpecialist.value,
    })
    timelineDate.value = startAt
    await refreshResources()
    resetForm()
    if (!isDesktop) closeForm()
  } catch (e) {
    formError.value = e.message || 'Không thể khai báo công việc.'
  } finally {
    formSaving.value = false
  }
}

const isApprovalOpen = ref(false)
const approvalItems = ref([])
const approvalTab = ref('pending')
const selectedApprovalId = ref('')
const approvalSaving = ref(false)
const approvalError = ref('')
const approvalForm = ref({
  title: '',
  description: '',
  date: '',
  startTime: '',
  endTime: '',
  declaredPoint: '0',
  note: '',
})

const selectedApproval = computed(() => (
  approvalItems.value.find((item) => String(item._id) === String(selectedApprovalId.value)) ?? null
))

const approvalTabs = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'returned', label: 'Đã trả lại' },
]

const declarationStatusMeta = {
  DRAFT: { label: 'Bản nháp', class: 'bg-zinc-100 text-zinc-600' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', class: 'bg-amber-50 text-amber-700' },
  PENDING_REVIEW: { label: 'Chờ duyệt', class: 'bg-amber-50 text-amber-700' },
  APPROVED: { label: 'Đã duyệt', class: 'bg-emerald-50 text-emerald-700' },
  RETURNED: { label: 'Đã trả lại', class: 'bg-rose-50 text-rose-700' },
  REVISION_REQUESTED: { label: 'Đã trả lại', class: 'bg-rose-50 text-rose-700' },
  CANCELLED: { label: 'Đã hủy', class: 'bg-zinc-100 text-zinc-600' },
}

const approvalActionLabel = (action) => ({
  SUBMITTED: 'Gửi duyệt',
  FORWARDED: 'Chuyển duyệt',
  APPROVED: 'Đã duyệt',
  RETURNED: 'Trả lại',
  SELF_APPROVED: 'Tự duyệt',
}[action] ?? action)

const approvalDurationHours = computed(() => {
  const [startHourValue, startMinute] = approvalForm.value.startTime.split(':').map(Number)
  const [endHourValue, endMinute] = approvalForm.value.endTime.split(':').map(Number)
  const minutes = (endHourValue * 60 + endMinute) - (startHourValue * 60 + startMinute)
  return Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 0
})

const isApprovalValid = computed(() => (
  Boolean(selectedApproval.value)
  && approvalForm.value.title.trim().length > 0
  && approvalForm.value.date
  && approvalDurationHours.value > 0
  && Number.isFinite(Number(approvalForm.value.declaredPoint))
  && Number(approvalForm.value.declaredPoint) >= 0
))

const selectApproval = (declaration) => {
  if (!declaration) {
    selectedApprovalId.value = ''
    return
  }
  selectedApprovalId.value = String(declaration._id)
  approvalForm.value = {
    title: declaration.title ?? '',
    description: declaration.description ?? '',
    date: vietnamDateKey(declaration.workStartAt),
    startTime: vietnamTime(declaration.workStartAt),
    endTime: vietnamTime(declaration.workEndAt),
    declaredPoint: String(declaration.declaredPoint ?? 0),
    note: '',
  }
  approvalError.value = ''
}

const reloadPendingApprovals = async () => {
  if (!canApprove.value) {
    pendingApprovals.value = []
    pendingApprovalCount.value = 0
    return
  }
  const result = await AssignmentService.listPendingApprovals()
  pendingApprovals.value = result?.data ?? []
  pendingApprovalCount.value = Number(result?.summary?.pendingApproval ?? pendingApprovals.value.length)
}

const loadApprovalItems = async (tab = approvalTab.value) => {
  const result = await AssignmentService.listApprovals(tab)
  approvalItems.value = result?.data ?? []
  if (tab === 'pending') {
    pendingApprovals.value = approvalItems.value
    pendingApprovalCount.value = Number(result?.summary?.pendingApproval ?? approvalItems.value.length)
  }
  selectApproval(approvalItems.value[0])
}

const changeApprovalTab = async (tab) => {
  if (approvalTab.value === tab) return
  approvalTab.value = tab
  approvalError.value = ''
  try {
    await loadApprovalItems(tab)
  } catch (error) {
    approvalItems.value = []
    selectedApprovalId.value = ''
    approvalError.value = error.message || 'Không thể tải lịch sử duyệt.'
  }
}

const openApprovalPanel = async () => {
  isFormOpen.value = false
  isAiModalOpen.value = false
  isApprovalOpen.value = true
  approvalError.value = ''
  try {
    await reloadPendingApprovals()
    approvalTab.value = 'pending'
    await loadApprovalItems('pending')
  } catch (error) {
    approvalError.value = error.message || 'Không thể tải danh sách chờ duyệt.'
  }
}

const closeApprovalPanel = () => {
  isApprovalOpen.value = false
  selectedApprovalId.value = ''
  approvalError.value = ''
}

const submitApproval = async () => {
  if (!isApprovalValid.value || approvalSaving.value) return
  approvalSaving.value = true
  approvalError.value = ''
  try {
    const startAt = vietnamDateTime(approvalForm.value.date, approvalForm.value.startTime)
    const endAt = vietnamDateTime(approvalForm.value.date, approvalForm.value.endTime)
    await AssignmentService.approveTask(selectedApprovalId.value, {
      title: approvalForm.value.title.trim(),
      description: approvalForm.value.description.trim(),
      workStartAt: startAt.toISOString(),
      workEndAt: endAt.toISOString(),
      declaredPoint: Number(approvalForm.value.declaredPoint),
      note: approvalForm.value.note.trim() || undefined,
    })
    await refreshResources()
    await loadApprovalItems(approvalTab.value)
  } catch (error) {
    approvalError.value = error.message || 'Không thể duyệt công việc.'
  } finally {
    approvalSaving.value = false
  }
}

const formatApprovalDateTime = (value) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value))

watch(approvalItems, (items) => {
  if (!isApprovalOpen.value) return
  const currentStillExists = items.some((item) => String(item._id) === String(selectedApprovalId.value))
  if (!currentStillExists) selectApproval(items[0])
})

// --- AI CHAT STATE ---
const aiInputText = ref('')
const isAiTyping = ref(false)
const isAiHistoryLoading = ref(false)
const isRecordingVoice = ref(false)
const aiCurrentDraft = ref(null)
const activeAiConfirmationToken = ref('')
const aiConfirmingToken = ref('')
const confirmedAiTokens = ref([])
const cancelledAiTokens = ref([])
const aiChatScroll = ref(null)
let aiAbortController = null
let aiScrollFrame = null
let aiHistoryPromise = null
const initialAiMessage = () => ({
  id: 'welcome',
  role: 'ai',
  type: 'text',
  content: 'Mình có thể giúp bạn khai báo công việc hoặc tra cứu nhân sự, công việc và văn bản trong phạm vi bạn được phép xem.',
})
const aiMessages = ref([
  {
    ...initialAiMessage(),
  }
])

const aiMessageFromHistory = (item) => {
  const metadata = item?.metadata ?? {}
  const message = {
    id: item?._id,
    role: item?.role === 'user' ? 'user' : 'ai',
    type: 'text',
    content: String(item?.content ?? ''),
    metadata,
  }
  if (message.role === 'ai' && metadata.kind === 'TASK_PROPOSAL' && metadata.proposal) {
    message.type = 'proposal'
    message.proposal = metadata.proposal
  }
  return message
}

const restoreAiChatState = (messages) => {
  const latestTaskMessage = [...messages].reverse().find((message) => (
    message.role === 'ai'
      && message.metadata?.intent === 'TASK'
      && message.metadata?.draft
      && (message.proposal?.status === 'PENDING' || message.metadata.draft.complete === false)
  ))
  const pendingProposal = [...messages].reverse().find((message) => (
    message.role === 'ai' && message.proposal?.status === 'PENDING' && message.proposal?.confirmationToken
  ))
  aiCurrentDraft.value = latestTaskMessage?.metadata?.draft ?? null
  activeAiConfirmationToken.value = pendingProposal?.proposal?.confirmationToken ?? ''
  aiConfirmingToken.value = ''
}

const loadAiChatHistory = async () => {
  if (isAiTyping.value) return
  if (aiHistoryPromise) return aiHistoryPromise
  isAiHistoryLoading.value = true
  aiHistoryPromise = AssignmentService.getAiChatSession()
    .then((result) => {
      const contents = result?.data?.contents ?? []
      const messages = contents.map(aiMessageFromHistory)
      aiMessages.value = messages.length ? messages : [initialAiMessage()]
      restoreAiChatState(aiMessages.value)
      scrollAiChatToBottom()
    })
    .catch(() => {
      // The assistant remains usable when history cannot be loaded.
    })
    .finally(() => {
      isAiHistoryLoading.value = false
      aiHistoryPromise = null
    })
  return aiHistoryPromise
}

const scrollAiChatToBottom = () => {
  if (aiScrollFrame) return
  aiScrollFrame = window.requestAnimationFrame(() => {
    aiScrollFrame = null
    nextTick(() => {
      const container = aiChatScroll.value
      if (container) container.scrollTop = container.scrollHeight
    })
  })
}

const openAiModal = () => {
  isRecordingVoice.value = false
  isAiTyping.value = false
  isAiModalOpen.value = true
  if (!isAiTyping.value) void loadAiChatHistory()
  scrollAiChatToBottom()
}

const closeAiModal = () => {
  isAiModalOpen.value = false
  setTimeout(() => {
    isRecordingVoice.value = false
  }, 400)
}

const toggleVoice = () => {
  isRecordingVoice.value = !isRecordingVoice.value
}

const normalizeAiCommand = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const isAiConfirmationText = (value) => new Set([
  'xac nhan', 'ok', 'okay', 'dong y', 'trien', 'trien khai', 'tao viec', 'gui di', 'chot',
]).has(normalizeAiCommand(value))

const isAiCancellationText = (value) => new Set([
  'huy', 'cancel', 'thoi', 'bo qua', 'khong tao', 'khong tao nua', 'dung lai', 'huy task', 'huy viec',
]).has(normalizeAiCommand(value))

const aiDisplayDate = (value) => {
  const raw = String(value ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.split('-').reverse().join('/')
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

const formatAiConfirmedMessage = (data, draft) => {
  const declaration = data?.declaration ?? {}
  const startAt = declaration.workStartAt
  const endAt = declaration.workEndAt
  const title = declaration.title ?? draft?.title
  const description = declaration.description ?? draft?.description
  const date = startAt ? aiDisplayDate(startAt) : aiDisplayDate(draft?.date)
  const startTime = startAt ? vietnamTime(startAt) : draft?.startTime
  const endTime = endAt ? vietnamTime(endAt) : draft?.endTime
  const point = declaration.declaredPoint ?? draft?.point
  const status = data?.submissionError
    ? 'Đã tạo, chưa gửi duyệt'
    : declaration.status === 'PENDING_APPROVAL'
      ? 'Chờ duyệt'
      : declaration.status === 'APPROVED'
        ? 'Đã duyệt'
        : data?.alreadyConfirmed
          ? 'Đã xác nhận trước đó'
          : 'Đã tạo'
  const lines = [
    data?.alreadyConfirmed ? 'Công việc đã được xác nhận:' : 'Đã xác nhận công việc:',
    `- Tên việc: ${title || 'Chưa có'}`,
  ]
  if (description) lines.push(`- Mô tả: ${description}`)
  lines.push(
    `- Ngày: ${date || 'Chưa có'}`,
    `- Giờ bắt đầu: ${startTime || 'Chưa có'}`,
    `- Giờ kết thúc: ${endTime || 'Chưa có'}`,
    `- Điểm: ${point ?? 0}`,
    `- Trạng thái: ${status}`,
  )
  return lines.join('\n')
}

const isAiProposalDisabled = (message) => {
  const token = message?.proposal?.confirmationToken
  return message?.proposal?.status && message.proposal.status !== 'PENDING'
    || isAiTyping.value
    || !token
    || token !== activeAiConfirmationToken.value
    || token === aiConfirmingToken.value
    || confirmedAiTokens.value.includes(token)
    || cancelledAiTokens.value.includes(token)
}

const aiProposalActionLabel = (message) => {
  const token = message?.proposal?.confirmationToken
  if (message?.proposal?.status === 'CANCELLED') return 'Đã hủy'
  if (message?.proposal?.status === 'REPLACED') return 'Đã thay thế'
  if (message?.proposal?.status === 'CONFIRMED') return 'Đã xác nhận'
  if (cancelledAiTokens.value.includes(token)) return 'Đã hủy'
  if (confirmedAiTokens.value.includes(token)) return 'Đã xác nhận'
  if (aiConfirmingToken.value === token) return 'Đang xác nhận...'
  if (activeAiConfirmationToken.value !== token) return 'Đã thay thế'
  return 'Xác nhận'
}

const sendAiMessage = async (text, confirmationToken = '') => {
  const content = String(text ?? '').trim()
  if (!content || isAiTyping.value || isAiHistoryLoading.value) return
  const userMessage = { id: Date.now(), role: 'user', type: 'text', content }
  const assistantMessage = reactive({
    id: Date.now() + 1,
    role: 'ai',
    type: 'text',
    content: '',
    streaming: true,
  })
  aiMessages.value.push(userMessage, assistantMessage)
  scrollAiChatToBottom()
  isAiTyping.value = true
  isRecordingVoice.value = false
  aiAbortController = new AbortController()
  let streamError = null

  try {
    await AssignmentService.streamAiChat({
      message: content,
      proposalToken: confirmationToken || undefined,
    }, (event, data) => {
      if (event === 'delta') {
        assistantMessage.content += data.text ?? ''
        scrollAiChatToBottom()
      } else if (event === 'draft') {
        if (data.intent === 'TASK') {
          aiCurrentDraft.value = data
          if (data.complete && data.confirmationToken) {
            activeAiConfirmationToken.value = data.confirmationToken
            assistantMessage.type = 'proposal'
            assistantMessage.proposal = { ...data, status: 'PENDING' }
          } else {
            activeAiConfirmationToken.value = ''
          }
        }
        scrollAiChatToBottom()
      } else if (event === 'confirmed') {
        const token = confirmationToken || activeAiConfirmationToken.value
        const confirmedDraft = aiCurrentDraft.value
        if (token && !confirmedAiTokens.value.includes(token)) confirmedAiTokens.value.push(token)
        activeAiConfirmationToken.value = ''
        aiCurrentDraft.value = null
        const proposalMessage = aiMessages.value.find((message) => message.proposal?.confirmationToken === token)
        if (proposalMessage?.proposal) proposalMessage.proposal.status = 'CONFIRMED'
        assistantMessage.content = data.message || formatAiConfirmedMessage(data, confirmedDraft)
        refreshResources()
        scrollAiChatToBottom()
      } else if (event === 'cancelled') {
        const token = data.proposalToken || confirmationToken || activeAiConfirmationToken.value
        if (token && !cancelledAiTokens.value.includes(token)) cancelledAiTokens.value.push(token)
        activeAiConfirmationToken.value = ''
        aiCurrentDraft.value = null
        aiMessages.value.forEach((message) => {
          if (message.proposal?.status === 'PENDING' && (!token || message.proposal.confirmationToken === token)) {
            message.proposal.status = 'CANCELLED'
          }
        })
        assistantMessage.content = data.message || (data.cancelled
          ? 'Đã hủy yêu cầu tạo công việc.'
          : 'Hiện không có công việc nào chờ xác nhận.')
        scrollAiChatToBottom()
      } else if (event === 'error') {
        streamError = new Error(data.message || 'Trợ lý AI gặp lỗi.')
      }
    }, aiAbortController.signal)
    if (streamError) throw streamError
  } catch (error) {
    if (error?.name !== 'AbortError') {
      assistantMessage.content = error.message || 'Không thể kết nối trợ lý AI.'
      assistantMessage.error = true
    }
  } finally {
    assistantMessage.streaming = false
    isAiTyping.value = false
    if (aiConfirmingToken.value === confirmationToken) aiConfirmingToken.value = ''
    aiAbortController = null
    scrollAiChatToBottom()
  }
}

const handleAiSubmit = () => {
  const content = aiInputText.value.trim() || (isRecordingVoice.value ? 'Ghi âm yêu cầu' : '')
  if (!content) return
  aiInputText.value = ''
  const isConfirmation = isAiConfirmationText(content)
  const isCancellation = isAiCancellationText(content)
  const proposalToken = isConfirmation || isCancellation ? activeAiConfirmationToken.value : ''
  if (isConfirmation && proposalToken) aiConfirmingToken.value = proposalToken
  sendAiMessage(content, proposalToken)
}

const confirmAiProposal = (message) => {
  if (isAiProposalDisabled(message)) return
  const token = message.proposal.confirmationToken
  aiConfirmingToken.value = token
  sendAiMessage('Xác nhận', token)
}

onBeforeUnmount(() => {
  aiAbortController?.abort()
  if (aiScrollFrame) window.cancelAnimationFrame(aiScrollFrame)
})
</script>

<template>
  <div class="h-full w-full flex bg-zinc-50/30 font-sans text-zinc-900 overflow-hidden relative">
    
    <!-- LEFT/MAIN: Dashboard & Timeline -->
    <div class="flex-1 flex flex-col overflow-y-auto hide-scrollbar 2xl:border-r border-zinc-200/50 min-w-0">
      
      <!-- Top Overview Header -->
      <header class="px-4 sm:px-6 2xl:px-8 pt-5 sm:pt-6 2xl:pt-8 pb-5 flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight truncate">Lịch công việc</h1>
          <p class="text-zinc-500 text-sm mt-1 font-medium hidden sm:block">Khai báo công việc và theo dõi lịch trình chuyên viên</p>
        </div>

        <div class="ml-auto flex shrink-0 items-center justify-end gap-3">
          <Button v-if="canApprove" variant="outline" @click="openApprovalPanel"
                  class="relative h-9 rounded-full gap-2 border-zinc-200 bg-white px-4 text-xs font-bold text-zinc-700 hover:bg-zinc-50 shrink-0">
            <ClipboardCheck class="h-4 w-4 text-emerald-600" />
            Duyệt
            <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold text-white"
                  :class="pendingApprovalCount ? 'bg-rose-500' : 'bg-zinc-400'">
              {{ pendingApprovalCount }}
            </span>
          </Button>

          <!-- Mobile Buttons (<2xl) -->
          <div class="flex items-center gap-3 shrink-0 2xl:hidden">
            <Button @click="closeForm(); openAiModal()" class="h-9 rounded-full gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold px-4 whitespace-nowrap border border-indigo-200/50">
              <Sparkles class="w-4 h-4" /> Giao việc bằng AI
            </Button>
            <Button @click="closeAiModal(); openForm()" class="h-9 rounded-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 whitespace-nowrap">
              <Plus class="w-4 h-4" /> Khai báo việc
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
                   class="px-3 sm:px-6 py-3 flex items-center justify-between gap-2 border-b border-zinc-50 hover:bg-zinc-50/50 transition-[height,background-color] bg-white shrink-0"
                   :class="isSpecialist ? 'h-[180px]' : 'h-[88px]'">
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
                     class="relative border-b border-zinc-50 hover:bg-zinc-50/50 transition-[height,background-color] group shrink-0 touch-none"
                     :class="[isSpecialist ? 'h-[180px]' : 'h-[88px]', canCreateForAssignee(user) ? 'cursor-crosshair' : 'cursor-default']"
                     @pointerdown="startCreatePointer($event, user)">
                  <!-- Grid lines -->
                  <div class="absolute inset-0 flex pointer-events-none">
                    <div v-for="i in hourMarks.length" :key="i" class="flex-1 border-r border-zinc-100/50 border-dashed"></div>
                  </div>
                  
                  <!-- Task Blocks -->
                  <div class="absolute inset-0" :class="isSpecialist ? 'top-6 bottom-6' : 'top-2 bottom-2'">
                    <div v-if="timelineCreate && String(timelineCreate.assignee.id) === String(user.id)"
                         class="absolute top-0 bottom-0 rounded-lg border border-dashed border-indigo-400 bg-indigo-100/70 pointer-events-none z-20"
                         :style="getTaskPosition(timelineMinutesToTime(timelineCreate.start), timelineMinutesToTime(timelineCreate.end))">
                      <span class="absolute inset-0 flex items-center px-3 text-[11px] font-bold text-indigo-700 whitespace-nowrap overflow-hidden">
                        {{ timelineMinutesToTime(timelineCreate.start) }} - {{ timelineMinutesToTime(timelineCreate.end) }}
                      </span>
                    </div>
                    <div v-for="task in user.tasks" :key="task.blockId"
                         data-task-block
                         class="group/task absolute top-0 bottom-0 rounded-lg flex items-center transition-colors select-none touch-none shadow-[0_1px_3px_rgba(0,0,0,0.02)]"
                         :title="`${task.name} · ${task.start} - ${task.end}`"
                         @pointerdown="startTaskPointer($event, task, user, 'move')"
                         @click="handleTaskClick(task, user)"
                         :class="{
                           'bg-emerald-100/60 text-emerald-800 border border-emerald-200/60': task.type === 'safe',
                           'bg-indigo-50 text-indigo-700 border border-indigo-100': task.type === 'safe-light',
                           'bg-amber-100/60 text-amber-900 border border-amber-200/60': task.type === 'busy',
                           'bg-rose-100/70 text-rose-900 border border-rose-200/80': task.type === 'overload',
                           'bg-rose-50 text-rose-800 border border-dashed border-rose-300': task.type === 'overload-dashed',
                           'opacity-60': timelineSavingTaskId === task.id,
                           'overflow-visible px-0 z-20 hover:z-50': isCompactTask(task),
                           'overflow-hidden px-3': !isCompactTask(task),
                           'cursor-grab active:cursor-grabbing': task.editable,
                           'cursor-default': !task.editable
                         }"
                         :style="getTaskPosition(task.start, task.end)"
                    >
                      <span v-if="task.editable" role="separator" aria-label="Kéo để đổi giờ bắt đầu" title="Đổi giờ bắt đầu" class="absolute inset-y-0 left-0 z-10 w-2.5 cursor-ew-resize" @pointerdown.stop="startTaskPointer($event, task, user, 'resize-start')" @click.stop></span>
                      <div v-if="!isCompactTask(task)" class="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden pointer-events-none">
                        <span class="truncate text-[12px] font-bold leading-tight">{{ task.name }}</span>
                        <span class="truncate text-[10px] font-semibold opacity-75">{{ task.start }} - {{ task.end }} · {{ task.declaredPoint ?? 0 }} điểm · {{ declarationStatusMeta[task.rawStatus || task.status]?.label }}</span>
                        <span class="truncate text-[10px] font-medium opacity-65">{{ task.description || 'Không có mô tả' }}</span>
                      </div>
                      <div v-else class="pointer-events-none absolute left-full top-1/2 z-50 ml-2 w-max max-w-[220px] -translate-y-1/2 rounded-md border border-zinc-200 bg-zinc-900 px-2.5 py-1.5 text-white opacity-0 shadow-lg transition-opacity group-hover/task:opacity-100">
                        <p class="truncate text-[11px] font-bold">{{ task.name }}</p>
                        <p class="mt-0.5 whitespace-nowrap text-[10px] font-medium text-zinc-300">{{ task.start }} - {{ task.end }} · {{ task.declaredPoint ?? 0 }} điểm</p>
                      </div>
                      <span v-if="task.editable" role="separator" aria-label="Kéo để đổi giờ kết thúc" title="Đổi giờ kết thúc" class="absolute inset-y-0 right-0 z-10 w-2.5 cursor-ew-resize" @pointerdown.stop="startTaskPointer($event, task, user, 'resize-end')" @click.stop></span>
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
      <div v-if="isFormOpen || isAiModalOpen || isApprovalOpen" class="fixed inset-0 bg-zinc-900/40 z-[60]" :class="{ '2xl:hidden': !isApprovalOpen }" @click="closeForm(); closeAiModal(); closeApprovalPanel()"></div>
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
            <div ref="aiChatScroll" class="flex-1 min-h-0 overflow-y-auto hide-scrollbar p-6 bg-zinc-50/50 flex flex-col gap-6">
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
                    <div v-if="msg.content" class="whitespace-pre-line bg-white border border-zinc-100 text-zinc-800 px-5 py-3 rounded-2xl rounded-tl-sm text-[13px] font-medium leading-relaxed shadow-sm self-start">
                      {{ msg.content }}
                    </div>
                    <div v-else-if="msg.streaming" class="h-[42px] self-start rounded-2xl rounded-tl-sm border border-zinc-100 bg-white px-5 py-3.5 shadow-sm">
                      <div class="flex items-center gap-1.5">
                        <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-300"></span>
                        <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-300" style="animation-delay: 0.1s"></span>
                        <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-300" style="animation-delay: 0.2s"></span>
                      </div>
                    </div>
                    <!-- Proposal Card -->
                    <div v-if="msg.type === 'proposal'" class="flex w-full flex-col gap-4 rounded-lg border border-indigo-100 bg-white p-4 shadow-md shadow-indigo-900/5">
                      <p class="text-[10px] font-extrabold uppercase tracking-wide text-indigo-500">Thông tin task</p>
                      <div class="divide-y divide-zinc-100 text-xs">
                        <div class="flex gap-3 py-2 first:pt-0"><span class="w-24 shrink-0 font-semibold text-zinc-400">Tên việc</span><strong class="text-zinc-800">{{ msg.proposal.title }}</strong></div>
                        <div v-if="msg.proposal.description" class="flex gap-3 py-2"><span class="w-24 shrink-0 font-semibold text-zinc-400">Mô tả</span><span class="text-zinc-700">{{ msg.proposal.description }}</span></div>
                        <div class="flex gap-3 py-2"><span class="w-24 shrink-0 font-semibold text-zinc-400">Ngày</span><strong class="text-zinc-800">{{ aiDisplayDate(msg.proposal.date) }}</strong></div>
                        <div class="flex gap-3 py-2"><span class="w-24 shrink-0 font-semibold text-zinc-400">Giờ bắt đầu</span><strong class="text-zinc-800">{{ msg.proposal.startTime }}</strong></div>
                        <div class="flex gap-3 py-2"><span class="w-24 shrink-0 font-semibold text-zinc-400">Giờ kết thúc</span><strong class="text-zinc-800">{{ msg.proposal.endTime }}</strong></div>
                        <div class="flex gap-3 py-2 last:pb-0"><span class="w-24 shrink-0 font-semibold text-zinc-400">Điểm</span><strong class="text-zinc-800">{{ msg.proposal.point }}</strong></div>
                      </div>
                      <div class="flex items-center justify-end border-t border-zinc-100 pt-3">
                        <Button @click="confirmAiProposal(msg)" :disabled="isAiProposalDisabled(msg)"
                                class="h-9 rounded-full bg-indigo-600 px-4 text-[11px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none">
                          <CheckCircle class="mr-1.5 h-3.5 w-3.5" />
                          {{ aiProposalActionLabel(msg) }}
                        </Button>
                      </div>
                    </div>
                  </div>
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
                    :disabled="isRecordingVoice || isAiTyping"
                    class="flex-1 bg-transparent outline-none text-[13px] font-medium text-zinc-800 placeholder:text-zinc-400 min-w-0 disabled:opacity-80"
                  />
                  <div class="flex items-center gap-1 shrink-0">
                    <button @click="toggleVoice" :title="isRecordingVoice ? 'Tắt thu âm' : 'Ra lệnh bằng giọng nói'" class="w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0" :class="isRecordingVoice ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' : 'text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50'">
                      <X v-if="isRecordingVoice" class="w-4 h-4" />
                      <Mic v-else class="w-4 h-4" />
                    </button>
                    <button @click="handleAiSubmit" :disabled="isAiTyping" class="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-700 flex items-center justify-center text-white transition-colors shadow-sm ml-1 shrink-0" :class="{'opacity-50 pointer-events-none': (!aiInputText.trim() && !isRecordingVoice) || isAiTyping}">
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
              <h2 class="text-xl font-bold text-zinc-900">Khai báo công việc</h2>
              <button type="button" @click.stop="closeForm" aria-label="Đóng bảng giao việc" class="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-500 transition-colors 2xl:hidden shrink-0">
                <X class="w-4 h-4" />
              </button>
            </div>

            <!-- Body -->
            <div class="p-6 2xl:p-8 pb-28 2xl:pb-28 flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto hide-scrollbar">
              
              <!-- Người thực hiện -->
              <div v-if="!isSpecialist" class="space-y-2.5">
                <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Người thực hiện</label>
                <div v-if="formSelectedUser" class="flex h-14 items-center gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50 px-4">
                  <Avatar class="h-8 w-8 border border-zinc-100"><AvatarImage :src="formSelectedUser.avatar" /><AvatarFallback>{{ formSelectedUser.name?.[0] }}</AvatarFallback></Avatar>
                  <div class="min-w-0"><p class="truncate text-sm font-bold text-zinc-900">{{ formSelectedUser.name }}</p><p class="truncate text-[10px] font-semibold text-zinc-500">{{ formSelectedUser.role }}</p></div>
                  <span class="ml-auto shrink-0 rounded-full bg-zinc-200 px-2 py-1 text-[9px] font-bold uppercase text-zinc-500">Đã khóa</span>
                </div>
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

              <div class="space-y-2.5">
                <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Điểm</label>
                <Input v-model="formPoint" type="number" min="0" step="0.5" class="h-11 rounded-xl bg-white border-zinc-200/80 font-semibold" />
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
            <div class="absolute bottom-0 inset-x-0 px-6 2xl:px-8 pt-10 pb-4 bg-gradient-to-t from-white via-white/80 to-transparent flex flex-col gap-3 pointer-events-none">
              <p v-if="formError" class="pointer-events-auto rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{{ formError }}</p>
              <Button class="pointer-events-auto h-12 rounded-full font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:shadow-none" :disabled="formSaving || !isFormValid" @click="submitAssignment">
                {{ isSpecialist ? 'Gửi yêu cầu duyệt' : 'Tạo task' }}
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <Transition name="slide-in-only" :duration="350">
      <aside v-if="isApprovalOpen"
             class="fixed inset-y-0 right-0 z-[70] flex w-full flex-col overflow-hidden border-l border-zinc-200 bg-white shadow-[-14px_0_40px_-18px_rgba(0,0,0,0.25)] sm:w-[720px] xl:w-[860px]">
        <div class="flex h-20 shrink-0 items-center justify-between border-b border-zinc-100 px-5 sm:px-7">
          <div class="min-w-0">
            <div class="flex items-center gap-2.5">
              <ClipboardCheck class="h-5 w-5 text-emerald-600" />
              <h2 class="text-xl font-bold text-zinc-900">Duyệt công việc</h2>
              <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-2 text-[11px] font-extrabold text-white">{{ pendingApprovalCount }}</span>
            </div>
            <p class="mt-1 text-xs font-medium text-zinc-500">Có thể điều chỉnh nội dung trước khi duyệt.</p>
          </div>
          <button type="button" aria-label="Đóng danh sách duyệt" @click="closeApprovalPanel"
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors hover:bg-zinc-200">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="flex shrink-0 items-center gap-1 border-b border-zinc-100 bg-white px-5 py-3 sm:px-7">
          <button v-for="tab in approvalTabs" :key="tab.value" type="button" @click="changeApprovalTab(tab.value)"
                  class="rounded-full px-4 py-2 text-xs font-bold transition-colors"
                  :class="approvalTab === tab.value ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'">
            {{ tab.label }}
            <span v-if="tab.value === 'pending'" class="ml-1 opacity-70">{{ pendingApprovalCount }}</span>
          </button>
        </div>

        <div v-if="approvalItems.length" class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <div class="max-h-52 overflow-y-auto border-b border-zinc-100 bg-zinc-50/70 p-3 md:max-h-none md:border-b-0 md:border-r">
            <button v-for="item in approvalItems" :key="item._id" type="button" @click="selectApproval(item)"
                    class="mb-2 w-full rounded-lg border p-3 text-left transition-colors last:mb-0"
                    :class="String(selectedApprovalId) === String(item._id) ? 'border-indigo-200 bg-white shadow-sm' : 'border-transparent hover:border-zinc-200 hover:bg-white'">
              <div class="flex items-start justify-between gap-2">
                <p class="line-clamp-2 text-sm font-bold text-zinc-900">{{ item.title }}</p>
                <span class="shrink-0 rounded-full px-2 py-1 text-[9px] font-extrabold uppercase"
                      :class="declarationStatusMeta[item.status]?.class">
                  {{ declarationStatusMeta[item.status]?.label || item.status }}
                </span>
              </div>
              <p class="mt-2 truncate text-xs font-semibold text-zinc-600">{{ item.createdBy?.fullName || item.createdBy?.username }}</p>
              <p class="mt-1 text-[10px] font-medium text-zinc-400">{{ formatApprovalDateTime(item.workStartAt) }} - {{ vietnamTime(item.workEndAt) }}</p>
            </button>
          </div>

          <div v-if="selectedApproval" class="flex min-h-0 flex-col bg-white">
            <div class="flex-1 overflow-y-auto p-5 sm:p-7">
              <div class="mb-6 flex items-center justify-between gap-4 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3">
                <div class="min-w-0">
                  <p class="text-[10px] font-bold uppercase text-zinc-400">Người khai báo</p>
                  <p class="mt-1 truncate text-sm font-bold text-zinc-900">{{ selectedApproval.createdBy?.fullName || selectedApproval.createdBy?.username }}</p>
                  <p class="mt-0.5 truncate text-xs font-medium text-zinc-500">{{ selectedApproval.createdBy?.position || selectedApproval.department?.name }}</p>
                </div>
                <div class="shrink-0 text-right">
                  <p class="text-[10px] font-bold uppercase text-zinc-400">Gửi lúc</p>
                  <p class="mt-1 text-xs font-semibold text-zinc-700">{{ formatApprovalDateTime(selectedApproval.approval?.submittedAt || selectedApproval.createdAt) }}</p>
                </div>
              </div>

              <div class="grid gap-5 sm:grid-cols-2">
                <div class="space-y-2 sm:col-span-2">
                  <label class="text-[11px] font-bold uppercase text-zinc-500">Tên công việc</label>
                  <Input v-model="approvalForm.title" :disabled="approvalTab !== 'pending'" class="h-11 rounded-lg" />
                </div>
                <div class="space-y-2 sm:col-span-2">
                  <label class="text-[11px] font-bold uppercase text-zinc-500">Mô tả</label>
                  <Textarea v-model="approvalForm.description" :disabled="approvalTab !== 'pending'" class="h-28 resize-none rounded-lg" />
                </div>
                <div class="space-y-2">
                  <label class="text-[11px] font-bold uppercase text-zinc-500">Ngày làm việc</label>
                  <Input v-model="approvalForm.date" type="date" :disabled="approvalTab !== 'pending'" class="h-11 rounded-lg" />
                </div>
                <div class="space-y-2">
                  <label class="text-[11px] font-bold uppercase text-zinc-500">Điểm</label>
                  <Input v-model="approvalForm.declaredPoint" type="number" min="0" step="0.5" :disabled="approvalTab !== 'pending'" class="h-11 rounded-lg" />
                </div>
                <div class="space-y-2">
                  <label class="text-[11px] font-bold uppercase text-zinc-500">Bắt đầu</label>
                  <Input v-model="approvalForm.startTime" type="time" step="900" :disabled="approvalTab !== 'pending'" class="h-11 rounded-lg" />
                </div>
                <div class="space-y-2">
                  <label class="text-[11px] font-bold uppercase text-zinc-500">Kết thúc</label>
                  <Input v-model="approvalForm.endTime" type="time" step="900" :disabled="approvalTab !== 'pending'" class="h-11 rounded-lg" />
                </div>
                <div v-if="approvalTab === 'pending'" class="space-y-2 sm:col-span-2">
                  <label class="text-[11px] font-bold uppercase text-zinc-500">Ghi chú duyệt</label>
                  <Textarea v-model="approvalForm.note" placeholder="Ghi chú cho người khai báo..." class="h-20 resize-none rounded-lg" />
                </div>
              </div>

              <div class="mt-7 border-t border-zinc-100 pt-6">
                <h3 class="text-sm font-bold text-zinc-900">Lịch sử duyệt</h3>
                <div v-if="selectedApproval.approval?.history?.length" class="mt-4 space-y-0">
                  <div v-for="(history, index) in selectedApproval.approval.history" :key="`${history.actedAt}-${index}`" class="relative flex gap-3 pb-5 last:pb-0">
                    <div v-if="index < selectedApproval.approval.history.length - 1" class="absolute bottom-0 left-[5px] top-3 w-px bg-zinc-200"></div>
                    <span class="relative mt-1.5 h-3 w-3 shrink-0 rounded-full bg-indigo-500 ring-4 ring-indigo-50"></span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-3">
                        <p class="text-xs font-bold text-zinc-800">{{ approvalActionLabel(history.action) }}</p>
                        <time class="shrink-0 text-[10px] font-medium text-zinc-400">{{ formatApprovalDateTime(history.actedAt) }}</time>
                      </div>
                      <p class="mt-1 text-xs font-medium text-zinc-500">{{ history.actor?.fullName || history.actor?.username || 'Hệ thống' }}</p>
                      <p v-if="history.toApprover?.fullName" class="mt-1 text-[11px] text-zinc-500">Chuyển đến: {{ history.toApprover.fullName }}</p>
                      <p v-if="history.note" class="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{{ history.note }}</p>
                    </div>
                  </div>
                </div>
                <p v-else class="mt-3 text-xs font-medium text-zinc-400">Chưa có lịch sử duyệt.</p>
              </div>
            </div>

            <div v-if="approvalTab === 'pending'" class="shrink-0 border-t border-zinc-100 bg-white px-5 py-4 sm:px-7">
              <p v-if="approvalError" class="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{{ approvalError }}</p>
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs font-semibold text-zinc-500">Thời lượng: {{ approvalDurationHours.toFixed(1) }} giờ</p>
                <Button class="h-11 rounded-full bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-700"
                        :disabled="approvalSaving || !isApprovalValid" @click="submitApproval">
                  <ClipboardCheck class="mr-2 h-4 w-4" />
                  {{ approvalSaving ? 'Đang duyệt...' : 'Duyệt task' }}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div class="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><ClipboardCheck class="h-7 w-7" /></div>
          <p class="mt-4 text-base font-bold text-zinc-900">Không có dữ liệu {{ approvalTabs.find(tab => tab.value === approvalTab)?.label.toLowerCase() }}</p>
          <p class="mt-1 text-sm font-medium text-zinc-500">Danh sách sẽ tự cập nhật khi trạng thái công việc thay đổi.</p>
          <p v-if="approvalError" class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{{ approvalError }}</p>
        </div>
      </aside>
    </Transition>

    <Dialog v-model:open="isTaskTimeOpen">
      <DialogContent class="max-h-[88vh] max-w-2xl overflow-hidden rounded-2xl p-0">
        <div class="border-b border-zinc-100 px-6 py-5">
          <div class="flex items-start justify-between gap-4 pr-8">
            <div class="min-w-0">
              <DialogTitle class="text-xl font-bold leading-tight text-zinc-900">{{ taskTimeTarget?.task?.name }}</DialogTitle>
              <p class="mt-1 text-sm font-medium text-zinc-500">Chi tiết công việc</p>
            </div>
            <span v-if="taskTimeTarget?.task" class="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase"
                  :class="declarationStatusMeta[taskTimeTarget.task.rawStatus || taskTimeTarget.task.status]?.class">
              {{ declarationStatusMeta[taskTimeTarget.task.rawStatus || taskTimeTarget.task.status]?.label || taskTimeTarget.task.status }}
            </span>
          </div>
        </div>

        <div class="max-h-[calc(88vh-150px)] overflow-y-auto px-6 py-5">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3">
              <p class="text-[10px] font-bold uppercase text-zinc-400">Người thực hiện</p>
              <p class="mt-1 truncate text-sm font-bold text-zinc-900">{{ taskTimeTarget?.assignee?.name }}</p>
              <p class="mt-0.5 truncate text-xs text-zinc-500">{{ taskTimeTarget?.assignee?.role }}</p>
            </div>
            <div class="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3">
              <p class="text-[10px] font-bold uppercase text-zinc-400">Thời gian</p>
              <p class="mt-1 text-sm font-bold text-zinc-900">{{ taskTimeTarget?.task?.start }} - {{ taskTimeTarget?.task?.end }}</p>
              <p class="mt-0.5 text-xs text-zinc-500">{{ taskTimeTarget?.task?.estimatedMinutes }} phút</p>
            </div>
            <div class="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3">
              <p class="text-[10px] font-bold uppercase text-zinc-400">Điểm</p>
              <p class="mt-1 text-sm font-bold text-zinc-900">{{ taskTimeTarget?.task?.declaredPoint ?? 0 }} điểm</p>
              <p class="mt-0.5 truncate text-xs text-zinc-500">{{ taskTimeTarget?.task?.department?.name || 'Chưa có phòng ban' }}</p>
            </div>
          </div>

          <div class="mt-5">
            <p class="text-[11px] font-bold uppercase text-zinc-500">Mô tả công việc</p>
            <p class="mt-2 whitespace-pre-wrap rounded-lg border border-zinc-100 px-4 py-3 text-sm leading-relaxed text-zinc-700">{{ taskTimeTarget?.task?.description || 'Không có mô tả.' }}</p>
          </div>

          <div v-if="taskTimeTarget?.task?.sourceDocument" class="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
            <p class="text-[10px] font-bold uppercase text-blue-500">Văn bản liên quan</p>
            <p class="mt-1 text-sm font-bold text-blue-900">{{ taskTimeTarget.task.sourceDocument.soKyHieu || 'Văn bản đến' }}</p>
            <p class="mt-1 line-clamp-2 text-xs text-blue-800/70">{{ taskTimeTarget.task.sourceDocument.trichYeu }}</p>
          </div>

          <div v-if="taskTimeTarget?.task?.editable" class="mt-5 rounded-lg border border-zinc-200 p-4">
            <p class="text-[11px] font-bold uppercase text-zinc-500">Điều chỉnh thời gian</p>
            <div class="mt-3 grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <span class="text-xs font-bold text-zinc-500">Bắt đầu</span>
                <Input v-model="taskTimeForm.start" type="time" step="900" class="rounded-lg" />
              </div>
              <div class="space-y-1.5">
                <span class="text-xs font-bold text-zinc-500">Kết thúc</span>
                <Input v-model="taskTimeForm.end" type="time" step="900" class="rounded-lg" />
              </div>
            </div>
          </div>

          <div class="mt-6 border-t border-zinc-100 pt-5">
            <p class="text-sm font-bold text-zinc-900">Lịch sử duyệt</p>
            <div v-if="taskTimeTarget?.task?.approval?.history?.length" class="mt-4 space-y-3">
              <div v-for="(history, index) in taskTimeTarget.task.approval.history" :key="`${history.actedAt}-${index}`" class="flex gap-3">
                <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500"></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <p class="text-xs font-bold text-zinc-800">{{ approvalActionLabel(history.action) }}</p>
                    <time class="shrink-0 text-[10px] text-zinc-400">{{ formatApprovalDateTime(history.actedAt) }}</time>
                  </div>
                  <p class="mt-0.5 text-xs text-zinc-500">{{ history.actor?.fullName || history.actor?.username || 'Hệ thống' }}</p>
                  <p v-if="history.note" class="mt-1.5 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{{ history.note }}</p>
                </div>
              </div>
            </div>
            <p v-else class="mt-2 text-xs font-medium text-zinc-400">Chưa có lịch sử duyệt.</p>
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t border-zinc-100 bg-white px-6 py-4">
          <Button variant="outline" class="rounded-full" @click="isTaskTimeOpen = false">Đóng</Button>
          <Button v-if="taskTimeTarget?.task?.editable" class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white" :disabled="updatingTaskTime" @click="submitTaskTime">
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
