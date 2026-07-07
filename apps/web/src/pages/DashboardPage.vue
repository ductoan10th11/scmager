<script setup>
import { ref, computed, onMounted, nextTick, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Sparkles, Calendar, CheckSquare, Clock, ArrowUpRight, ArrowDownRight, Bell, Search, Activity, MoreHorizontal, Mic, Send, MessageSquare } from 'lucide-vue-next'
import { globalMockEvents } from '@/mocks/schedule'
import { onBeforeUnmount } from 'vue'

const router = useRouter()
const scheduleContainerRef = ref(null)

const kpis = ref([
  { title: 'Nhiệm vụ', value: '24', icon: CheckSquare, color: 'text-blue-600', bg: 'bg-blue-50' },
  { title: 'Sự kiện', value: '8', icon: Calendar, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { title: 'Giờ làm', value: '38h', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
  { title: 'Hoàn thành', value: '94%', icon: Activity, color: 'text-indigo-600', bg: 'bg-indigo-50' }
])

const aiChatInput = ref('')
const isRecording = ref(false)
const activeAiTab = ref('suggestions')
const chatMessages = ref([
  { id: 1, role: 'ai', text: 'Chào buổi sáng! Tôi có thể giúp bạn giao việc hoặc xếp lịch hôm nay?' }
])

// Swipe logic
const swipeStartX = ref(0)
const isSwiping = ref(false)
const isDraggingSlider = ref(false)
const sliderDragOffset = ref(0) 
const contentDragOffset = ref(0)

const onWindowMouseMove = (e) => {
  if (!isSwiping.value) return
  const currentX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX
  const movement = currentX - swipeStartX.value
  
  if (isDraggingSlider.value) {
    if (e.cancelable) e.preventDefault()
    let move = movement
    if (activeAiTab.value === 'suggestions') move = Math.max(0, Math.min(move, 76))
    else move = Math.max(-76, Math.min(move, 0))
    sliderDragOffset.value = move
  } else {
    if (e.cancelable) e.preventDefault() 
    let move = movement
    if (activeAiTab.value === 'suggestions') move = Math.min(move, 30) 
    else move = Math.max(move, -30) 
    contentDragOffset.value = move
  }
}

const onWindowMouseUp = (e) => {
  if (!isSwiping.value) return
  isSwiping.value = false
  
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('touchmove', onWindowMouseMove)
  window.removeEventListener('touchend', onWindowMouseUp)
  
  if (window.getSelection().toString().length > 0 && !isDraggingSlider.value) {
    sliderDragOffset.value = 0
    contentDragOffset.value = 0
    return
  }

  const swipeEndX = e.type.includes('touch') ? e.changedTouches[0].clientX : e.clientX
  const movement = swipeEndX - swipeStartX.value 
  const threshold = isDraggingSlider.value ? 20 : 50 

  if (Math.abs(movement) > threshold) {
    if (isDraggingSlider.value) {
      if (movement > 0 && activeAiTab.value === 'suggestions') activeAiTab.value = 'assistant'
      else if (movement < 0 && activeAiTab.value === 'assistant') activeAiTab.value = 'suggestions'
    } else {
      if (movement < 0 && activeAiTab.value === 'suggestions') activeAiTab.value = 'assistant'
      else if (movement > 0 && activeAiTab.value === 'assistant') activeAiTab.value = 'suggestions'
    }
  }
  
  sliderDragOffset.value = 0
  contentDragOffset.value = 0
  isDraggingSlider.value = false
}

const handleSwipeStart = (e) => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
  
  if (e.target.closest('.ai-tab-slider')) {
    isDraggingSlider.value = true
  } else {
    isDraggingSlider.value = false
  }

  isSwiping.value = true
  swipeStartX.value = e.type.includes('touch') ? e.touches[0].clientX : e.clientX
  sliderDragOffset.value = 0
  contentDragOffset.value = 0
  
  window.addEventListener('mousemove', onWindowMouseMove, { passive: false })
  window.addEventListener('mouseup', onWindowMouseUp)
  window.addEventListener('touchmove', onWindowMouseMove, { passive: false })
  window.addEventListener('touchend', onWindowMouseUp)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('touchmove', onWindowMouseMove)
  window.removeEventListener('touchend', onWindowMouseUp)
})

const today = new Date()
const year = today.getFullYear()
const month = String(today.getMonth() + 1).padStart(2, '0')
const day = String(today.getDate()).padStart(2, '0')
const todayStr = `${year}-${month}-${day}`

const upcomingEvents = computed(() => {
  return globalMockEvents.value
    .filter(e => e.dateStr === todayStr && e.assignee.fullName === 'Nguyễn Văn A')
    .sort((a, b) => a.startHour - b.startHour)
})

const timelineHours = computed(() => {
  const hours = []
  for (let h = 7; h <= 19; h++) {
    const hourStr = String(h).padStart(2, '0') + ':00'
    const eventsInHour = upcomingEvents.value.filter(e => Math.floor(e.startHour) === h)
    
    hours.push({
      timeStr: hourStr,
      hourVal: h,
      events: eventsInHour
    })
  }
  return hours
})

const meetingCount = computed(() => upcomingEvents.value.filter(e => e.type === 'Họp').length)
const taskCount = computed(() => upcomingEvents.value.filter(e => e.type !== 'Họp').length)

const currentHourFloat = ref(new Date().getHours() + new Date().getMinutes() / 60)

let timeInterval = null

onMounted(() => {
  timeInterval = setInterval(() => {
    const now = new Date()
    currentHourFloat.value = now.getHours() + now.getMinutes() / 60
  }, 60000) // Update every minute

  setTimeout(() => {
    if (!scheduleContainerRef.value || upcomingEvents.value.length === 0) return
    
    // Cuộn đến vạch đỏ hiện tại
    const targetElement = scheduleContainerRef.value.querySelector('.current-time-indicator') || scheduleContainerRef.value.querySelector('.bg-red-500').parentElement
    if (targetElement) {
      // Calculate offset to center the line
      const containerHeight = scheduleContainerRef.value.clientHeight
      const targetTop = parseFloat(targetElement.style.top)
      scheduleContainerRef.value.scrollTo({
        top: Math.max(0, targetTop - containerHeight / 2),
        behavior: 'smooth'
      })
    }
  }, 300)
})

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval)
})
</script>

<template>
  <div class="h-full flex flex-col bg-zinc-50/50 overflow-hidden">


    <div class="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto w-full flex flex-col gap-6 lg:gap-8 h-full overflow-hidden">
      
      <!-- Greeting (Top, Shrink-0) -->
      <div class="shrink-0 mt-2">
        <h2 class="text-2xl md:text-3xl font-bold text-zinc-900 tracking-tight text-left">Chào buổi sáng, Nguyễn Văn A.</h2>
        <p class="text-zinc-500 text-left text-sm md:text-base font-medium mt-1.5">Bạn có {{ meetingCount }} cuộc họp và {{ taskCount }} nhiệm vụ cần xử lý trong ngày hôm nay.</p>
      </div>

      <!-- Main Grid (Fills remaining 100vh height) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8 flex-1 min-h-0 pb-6">
        
        <!-- LEFT: TALL SCHEDULE (Prioritizing Vertical Height) -->
        <Card class="lg:col-span-4 flex flex-col h-full rounded-3xl border border-zinc-200/60 bg-white shadow-sm overflow-hidden min-h-0 relative">
          <div class="p-5 md:p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-20 relative">
            <h3 class="font-bold text-zinc-900 text-lg">Lịch trình hôm nay</h3>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-zinc-400 hover:text-zinc-700 !cursor-pointer">
              <MoreHorizontal class="w-5 h-5" />
            </Button>
          </div>
          <div class="p-5 md:p-6 pb-24 flex-1 overflow-y-auto hide-scrollbar relative isolate" ref="scheduleContainerRef">
            
            <div class="flex flex-col gap-6 w-full relative isolate">
              <!-- Absolute Grid Container -->
              <div class="w-full relative" style="height: 2080px;"> <!-- 13 hours (7 to 19) * 160px = 2080px -->
                
                <!-- Continuous Vertical Line -->
                <div class="absolute left-[58px] top-[14px] bottom-0 w-[2px] bg-zinc-200/70 z-0"></div>

                <!-- HOUR MARKERS (Background Layer) -->
                <div v-for="i in 13" :key="i" class="absolute left-0 w-full flex items-start" :style="{ top: `${(i - 1) * 160}px`, height: '160px' }">
                  <div class="w-14 text-right shrink-0 pt-1 relative z-10 group">
                    <p class="text-[13px] font-extrabold text-zinc-900">{{ String(i + 6).padStart(2, '0') + ':00' }}</p>
                  </div>
                  <!-- Dot -->
                  <div class="absolute left-[54px] top-[10px] w-2.5 h-2.5 rounded-full border-[2.5px] border-white ring-1 ring-zinc-300 z-10 shadow-sm bg-zinc-400"></div>
                </div>

                <!-- TASKS (Foreground Layer) -->
                <template v-for="event in upcomingEvents" :key="event._id">
                  <!-- top = (startHour - 7) * 160 + 14px (để thẻ thẳng hàng với giữa dot) -->
                  <div class="absolute left-[76px] w-[calc(100%-84px)] group/card bg-white hover:bg-zinc-50/80 rounded-2xl border border-zinc-200/70 shadow-sm z-20 hover:border-zinc-300 cursor-pointer overflow-hidden transition-colors flex"
                       :class="event.duration < 0.5 ? 'p-1.5 px-3 flex-row items-center gap-2' : 'p-3 flex-col justify-start'"
                       :style="{ 
                         top: `${(event.startHour - 7) * 160 + 14}px`, 
                         height: `${event.duration * 160 - 8}px`
                       }">
                    <template v-if="event.duration < 0.5">
                      <h4 class="text-[11px] font-bold text-zinc-900 leading-none truncate flex-1">{{ event.title }}</h4>
                      <p class="text-[10px] font-bold text-blue-600 shrink-0">{{ event.time }}</p>
                    </template>
                    <template v-else>
                      <div class="min-h-0 overflow-hidden flex flex-col">
                        <h4 class="text-sm font-bold text-zinc-900 text-left leading-snug line-clamp-2">{{ event.title }}</h4>
                        <div class="flex items-center gap-2 mt-1.5 shrink-0">
                          <p class="text-[11px] font-bold text-blue-600">{{ event.time }}</p>
                          <span class="w-1 h-1 rounded-full bg-zinc-300"></span>
                          <p class="text-[11px] text-zinc-500 font-semibold truncate">{{ event.type }}</p>
                        </div>
                      </div>
                    </template>
                  </div>
                </template>

                <!-- CURRENT TIME LINE -->
                <div v-if="currentHourFloat >= 7 && currentHourFloat <= 19" class="current-time-indicator absolute left-0 right-0 z-30 pointer-events-none" :style="{ top: `${(currentHourFloat - 7) * 160 + 14}px` }">
                  <div class="absolute left-0 w-14 text-right pr-4 mt-[-8px]">
                    <span class="text-[10px] font-bold text-red-500 bg-white px-1 whitespace-nowrap relative z-40">Bây giờ</span>
                  </div>
                  <div class="absolute left-[55px] mt-[-4px] w-2 h-2 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.15)] z-30"></div>
                  <div class="absolute left-[67px] right-0 h-[2px] bg-red-500 shadow-sm mt-[-3px]"></div>
                </div>

              </div>
            </div>
          </div>
          <!-- Floating Sticky Fixed Button -->
          <div class="absolute bottom-0 left-0 right-0 p-5 md:p-6 bg-gradient-to-t from-white via-white/80 to-transparent pt-12 z-30 pointer-events-none">
            <Button @click="router.push('/schedule')" variant="outline" class="w-full rounded-full border border-zinc-200/80 text-zinc-700 bg-white/95 backdrop-blur-sm hover:bg-zinc-50 font-bold h-12 text-sm shadow-[0_8px_16px_-6px_rgba(0,0,0,0.1)] hover:shadow-[0_12px_20px_-8px_rgba(0,0,0,0.15)] transition-all pointer-events-auto !cursor-pointer">
              Xem toàn bộ lịch trình
            </Button>
          </div>
        </Card>

        <!-- RIGHT: KPIs & Actions -->
        <div class="lg:col-span-8 flex flex-col gap-5 md:gap-6 min-h-0">
          <!-- Removed KPIs Minimal Grid from here -->
          <!-- Dual-Mode AI Assistant -->
          <Card class="flex-1 rounded-3xl bg-gradient-to-br from-indigo-50/80 via-purple-50/40 to-white border-indigo-100/50 shadow-sm relative overflow-hidden transition-all flex flex-col min-h-0 pb-0">
            <div class="absolute -right-10 -top-10 w-56 h-56 bg-purple-200/40 rounded-full blur-3xl pointer-events-none"></div>
            <div class="absolute right-0 bottom-0 w-40 h-40 bg-indigo-200/20 rounded-full blur-2xl pointer-events-none"></div>
            
            <div 
              class="w-full flex flex-col flex-1 min-h-0 relative z-10 touch-pan-y"
              @mousedown="handleSwipeStart"
              @touchstart="handleSwipeStart"
            >
              <div class="px-5 pt-5 pb-2 shrink-0 flex items-center justify-between cursor-default">
                <div class="flex items-center gap-3">
                  <div class="p-2.5 bg-white rounded-full shadow-sm text-indigo-600 shrink-0">
                    <Sparkles class="w-5 h-5" />
                  </div>
                  <h3 class="text-lg font-bold text-indigo-900">AI Assistant</h3>
                </div>
                <div class="ai-tab-slider relative grid w-[160px] grid-cols-2 bg-white/60 p-1 rounded-full shadow-sm border border-indigo-100 isolate select-none">
                  <!-- Sliding Background Indicator -->
                  <div class="absolute left-1 top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-full shadow-sm z-0"
                       :class="isSwiping && isDraggingSlider ? '' : 'transition-transform duration-200 ease-out'"
                       :style="{ transform: `translateX(calc(${activeAiTab === 'assistant' ? '100%' : '0px'} + ${sliderDragOffset}px))` }"></div>
                  <button @click="activeAiTab = 'suggestions'" 
                          class="relative rounded-full text-xs font-semibold z-10 transition-colors h-7 flex items-center justify-center bg-transparent border-0 outline-none !cursor-pointer"
                          :class="activeAiTab === 'suggestions' ? 'text-indigo-700' : 'text-zinc-500'">
                    Gợi ý
                  </button>
                  <button @click="activeAiTab = 'assistant'" 
                          class="relative rounded-full text-xs font-semibold z-10 transition-colors h-7 flex items-center justify-center bg-transparent border-0 outline-none !cursor-pointer"
                          :class="activeAiTab === 'assistant' ? 'text-indigo-700' : 'text-zinc-500'">
                    Trợ lý
                  </button>
                </div>
              </div>

              <!-- NATIVE SLIDING CONTAINER -->
              <div class="flex-1 w-full overflow-hidden relative min-h-0 mt-3">
                <div class="flex w-[200%] h-full transform-gpu will-change-transform"
                     :class="isSwiping && !isDraggingSlider ? '' : 'transition-transform duration-300 ease-out'"
                     :style="{ transform: `translateX(calc(${activeAiTab === 'assistant' ? '-50%' : '0%'} + ${contentDragOffset}px))` }">
                  
                  <!-- SUGGESTIONS SLIDE -->
                  <div class="w-1/2 h-full flex flex-col px-5 pb-5">
                    <div class="flex-1 flex flex-col gap-4 overflow-y-auto hide-scrollbar min-h-0 pt-1">
                      
                      <!-- KPIs Inside AI -->
                      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 shrink-0">
                        <Card v-for="(kpi, i) in kpis" :key="i" class="p-3 rounded-2xl border border-white/60 bg-white/70 shadow-sm hover:bg-white transition-colors flex items-center gap-3 cursor-default">
                          <div :class="['p-2.5 rounded-xl shrink-0', kpi.bg, kpi.color]">
                            <component :is="kpi.icon" class="w-5 h-5" />
                          </div>
                          <div class="flex flex-col justify-center">
                            <p class="text-xl md:text-2xl font-extrabold text-zinc-900 leading-none text-left">{{ kpi.value }}</p>
                            <h3 class="text-zinc-500 text-[11px] md:text-xs font-semibold text-left mt-0.5">{{ kpi.title }}</h3>
                          </div>
                        </Card>
                      </div>

                      <div class="flex flex-col gap-2.5 shrink-0 pb-2">
                        <div class="flex items-start gap-3 bg-white/70 p-3 md:p-3.5 rounded-2xl border border-white hover:bg-white transition-colors cursor-default shadow-sm">
                      <div class="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0 shadow-[0_0_4px_rgba(59,130,246,0.3)]"></div>
                      <div class="flex-1 min-w-0">
                        <p class="text-[13px] md:text-sm font-bold text-zinc-900 truncate mb-0.5">Xếp việc vào chiều nay</p>
                        <p class="text-xs md:text-[13px] text-zinc-600 font-medium leading-relaxed line-clamp-2">Bạn có 2 giờ trống (14:00-16:00). Nhấn để xếp 3 nhiệm vụ tồn đọng vào đây.</p>
                      </div>
                    </div>
                    
                    <div class="flex items-start gap-3 bg-white/70 p-3 md:p-3.5 rounded-2xl border border-white hover:bg-white transition-colors cursor-default shadow-sm">
                      <div class="w-2 h-2 rounded-full bg-orange-500 mt-1.5 shrink-0 shadow-[0_0_4px_rgba(249,115,22,0.3)]"></div>
                      <div class="flex-1 min-w-0">
                        <p class="text-[13px] md:text-sm font-bold text-zinc-900 truncate mb-0.5">Dự án đang chậm trễ</p>
                        <p class="text-xs md:text-[13px] text-zinc-600 font-medium leading-relaxed line-clamp-2">"Cải tạo cảnh quan" đang chậm 2 ngày. Gợi ý mở cuộc họp đánh giá nhanh sáng mai.</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div class="mt-4 pt-4 border-t border-indigo-100/50 flex gap-3 shrink-0">
                  <Button class="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 shadow-md font-semibold h-10 text-sm transition-all hover:-translate-y-0.5 cursor-pointer">
                    Thực hiện tất cả
                  </Button>
                </div>
              </div>

                  <!-- ASSISTANT SLIDE (Chat/Voice) -->
                  <div class="w-1/2 h-full flex flex-col px-5 pb-5">
                    
                    <!-- Chat Messages Area -->
                    <div class="flex-1 overflow-y-auto hide-scrollbar flex flex-col gap-4 py-2">
                  <div v-for="msg in chatMessages" :key="msg.id" class="flex w-full" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
                    
                    <!-- AI Message -->
                    <div v-if="msg.role === 'ai'" class="flex items-end gap-2 w-[85%]">
                      <div class="p-1.5 bg-white rounded-full shadow-sm border border-indigo-100 shrink-0 text-indigo-600">
                        <Sparkles class="w-4 h-4" />
                      </div>
                      <div class="bg-white/80 p-3 px-4 rounded-[24px] rounded-bl-sm shadow-sm border border-white text-[13px] md:text-sm font-medium text-zinc-800 leading-relaxed">
                        {{ msg.text }}
                      </div>
                    </div>

                    <!-- User Message -->
                    <div v-else class="flex justify-end w-[85%]">
                      <div class="bg-indigo-600 p-3 px-4 rounded-[24px] rounded-br-sm shadow-sm text-[13px] md:text-sm font-medium text-white leading-relaxed text-left inline-block">
                        {{ msg.text }}
                      </div>
                    </div>

                  </div>
                </div>

                <!-- Input Area -->
                <div class="mt-2 shrink-0 relative bg-white p-[5px] rounded-full shadow-sm border border-indigo-50 flex items-center gap-1 transition-all focus-within:shadow-md focus-within:border-indigo-200">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    class="h-10 w-10 shrink-0 rounded-full text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all flex items-center justify-center !cursor-pointer"
                    :class="{'text-blue-500 bg-blue-50 hover:bg-blue-100 animate-pulse ring-2 ring-blue-200': isRecording}"
                    @click="isRecording = !isRecording"
                  >
                    <Mic class="w-5 h-5" />
                  </Button>
                  <Input 
                    v-model="aiChatInput"
                    placeholder="Giao việc, lên lịch họp..." 
                    class="border-0 bg-transparent shadow-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm font-medium px-1 h-10 placeholder:text-zinc-400 flex-1"
                    @keyup.enter="() => { if (aiChatInput) { chatMessages.push({ id: Date.now(), role: 'user', text: aiChatInput }); aiChatInput = ''; } }"
                  />
                  <Button size="icon" class="h-10 w-10 shrink-0 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all flex items-center justify-center !cursor-pointer disabled:!cursor-not-allowed disabled:pointer-events-auto disabled:hover:bg-indigo-600"
                    :disabled="!aiChatInput"
                    @click="() => { if (aiChatInput) { chatMessages.push({ id: Date.now(), role: 'user', text: aiChatInput }); aiChatInput = ''; } }">
                    <Send class="w-[18px] h-[18px] translate-x-[0px] -translate-y-[-1px] pointer-events-none" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
            </div>
          </Card>
          
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
