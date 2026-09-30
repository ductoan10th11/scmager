<script setup>
import { computed } from 'vue'
import {
  Users,
  Home,
  MapPin,
  Building2,
  Award,
  FileText,
  CheckCircle2,
  Coins,
  Heart,
  MessageSquare,
  TrendingUp,
} from 'lucide-vue-next'

const props = defineProps({
  metric: {
    type: Object,
    required: true,
  },
  index: {
    type: Number,
    default: 0,
  },
})

defineEmits(['click'])

const code = computed(() => props.metric.code || '')

// Cấu hình màu sắc icon gradient 3D cao cấp và viền hover
const cardStyle = computed(() => {
  switch (code.value) {
    case 'DAN_SO':
      return {
        icon: Users,
        gradient: 'from-blue-600 to-indigo-600 text-white shadow-blue-500/25',
        hoverBorder: 'hover:border-blue-400 hover:shadow-blue-500/10',
        progressBar: 'from-blue-500 to-indigo-500',
      }
    case 'HO_DAN':
      return {
        icon: Home,
        gradient: 'from-amber-500 to-orange-500 text-white shadow-amber-500/25',
        hoverBorder: 'hover:border-amber-400 hover:shadow-amber-500/10',
        progressBar: 'from-amber-500 to-orange-500',
      }
    case 'DIEN_TICH':
      return {
        icon: MapPin,
        gradient: 'from-emerald-500 to-teal-600 text-white shadow-emerald-500/25',
        hoverBorder: 'hover:border-emerald-400 hover:shadow-emerald-500/10',
        progressBar: 'from-emerald-500 to-teal-500',
      }
    case 'THON_TDP':
      return {
        icon: Building2,
        gradient: 'from-cyan-500 to-blue-600 text-white shadow-cyan-500/25',
        hoverBorder: 'hover:border-cyan-400 hover:shadow-cyan-500/10',
        progressBar: 'from-cyan-500 to-blue-500',
      }
    case 'DANG_VIEN':
      return {
        icon: Award,
        gradient: 'from-rose-500 to-red-600 text-white shadow-rose-500/25',
        hoverBorder: 'hover:border-rose-400 hover:shadow-rose-500/10',
        progressBar: 'from-rose-500 to-red-500',
      }
    case 'HO_SO_HANH_CHINH':
      return {
        icon: FileText,
        gradient: 'from-purple-500 to-indigo-600 text-white shadow-purple-500/25',
        hoverBorder: 'hover:border-purple-400 hover:shadow-purple-500/10',
        progressBar: 'from-purple-500 to-indigo-500',
      }
    case 'HO_SO_DUNG_HAN':
    case 'DUNG_HAN':
      return {
        icon: CheckCircle2,
        gradient: 'from-emerald-500 to-green-600 text-white shadow-emerald-500/25',
        hoverBorder: 'hover:border-emerald-400 hover:shadow-emerald-500/10',
        progressBar: 'from-emerald-500 to-green-500',
      }
    case 'THU_NGAN_SACH':
      return {
        icon: Coins,
        gradient: 'from-amber-400 to-amber-600 text-white shadow-amber-500/25',
        hoverBorder: 'hover:border-amber-400 hover:shadow-amber-500/10',
        progressBar: 'from-amber-400 to-amber-600',
      }
    case 'HO_NGHEO_CAN_NGHEO':
    case 'HO_NGHEO':
      return {
        icon: Heart,
        gradient: 'from-rose-400 to-rose-600 text-white shadow-rose-500/25',
        hoverBorder: 'hover:border-rose-400 hover:shadow-rose-500/10',
        progressBar: 'from-rose-400 to-rose-600',
      }
    case 'PHAN_ANH_KIEN_NGHI':
    case 'KIEN_NGHI':
      return {
        icon: MessageSquare,
        gradient: 'from-indigo-500 to-blue-600 text-white shadow-indigo-500/25',
        hoverBorder: 'hover:border-indigo-400 hover:shadow-indigo-500/10',
        progressBar: 'from-indigo-500 to-blue-500',
      }
    default:
      return {
        icon: TrendingUp,
        gradient: 'from-blue-600 to-indigo-600 text-white shadow-blue-500/25',
        hoverBorder: 'hover:border-blue-400 hover:shadow-blue-500/10',
        progressBar: 'from-blue-500 to-indigo-500',
      }
  }
})

// Định dạng giá trị hiển thị chuẩn Việt Nam
const formattedValue = computed(() => {
  const val = props.metric.actualValue
  if (val === null || val === undefined) return '0'
  if (typeof val === 'number') {
    if (val % 1 !== 0) {
      return val.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    }
    return val.toLocaleString('vi-VN')
  }
  return String(val)
})
</script>

<template>
  <div
    class="group relative bg-white rounded-2xl border border-zinc-200/80 p-4 sm:p-4.5 flex flex-col justify-between shadow-2xs hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer select-none"
    :class="cardStyle.hoverBorder"
    @click="$emit('click', metric)"
  >
    <!-- Hàng trên: Icon gradient 3D nổi bật + Badge hoàn thành kế hoạch gọn gàng -->
    <div class="flex items-center justify-between gap-2 mb-3">
      <div
        class="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md transition-transform duration-300 group-hover:scale-105 shrink-0"
        :class="cardStyle.gradient"
      >
        <component :is="cardStyle.icon" :size="20" class="text-white drop-shadow-xs" />
      </div>

      <span
        v-if="metric.completionRate"
        class="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors"
        :class="metric.completionRate >= 100
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
          : 'bg-blue-50 text-blue-700 border border-blue-200/80'"
      >
        <span
          class="w-1.5 h-1.5 rounded-full shrink-0"
          :class="metric.completionRate >= 100 ? 'bg-emerald-500' : 'bg-blue-500'"
        />
        <span>{{ metric.completionRate }}%</span>
      </span>
    </div>

    <!-- Hàng nội dung: Tên chỉ tiêu + Giá trị số lớn + Đơn vị -->
    <div class="space-y-1.5">
      <div class="text-xs sm:text-[13px] font-bold text-zinc-600 group-hover:text-blue-600 transition-colors truncate">
        {{ metric.name }}
      </div>

      <div class="flex items-baseline gap-1.5 flex-wrap">
        <span class="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight leading-none font-mono">
          {{ formattedValue }}
        </span>
        <span v-if="metric.unit" class="text-xs font-semibold text-zinc-500">
          {{ metric.unit }}
        </span>
      </div>

      <!-- Micro-progress bar tinh tế thể hiện mức hoàn thành khi có chỉ tiêu -->
      <div v-if="metric.completionRate" class="w-full bg-zinc-100 rounded-full h-1.5 mt-2.5 overflow-hidden">
        <div
          class="h-full rounded-full bg-gradient-to-r transition-all duration-500"
          :class="cardStyle.progressBar"
          :style="{ width: `${Math.min(metric.completionRate, 100)}%` }"
        />
      </div>
    </div>
  </div>
</template>
