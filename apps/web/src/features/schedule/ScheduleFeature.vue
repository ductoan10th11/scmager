<script setup>
import { ref, reactive, onMounted, computed, watch, nextTick, onUnmounted } from 'vue'
import { 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Settings, 
  Plus, 
  Filter
} from 'lucide-vue-next'
import { today, getLocalTimeZone } from '@internationalized/date'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const viewportRef = ref(null)
const isSidebarOpen = ref(true)

// Core State
const currentView = ref('day') // Default to Day view as requested
const miniCalendarDate = ref(today(getLocalTimeZone()))
const currentTime = ref(new Date())
const transitionDirection = ref('slide-left')

const scrollToFocusedDay = async () => {
  await nextTick()
  setTimeout(() => {
    if (!viewportRef.value) return
    const viewport = viewportRef.value
    const mm = String(focusedMonth.value).padStart(2, '0');
    const dd = String(focusedDay.value).padStart(2, '0');
    const index = visibleDaysArray.value.findIndex(d => d.dateStr === `${focusedYear.value}-${mm}-${dd}`)
    if (index === -1) return

    const stickyWidth = 64 // GMT+7 column is w-16 = 64px
    const scrollContainerWidth = viewport.scrollWidth
    const clientWidth = viewport.clientWidth
    
    const daysContainerWidth = scrollContainerWidth - stickyWidth
    if (daysContainerWidth <= 0) return
    
    const calculatedColWidth = daysContainerWidth / visibleDaysArray.value.length
    const colWidth = Math.max(140, calculatedColWidth)
    const viewableWidth = clientWidth - stickyWidth
    
    let targetLeft = 0
    if (currentView.value === 'week') {
      // Center the day
      const colCenterOffset = (index * colWidth) + (colWidth / 2)
      targetLeft = colCenterOffset - (viewableWidth / 2)
    } else if (currentView.value === 'month') {
      // Align to the left, but leave 1 previous day visible
      targetLeft = (index - 1) * colWidth
    }
    
    if (targetLeft < 0) targetLeft = 0

    // Vertical focus to current time
    const currentHour = new Date().getHours()
    const clientHeight = viewport.clientHeight
    let targetTop = (currentHour * 160) - (clientHeight / 2) + 80 // Center current hour
    if (targetTop < 0) targetTop = 0

    viewport.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' })
  }, 100)
}

const viewOrder = { day: 0, week: 1, month: 2 }

watch(currentView, (newView, oldView) => {
  if (oldView && newView !== oldView) {
    // If moving to a tab on the right (e.g. Day -> Week), camera pans right, content slides left
    if (viewOrder[newView] > viewOrder[oldView]) {
      transitionDirection.value = 'slide-left'
    } else {
      // If moving to a tab on the left (e.g. Week -> Day), camera pans left, content slides right
      transitionDirection.value = 'slide-right'
    }
  }
})

watch(miniCalendarDate, (newDate, oldDate) => {
  if (oldDate && newDate.compare) {
    if (newDate.compare(oldDate) > 0) {
      transitionDirection.value = 'slide-left'
    } else if (newDate.compare(oldDate) < 0) {
      transitionDirection.value = 'slide-right'
    }
  }
})

// Right-click Pan Logic
const isPanning = ref(false)
const panStart = reactive({ x: 0, y: 0 })
const scrollStart = reactive({ left: 0, top: 0 })

const handlePanStart = (e) => {
  if (e.button === 2) { // Right click
    isPanning.value = true
    panStart.x = e.clientX
    panStart.y = e.clientY
    if (viewportRef.value) {
      scrollStart.left = viewportRef.value.scrollLeft
      scrollStart.top = viewportRef.value.scrollTop
    }
    document.body.style.cursor = 'grabbing'
    window.addEventListener('mousemove', handlePanMove)
    window.addEventListener('mouseup', handlePanEnd)
  }
}

const handlePanMove = (e) => {
  if (!isPanning.value || !viewportRef.value) return
  e.preventDefault()
  const dx = e.clientX - panStart.x
  const dy = e.clientY - panStart.y
  viewportRef.value.scrollLeft = scrollStart.left - dx
  viewportRef.value.scrollTop = scrollStart.top - dy
}

const handlePanEnd = (e) => {
  if (e.button === 2 || e.type === 'mouseup') {
    isPanning.value = false
    document.body.style.cursor = ''
    window.removeEventListener('mousemove', handlePanMove)
    window.removeEventListener('mouseup', handlePanEnd)
  }
}

const preventContextMenu = (e) => {
  e.preventDefault()
}

onUnmounted(() => {
  window.removeEventListener('mousemove', handlePanMove)
  window.removeEventListener('mouseup', handlePanEnd)
  document.body.style.cursor = ''
})

// Dynamic Date Extractors
const focusedYear = computed(() => miniCalendarDate.value.year)
const focusedMonth = computed(() => miniCalendarDate.value.month)
const focusedDay = computed(() => miniCalendarDate.value.day)

watch([currentView, focusedYear, focusedMonth, focusedDay], () => {
  scrollToFocusedDay()
}, { immediate: true })

const filters = reactive({
  all: true,
  coquan: true,
  canhan: false,
  events: true,
  congtac: true,
  weekend: true,
  emptyHours: false
})

const visibleDaysArray = computed(() => {
  const days = [];
  let numDays = 1;
  let startOffset = 0;

  const baseDate = new Date(focusedYear.value, focusedMonth.value - 1, focusedDay.value);

  if (currentView.value === 'day') {
    numDays = 1;
    startOffset = 0;
  } else if (currentView.value === 'week') {
    numDays = 7;
    const dayOfWeek = baseDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOffset = diffToMonday;
  } else if (currentView.value === 'month') {
    numDays = new Date(focusedYear.value, focusedMonth.value, 0).getDate();
    startOffset = 1 - focusedDay.value;
  }
  
  for (let i = 0; i < numDays; i++) {
    const d = new Date(focusedYear.value, focusedMonth.value - 1, focusedDay.value + startOffset + i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    days.push({
      date: d,
      day: d.getDate(),
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      dayName: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()],
      id: d.getTime(), // unique identifier
      dateStr: `${d.getFullYear()}-${mm}-${dd}`
    });
  }
  return days;
})

import { globalMockEvents } from '@/mocks/schedule'

const filteredEvents = computed(() => {
  const visibleDateStrs = new Set(visibleDaysArray.value.map(d => d.dateStr));
  return globalMockEvents.value.filter(e => 
    visibleDateStrs.has(e.dateStr) && 
    e.assignee.fullName === 'Nguyễn Văn A'
  );
})

const actualTodayStr = computed(() => {
  const t = today(getLocalTimeZone());
  const mm = String(t.month).padStart(2, '0');
  const dd = String(t.day).padStart(2, '0');
  return `${t.year}-${mm}-${dd}`;
})

const isTodayVisible = computed(() => {
  return visibleDaysArray.value.some(d => d.dateStr === actualTodayStr.value);
})

// Navigation Actions
const handlePrev = () => {
  if (currentView.value === 'day') miniCalendarDate.value = miniCalendarDate.value.subtract({ days: 1 })
  else if (currentView.value === 'week') miniCalendarDate.value = miniCalendarDate.value.subtract({ weeks: 1 })
  else miniCalendarDate.value = miniCalendarDate.value.subtract({ months: 1 })
}

const handleNext = () => {
  if (currentView.value === 'day') miniCalendarDate.value = miniCalendarDate.value.add({ days: 1 })
  else if (currentView.value === 'week') miniCalendarDate.value = miniCalendarDate.value.add({ weeks: 1 })
  else miniCalendarDate.value = miniCalendarDate.value.add({ months: 1 })
}

const handleToday = () => {
  miniCalendarDate.value = today(getLocalTimeZone())
  if (viewportRef.value) {
    viewportRef.value.scrollTop = currentTime.value.getHours() * 160 - 200;
  }
}

// Drag-to-Create Logic
const isDragging = ref(false)
const dragStartY = ref(0)
const dragCurrentY = ref(0)
const draftEventStart = ref(0)
const draftEventEnd = ref(0)
const isCreateModalOpen = ref(false)
const draftEventTitle = ref('')

const handleMouseDown = (e) => {
  if (e.button !== 0) return
  if (currentView.value !== 'day') return
  isDragging.value = true
  const rect = e.currentTarget.getBoundingClientRect()
  const y = e.clientY - rect.top
  dragStartY.value = y
  dragCurrentY.value = y
  updateDraftEvent(y, y)
}

const handleMouseMove = (e) => {
  if (!isDragging.value) return
  const rect = e.currentTarget.getBoundingClientRect()
  let y = e.clientY - rect.top
  y = Math.max(0, Math.min(y, 24 * 160)) // constrain to grid
  dragCurrentY.value = y
  updateDraftEvent(dragStartY.value, y)
}

const handleMouseUp = () => {
  if (!isDragging.value) return
  isDragging.value = false
  isCreateModalOpen.value = true
}

const updateDraftEvent = (startY, endY) => {
  let min = Math.min(startY, endY)
  let max = Math.max(startY, endY)
  
  // Snap to 15 mins (40px)
  min = Math.floor(min / 40) * 40
  max = Math.ceil(max / 40) * 40
  
  if (max === min) max = min + 40 // min 15 mins
  
  draftEventStart.value = min / 160
  draftEventEnd.value = max / 160
}

const formatHour = (hourFloat) => {
  const h = Math.floor(hourFloat)
  const m = Math.round((hourFloat - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const handleSaveDraftEvent = () => {
  if (!draftEventTitle.value.trim()) draftEventTitle.value = 'Cuộc họp mới'
  
  const newEvent = {
    _id: `evt_draft_${Date.now()}`,
    id: `evt_draft_${Date.now()}`,
    title: draftEventTitle.value,
    dateStr: visibleDaysArray.value[0].dateStr,
    startHour: draftEventStart.value,
    duration: draftEventEnd.value - draftEventStart.value,
    type: 'Họp',
    timeStr: `${formatHour(draftEventStart.value)} - ${formatHour(draftEventEnd.value)}`,
    time: `${formatHour(draftEventStart.value)} - ${formatHour(draftEventEnd.value)}`,
    colorClass: 'bg-white border-blue-200 shadow-sm',
    assignee: { fullName: 'Nguyễn Văn A' },
    avatars: [],
    remainingCount: 0
  }
  
  globalMockEvents.value.push(newEvent)
  
  isCreateModalOpen.value = false
  draftEventTitle.value = ''
}

onMounted(() => {
  setInterval(() => {
    currentTime.value = new Date()
  }, 60000)
  
  if (viewportRef.value) {
    viewportRef.value.scrollTop = currentTime.value.getHours() * 160 - 200;
  }
})
</script>

<template>
  <div class="h-full flex flex-col lg:flex-row overflow-hidden bg-white select-none relative min-w-0 min-h-0">
    <!-- Sidebar -->
    <aside 
      class="border-b lg:border-b-0 lg:border-r border-zinc-200/60 bg-zinc-50/40 flex flex-col shrink-0 overflow-x-hidden transition-all duration-300 ease-in-out"
      :class="isSidebarOpen ? 'w-full lg:w-[300px] opacity-100 overflow-y-auto' : 'w-0 opacity-0 pointer-events-none lg:border-none'"
    >
      <!-- Fixed width inner container prevents text wrapping during collapse -->
      <div class="w-[100vw] lg:w-[300px] px-5 py-6 flex flex-col gap-8 shrink-0">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-bold text-zinc-800 uppercase tracking-widest whitespace-nowrap">Bộ lọc lịch</h2>
          <Button variant="ghost" size="icon" class="h-7 w-7 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200/50 rounded-lg shrink-0">
            <Filter class="h-3.5 w-3.5" />
          </Button>
        </div>

        <!-- Filters List -->
        <div class="flex flex-col gap-1">
          <label for="all" class="flex items-center gap-3 px-2 py-2 hover:bg-zinc-100 rounded-xl cursor-pointer group transition-colors">
            <Checkbox id="all" v-model:checked="filters.all" class="rounded-[4px] border-zinc-300 data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 shrink-0" />
            <span class="text-sm font-medium text-zinc-700 group-hover:text-zinc-950 transition-colors flex-1 text-left whitespace-nowrap">Tất cả lịch</span>
          </label>
          <label for="coquan" class="flex items-center gap-3 px-2 py-2 hover:bg-zinc-100 rounded-xl cursor-pointer group transition-colors">
            <Checkbox id="coquan" v-model:checked="filters.coquan" class="rounded-[4px] border-zinc-300 data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 shrink-0" />
            <span class="text-sm font-medium text-zinc-700 group-hover:text-zinc-950 transition-colors flex-1 text-left whitespace-nowrap">Lịch cơ quan</span>
          </label>
          <label for="canhan" class="flex items-center gap-3 px-2 py-2 hover:bg-zinc-100 rounded-xl cursor-pointer group transition-colors">
            <Checkbox id="canhan" v-model:checked="filters.canhan" class="rounded-[4px] border-zinc-300 data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 shrink-0" />
            <span class="text-sm font-medium text-zinc-700 group-hover:text-zinc-950 transition-colors flex-1 text-left whitespace-nowrap">Lịch cá nhân</span>
          </label>
          <label for="events" class="flex items-center gap-3 px-2 py-2 hover:bg-zinc-100 rounded-xl cursor-pointer group transition-colors">
            <Checkbox id="events" v-model:checked="filters.events" class="rounded-[4px] border-zinc-300 data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 shrink-0" />
            <span class="text-sm font-medium text-zinc-700 group-hover:text-zinc-950 transition-colors flex-1 text-left whitespace-nowrap">Họp & Sự kiện</span>
          </label>
        </div>

        <Separator class="bg-zinc-200/50" />

        <!-- Mini Calendar Component -->
        <div class="flex flex-col gap-3">
          <h3 class="text-[10px] font-bold text-zinc-400 tracking-widest uppercase text-left px-2 whitespace-nowrap">Điều hướng</h3>
          <Calendar 
            v-model="miniCalendarDate" 
            class="rounded-2xl border-none bg-transparent p-0 shadow-none [&_.rdp-cell]:text-xs [&_.rdp-head_cell]:text-[10px]" 
          />
        </div>
      </div>
    </aside>

    <!-- Sidebar Toggle Hotzone -->
    <div 
      class="hidden lg:flex absolute top-0 bottom-0 z-50 w-6 cursor-pointer items-center justify-center transition-all duration-300 ease-in-out group"
      :style="{ left: isSidebarOpen ? '288px' : '24px', transform: 'translateX(-50%)' }"
      @click="isSidebarOpen = !isSidebarOpen"
    >
      <Button 
        variant="outline" 
        class="p-0 h-12 w-5 flex items-center justify-center rounded-full border-zinc-200/80 shadow-md bg-white text-zinc-500 group-hover:text-zinc-900 group-hover:scale-105 transition-all pointer-events-none z-10"
      >
        <ChevronLeft v-if="isSidebarOpen" class="h-3.5 w-3.5" />
        <ChevronRight v-else class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- Main Schedule Pane -->
    <div class="flex-1 flex flex-col overflow-hidden bg-white relative min-w-0 min-h-0">

      <!-- Calendar Top Bar -->
      <div class="h-16 px-6 border-b border-zinc-200/50 flex items-center justify-between shrink-0 bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div class="flex items-center gap-4">
          <h1 class="text-2xl font-bold text-zinc-900 tracking-tight min-w-[180px]">Tháng {{ focusedMonth }} {{ focusedYear }}</h1>
          <div class="flex items-center gap-1.5">
            <Button variant="outline" size="icon" class="h-8 w-8 rounded-full border-zinc-200/80 hover:bg-zinc-50 hover:shadow-sm text-zinc-600 transition-all" @click="handlePrev">
              <ChevronLeft class="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" class="h-8 w-8 rounded-full border-zinc-200/80 hover:bg-zinc-50 hover:shadow-sm text-zinc-600 transition-all" @click="handleNext">
              <ChevronRight class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <!-- View Switcher Tabs -->
        <div class="hidden md:flex relative items-center bg-zinc-100/80 rounded-full p-1 h-10 shrink-0">
          <!-- Sliding Indicator -->
          <div 
            class="absolute top-1 bottom-1 w-[72px] bg-white rounded-full shadow-sm transition-transform duration-300 ease-in-out"
            :style="{ transform: currentView === 'day' ? 'translateX(0)' : currentView === 'week' ? 'translateX(72px)' : 'translateX(144px)' }"
          ></div>
          
          <button @click="currentView = 'day'" class="relative z-10 w-[72px] h-full rounded-full text-sm font-semibold transition-colors duration-300" :class="currentView === 'day' ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'">Ngày</button>
          <button @click="currentView = 'week'" class="relative z-10 w-[72px] h-full rounded-full text-sm font-semibold transition-colors duration-300" :class="currentView === 'week' ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'">Tuần</button>
          <button @click="currentView = 'month'" class="relative z-10 w-[72px] h-full rounded-full text-sm font-semibold transition-colors duration-300" :class="currentView === 'month' ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'">Tháng</button>
        </div>

        <div class="flex items-center gap-2">
          <Button variant="outline" class="h-9 px-4 rounded-full border-zinc-200 text-sm font-semibold hover:bg-zinc-50 shadow-sm" @click="handleToday">
            Hôm nay
          </Button>
          <Button class="bg-zinc-900 hover:bg-zinc-800 text-white shadow-md rounded-full h-9 px-4 text-sm font-semibold">
            <Plus class="w-4 h-4 mr-1.5" /> Tạo sự kiện
          </Button>
        </div>
      </div>

      <!-- Scrollable Matrix Viewport -->
      <div ref="viewportRef" class="flex-1 overflow-auto bg-zinc-50/20 relative hide-scrollbar min-w-0 min-h-0" @mousedown="handlePanStart" @contextmenu="preventContextMenu">
        <div class="inline-flex flex-col min-w-full">
          <!-- Invisible Spacer to enforce true scroll width without overflow-hidden cutting it off -->
          <div class="h-0 flex pointer-events-none invisible w-max">
            <div class="w-16 shrink-0"></div>
            <div v-for="dObj in visibleDaysArray" :key="'spacer-' + dObj.id" class="w-[140px] shrink-0"></div>
          </div>
          
          <!-- Day Headers (Sticky Top) -->
          <div class="flex border-b border-zinc-200/40 sticky top-0 bg-white z-40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div class="w-16 shrink-0 p-3 border-r border-zinc-100 flex items-center justify-center bg-zinc-50 sticky left-0 z-50">
              <span class="text-[9px] font-bold text-zinc-400 tracking-widest uppercase text-center">GMT+7</span>
            </div>
            <div class="relative flex flex-1 overflow-hidden bg-white">
              <Transition :name="transitionDirection">
                <div :key="`${currentView}-${focusedYear}-${focusedMonth}-${focusedDay}`" class="flex w-full shrink-0 bg-white">
                  <div v-for="dObj in visibleDaysArray" :key="'header-' + dObj.id" class="flex-1 min-w-[140px] p-3 text-center border-r border-zinc-100/80 flex flex-col items-center justify-center gap-1" :class="{'bg-blue-50': dObj.dateStr === actualTodayStr}">
                    <span class="text-[10px] font-bold tracking-widest uppercase text-zinc-400" :class="{'text-blue-600': dObj.dateStr === actualTodayStr}">{{ dObj.dayName }}</span>
                    <span class="text-lg font-medium w-8 h-8 flex items-center justify-center" :class="dObj.dateStr === actualTodayStr ? 'rounded-full bg-blue-600 text-white shadow-sm' : 'text-zinc-900'">{{ dObj.day }}</span>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Grid Body -->
          <div class="flex relative bg-white flex-1">
            <!-- Time Column (Sticky Left) -->
            <div class="w-16 shrink-0 border-r border-zinc-100 bg-white sticky left-0 z-30 shadow-[1px_0_2px_rgba(0,0,0,0.02)]">
              <div v-for="h in 24" :key="'time-' + h" class="h-[160px] relative">
                <span class="absolute top-0 right-2 -translate-y-1/2 mt-[8px] text-[10px] font-semibold text-zinc-400 tracking-wide">{{ h - 1 }}:00</span>
              </div>
            </div>

            <!-- Main Grid Columns & Rows -->
            <div class="relative flex flex-1 bg-white" style="height: 3840px;">
              <!-- Animated Layer -->
              <Transition :name="transitionDirection">
                <div :key="`${currentView}-${focusedYear}-${focusedMonth}-${focusedDay}`" class="w-full h-full relative shrink-0 bg-white"
                     @mousedown="handleMouseDown"
                     @mousemove="handleMouseMove"
                     @mouseup="handleMouseUp"
                     @mouseleave="handleMouseUp">
                  <!-- Vertical Lines -->
                  <div class="absolute inset-0 flex pointer-events-none">
                    <div v-for="dObj in visibleDaysArray" :key="'vline-' + dObj.id" class="flex-1 min-w-[140px] border-r border-zinc-100/60 transition-colors" :class="{'bg-blue-50/60': dObj.dateStr === actualTodayStr}"></div>
                  </div>
                  
                  <!-- Events Layer -->
                  <div 
                    v-for="event in filteredEvents" 
                    :key="'event-' + event.id"
                    class="absolute rounded-xl border cursor-pointer flex overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:z-[60] hover:-translate-y-1 hover:scale-[1.01] hover:shadow-[0_16px_32px_-12px_rgba(0,0,0,0.25)] hover:border-black/15"
                    @mousedown="e => { if (e.button !== 2) e.stopPropagation() }"
                    :class="[event.colorClass, event.duration < 0.5 ? 'p-1 px-2.5 flex-row items-center gap-2' : 'p-2.5 flex-col justify-between']"
                    :style="{
                      left: `calc(${(visibleDaysArray.findIndex(d => d.dateStr === event.dateStr) / visibleDaysArray.length) * 100}% + 4px)`,
                      width: `calc(${(1 / visibleDaysArray.length) * 100}% - 8px)`,
                      top: `${event.startHour * 160 + 2}px`,
                      height: `${event.duration * 160 - 4}px`,
                      backgroundColor: 'white'
                    }"
                  >
                    <template v-if="event.duration < 0.5">
                      <h4 class="text-[10px] font-bold leading-none truncate flex-1">{{ event.title }}</h4>
                      <p class="text-[9px] opacity-80 font-semibold shrink-0">{{ event.timeStr }}</p>
                    </template>
                    <template v-else>
                      <div class="min-h-0 flex-1 overflow-hidden">
                        <h4 class="text-xs font-bold leading-tight mb-1 text-left line-clamp-2">{{ event.title }}</h4>
                        <p class="text-[10px] opacity-80 font-semibold text-left">{{ event.timeStr }}</p>
                      </div>
                      <div class="flex items-center -space-x-1.5 mt-auto pt-1 overflow-hidden shrink-0">
                        <Avatar v-for="avatar in event.avatars" :key="'av-' + avatar.id" class="w-5 h-5 border-2 border-white ring-0 shrink-0 shadow-sm">
                          <AvatarImage :src="avatar.url" />
                          <AvatarFallback>U</AvatarFallback>
                        </Avatar>
                        <Avatar v-if="event.remainingCount > 0" class="w-5 h-5 border-2 border-white bg-black/5 text-current text-[8px] font-bold ring-0 shrink-0 flex items-center justify-center">
                          <AvatarFallback>+{{ event.remainingCount }}</AvatarFallback>
                        </Avatar>
                      </div>
                    </template>
                  </div>

                  <!-- Draft Event (Drag to Create) -->
                  <div v-if="currentView === 'day' && (isDragging || isCreateModalOpen)"
                       class="absolute left-[4px] w-[calc(100%-8px)] rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/50 z-40 pointer-events-none flex flex-col justify-start p-2.5 shadow-sm"
                       :style="{
                         top: `${draftEventStart * 160 + 2}px`,
                         height: `${(draftEventEnd - draftEventStart) * 160 - 4}px`
                       }">
                    <h4 class="text-xs font-bold leading-tight mb-1 text-blue-700 text-left">Sự kiện mới (Nháp)</h4>
                    <p class="text-[10px] font-semibold text-blue-600 text-left">{{ formatHour(draftEventStart) }} - {{ formatHour(draftEventEnd) }}</p>
                  </div>

                  <!-- Current Time Indicator -->
                  <div class="absolute w-full flex items-center z-40 pointer-events-none" 
                       :style="{ top: `${currentTime.getHours() * 160 + (currentTime.getMinutes() / 60) * 160}px` }" 
                       v-if="isTodayVisible">
                    <div class="h-full relative" 
                         :style="{ 
                           width: `calc(${(1 / visibleDaysArray.length) * 100}%)`,
                           marginLeft: `calc(${(visibleDaysArray.findIndex(d => d.dateStr === actualTodayStr) / visibleDaysArray.length) * 100}%)` 
                         }">
                      <div class="absolute left-[-4px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.2)]"></div>
                      <div class="absolute top-1/2 -translate-y-1/2 h-[1.5px] bg-red-500 w-full shadow-sm"></div>
                    </div>
                  </div>
                </div>
              </Transition>

            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Create Event Dialog -->
    <Dialog v-model:open="isCreateModalOpen">
      <DialogContent class="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Tạo sự kiện nhanh</DialogTitle>
          <DialogDescription>
            Tạo sự kiện mới trong khung giờ <span class="font-bold text-zinc-900">{{ formatHour(draftEventStart) }} - {{ formatHour(draftEventEnd) }}</span>
          </DialogDescription>
        </DialogHeader>
        <div class="grid gap-4 py-4">
          <div class="grid gap-2">
            <label for="title" class="text-sm font-medium">Tên sự kiện</label>
            <Input id="title" v-model="draftEventTitle" placeholder="Nhập tên sự kiện..." autofocus @keyup.enter="handleSaveDraftEvent" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="isCreateModalOpen = false">Hủy</Button>
          <Button @click="handleSaveDraftEvent" class="bg-blue-600 hover:bg-blue-700 text-white">Lưu sự kiện</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.2s ease-in-out;
  will-change: transform;
}

.slide-left-leave-active,
.slide-right-leave-active {
  position: absolute !important;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.slide-left-enter-from {
  transform: translateX(100%);
}
.slide-left-leave-to {
  transform: translateX(-100%);
}

.slide-right-enter-from {
  transform: translateX(-100%);
}
.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
