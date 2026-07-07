<script setup>
import { ref, computed, watch } from 'vue'
import { Sparkles, Paperclip, UploadCloud, User, CalendarDays, Clock, Check } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const props = defineProps({
  open: { type: Boolean, default: false }
})

const emit = defineEmits(['update:open', 'submit'])

const isOpen = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val)
})

// Form Data
const title = ref('')
const description = ref('')
const assignee = ref('')
const category = ref('deadline')
const estimatedHours = ref('')
const dueDate = ref('')

// AI Loading state
const isAnalyzing = ref(false)

// 8h/day SLA logic mock (Assuming current assigned hours for the mock user is 5h)
const currentAssignedHours = ref(5) 

const totalHours = computed(() => {
  const hours = parseFloat(estimatedHours.value) || 0
  return currentAssignedHours.value + hours
})

const slaStatus = computed(() => {
  const total = totalHours.value
  if (total <= 6) return { color: 'bg-emerald-500', text: 'text-emerald-700', msg: 'An toàn' }
  if (total <= 8) return { color: 'bg-amber-500', text: 'text-amber-700', msg: 'Vừa đủ định mức' }
  return { color: 'bg-rose-500', text: 'text-rose-700', msg: 'Quá tải (> 8h)' }
})

const progressWidth = computed(() => {
  const pct = (totalHours.value / 8) * 100
  return Math.min(pct, 100) + '%'
})

const handleAiAnalyze = () => {
  isAnalyzing.value = true
  // Mock AI processing delay
  setTimeout(() => {
    title.value = "Thẩm định Hồ sơ Đất đai khu vực X"
    description.value = "Yêu cầu kiểm tra kỹ các thông số quy hoạch và đối chiếu với bản đồ địa chính mới nhất. Lập báo cáo trước 14:00."
    category.value = "deadline"
    estimatedHours.value = 2
    isAnalyzing.value = false
  }, 2000)
}

const handleSubmit = () => {
  // Simple validation
  if (!title.value || !assignee.value) return
  
  emit('submit', {
    title: title.value,
    description: description.value,
    assignee: assignee.value,
    category: category.value,
    estimatedHours: estimatedHours.value,
    dueDate: dueDate.value
  })
  isOpen.value = false
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <!-- Premium Material Backdrop and Container -->
    <DialogContent class="max-w-4xl p-0 overflow-hidden bg-white/95 backdrop-blur-xl border-zinc-200/50 shadow-2xl sm:rounded-[32px]">
      
      <div class="flex flex-col md:flex-row h-full">
        <!-- LEFT COLUMN: Main Content -->
        <div class="flex-1 p-8 md:p-10 flex flex-col gap-6 relative">
          <!-- AI Shimmer Overlay when analyzing -->
          <div v-if="isAnalyzing" class="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300">
            <div class="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center">
              <Sparkles class="w-6 h-6 text-indigo-500 animate-pulse" />
            </div>
            <p class="text-sm font-bold text-indigo-900 animate-pulse">AI đang phân tích văn bản...</p>
          </div>

          <!-- Title Input (Huge, Borderless) -->
          <div>
            <input 
              v-model="title"
              type="text" 
              placeholder="Nhập tên nhiệm vụ..." 
              class="w-full text-3xl md:text-4xl font-extrabold text-zinc-900 placeholder:text-zinc-300 bg-transparent border-none outline-none focus:ring-0 p-0"
            />
          </div>

          <!-- Description -->
          <div class="flex-1 min-h-[160px]">
            <textarea 
              v-model="description"
              placeholder="Mô tả chi tiết công việc..."
              class="w-full h-full resize-none bg-transparent border-none outline-none focus:ring-0 p-0 text-[15px] font-medium text-zinc-600 placeholder:text-zinc-400 leading-relaxed"
            ></textarea>
          </div>

          <!-- File Upload & AI Trigger -->
          <div class="mt-auto pt-6 border-t border-zinc-100">
            <div class="flex flex-col items-center justify-center p-6 bg-zinc-50/50 border border-dashed border-zinc-200 rounded-2xl hover:bg-zinc-50 transition-colors group cursor-pointer relative overflow-hidden">
              <div class="flex items-center gap-4 w-full justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-white shadow-sm border border-zinc-100 flex items-center justify-center text-zinc-400 group-hover:text-indigo-500 transition-colors">
                    <UploadCloud class="w-5 h-5" />
                  </div>
                  <div class="text-left">
                    <p class="text-sm font-bold text-zinc-700">Kéo thả file đính kèm</p>
                    <p class="text-[11px] font-medium text-zinc-500">Hỗ trợ PDF, Word (Max 10MB)</p>
                  </div>
                </div>
                
                <Button @click.stop="handleAiAnalyze" variant="secondary" size="sm" class="h-9 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border-0 shadow-none gap-1.5 font-bold">
                  <Sparkles class="w-4 h-4" />
                  Phân tích AI
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN: Settings Sidebar -->
        <div class="w-full md:w-[320px] lg:w-[360px] bg-zinc-50/80 p-8 md:p-10 border-l border-zinc-200/50 flex flex-col gap-8 shrink-0">
          
          <!-- Assignee -->
          <div class="space-y-3">
            <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Người thực hiện</label>
            <Select v-model="assignee">
              <SelectTrigger class="w-full h-12 rounded-2xl bg-white border-zinc-200/60 shadow-sm hover:border-zinc-300 focus:ring-2 focus:ring-zinc-900/5 transition-all">
                <div class="flex items-center gap-2.5">
                  <Avatar v-if="assignee" class="w-6 h-6 border border-zinc-100">
                    <AvatarImage src="https://i.pravatar.cc/150?img=11" />
                    <AvatarFallback>NV</AvatarFallback>
                  </Avatar>
                  <User v-else class="w-4 h-4 text-zinc-400" />
                  <SelectValue placeholder="Chọn chuyên viên..." class="font-semibold text-zinc-700" />
                </div>
              </SelectTrigger>
              <SelectContent class="rounded-2xl border-zinc-200/60 shadow-xl">
                <SelectGroup>
                  <SelectItem value="user1" class="font-medium rounded-xl py-2.5 cursor-pointer">Nguyễn Văn A (Phó phòng)</SelectItem>
                  <SelectItem value="user2" class="font-medium rounded-xl py-2.5 cursor-pointer">Trần Thị B (Chuyên viên)</SelectItem>
                  <SelectItem value="user3" class="font-medium rounded-xl py-2.5 cursor-pointer">Lê Văn C (Chuyên viên)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <!-- 8h SLA Progress Bar -->
            <div v-if="assignee" class="pt-2 animate-in fade-in slide-in-from-top-2">
              <div class="flex justify-between items-center mb-1.5">
                <span class="text-[11px] font-bold text-zinc-500">Định mức hôm nay</span>
                <span class="text-[11px] font-extrabold" :class="slaStatus.text">{{ totalHours }}h / 8h</span>
              </div>
              <div class="h-1.5 w-full bg-zinc-200/80 rounded-full overflow-hidden">
                <div class="h-full transition-all duration-500 ease-out rounded-full" :class="slaStatus.color" :style="{ width: progressWidth }"></div>
              </div>
              <p class="text-[10px] font-bold mt-1.5" :class="slaStatus.text">{{ slaStatus.msg }}</p>
            </div>
          </div>

          <!-- Category -->
          <div class="space-y-3">
            <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Phân loại</label>
            <Select v-model="category">
              <SelectTrigger class="w-full h-11 rounded-xl bg-white border-zinc-200/60 shadow-sm hover:border-zinc-300 transition-all font-semibold text-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent class="rounded-xl border-zinc-200/60 shadow-xl">
                <SelectGroup>
                  <SelectItem value="deadline" class="font-medium cursor-pointer rounded-lg">Hạn công việc (Deadline)</SelectItem>
                  <SelectItem value="meeting" class="font-medium cursor-pointer rounded-lg">Giấy mời / Cuộc họp</SelectItem>
                  <SelectItem value="daily" class="font-medium cursor-pointer rounded-lg">Khai báo hàng ngày</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <!-- Date & Time Row -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-3">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Thời hạn</label>
              <div class="relative">
                <CalendarDays class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input v-model="dueDate" type="date" class="w-full h-11 pl-9 pr-3 rounded-xl bg-white border border-zinc-200/60 shadow-sm text-sm font-semibold text-zinc-700 outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/5 transition-all" />
              </div>
            </div>
            <div class="space-y-3">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Giờ dự kiến</label>
              <div class="relative">
                <Clock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input v-model="estimatedHours" type="number" step="0.5" min="0" placeholder="0.0" class="w-full h-11 pl-9 pr-3 rounded-xl bg-white border border-zinc-200/60 shadow-sm text-sm font-semibold text-zinc-700 outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/5 transition-all" />
              </div>
            </div>
          </div>

          <!-- Submit Action -->
          <div class="mt-auto pt-6">
            <Button @click="handleSubmit" class="w-full h-12 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white shadow-lg shadow-zinc-900/20 font-bold text-[15px] transition-all hover:shadow-xl hover:-translate-y-0.5">
              Giao việc ngay
            </Button>
          </div>

        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* Custom Scrollbar for Textarea if needed */
textarea::-webkit-scrollbar {
  width: 6px;
}
textarea::-webkit-scrollbar-track {
  background: transparent;
}
textarea::-webkit-scrollbar-thumb {
  background-color: #e4e4e7;
  border-radius: 20px;
}
</style>
