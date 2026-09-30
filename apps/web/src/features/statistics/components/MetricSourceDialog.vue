<script setup>
import { computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { 
  FileText, 
  Quote, 
  Calendar, 
  User, 
  Layers,
  ArrowRight,
  Download,
} from 'lucide-vue-next'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  metric: {
    type: Object,
    default: null,
  },
  sourceReport: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['update:open', 'selectReport'])

const categoryLabel = computed(() => {
  if (!props.metric) return ''
  switch (props.metric.category) {
    case 'CHUNG': return 'Chung toàn xã'
    case 'DANG_UY': return 'Khối Đảng ủy'
    case 'UBND': return 'Khối UBND'
    case 'MTTQ': return 'Khối MTTQ & Đoàn thể'
    default: return 'Chỉ tiêu KTXH'
  }
})

const formattedActual = computed(() => {
  if (!props.metric) return '0'
  const val = props.metric.actualValue
  if (typeof val === 'number') {
    return val.toLocaleString('vi-VN')
  }
  return val
})

const handleJumpToReport = () => {
  emit('update:open', false)
  emit('selectReport', props.sourceReport)
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => $emit('update:open', val)">
    <DialogContent class="w-[95vw] sm:max-w-[540px] p-0 rounded-2xl overflow-hidden border border-zinc-200 bg-white text-zinc-900 shadow-2xl">
      <!-- Header Dialog Light Theme -->
      <div class="px-5 pt-5 pb-4 border-b border-zinc-100 bg-zinc-50/50">
        <div class="flex items-center justify-between gap-3 mb-1">
          <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Layers :size="12" />
            <span>{{ categoryLabel }}</span>
          </div>
          <span class="text-xs text-zinc-400 font-mono">Mã: {{ metric?.code }}</span>
        </div>

        <DialogTitle class="text-lg sm:text-xl font-bold text-zinc-900 flex items-center gap-2">
          <span>{{ metric?.name }}</span>
        </DialogTitle>
        <DialogDescription class="text-xs text-zinc-500 mt-0.5">
          Thông tin chi tiết và chứng cứ trích xuất từ văn bản báo cáo gốc gần nhất.
        </DialogDescription>
      </div>

      <div class="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        <!-- Box hiển thị số liệu thực hiện -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-zinc-50 border border-zinc-200/80">
          <div>
            <span class="text-[11px] text-zinc-500 font-medium block">Số liệu ghi nhận</span>
            <div class="flex items-baseline gap-1 mt-0.5">
              <span class="text-2xl font-extrabold text-blue-600">
                {{ formattedActual }}
              </span>
              <span class="text-xs font-semibold text-zinc-500">{{ metric?.unit }}</span>
            </div>
          </div>

          <div v-if="metric?.targetValue">
            <span class="text-[11px] text-zinc-500 font-medium block">Kế hoạch giao</span>
            <div class="flex items-baseline gap-1 mt-0.5">
              <span class="text-xl font-bold text-zinc-800">
                {{ metric.targetValue.toLocaleString('vi-VN') }}
              </span>
              <span class="text-xs text-zinc-400">{{ metric.unit }}</span>
            </div>
          </div>

          <div v-if="metric?.completionRate">
            <span class="text-[11px] text-zinc-500 font-medium block">Tiến độ hoàn thành</span>
            <div class="flex items-baseline gap-1 mt-0.5">
              <span class="text-xl font-bold" :class="metric.completionRate >= 100 ? 'text-emerald-600' : 'text-amber-600'">
                {{ metric.completionRate }}%
              </span>
              <span class="text-xs text-zinc-400">kế hoạch</span>
            </div>
          </div>
        </div>

        <!-- Báo cáo nguồn gần nhất -->
        <div class="space-y-2">
          <div class="flex items-center gap-1.5 text-xs font-bold text-zinc-700 uppercase tracking-wider">
            <FileText :size="14" class="text-blue-600" />
            <span>VĂN BẢN BÁO CÁO NGUỒN GẦN NHẤT</span>
          </div>

          <div v-if="sourceReport" class="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200/70 space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h4 class="text-xs sm:text-sm font-bold text-zinc-900 leading-snug">
                  {{ sourceReport.title }}
                </h4>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-zinc-600">
                  <span v-if="sourceReport.code" class="text-blue-700 font-bold font-mono">
                    Số: {{ sourceReport.code }}
                  </span>
                  <span class="flex items-center gap-1 text-zinc-500">
                    <Calendar :size="11" /> {{ sourceReport.period }} ({{ sourceReport.year }})
                  </span>
                  <span class="flex items-center gap-1 text-zinc-500">
                    <User :size="11" /> {{ sourceReport.uploadedBy }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Tệp đính kèm -->
            <div class="text-[11px] text-zinc-500 flex items-center justify-between pt-1.5 border-t border-blue-200/50">
              <div class="flex items-center gap-1.5 truncate">
                <span class="font-mono text-blue-700 font-medium truncate">{{ sourceReport.fileName }}</span>
                <span v-if="sourceReport.fileSize">•</span>
                <span v-if="sourceReport.fileSize">{{ sourceReport.fileSize }}</span>
              </div>
              <a
                v-if="sourceReport._id || sourceReport.id"
                :href="`/api/commune-stats/reports/${sourceReport._id || sourceReport.id}/download`"
                target="_blank"
                class="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold underline shrink-0 cursor-pointer ml-2"
                title="Tải tệp báo cáo gốc về máy"
              >
                <Download :size="12" />
                <span>Tải tệp</span>
              </a>
            </div>
          </div>

          <div v-else class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-500 italic">
            Chưa gắn với tệp báo cáo cụ thể (Số liệu nhập trực tiếp bởi chuyên viên).
          </div>
        </div>

        <!-- Đoạn trích chứng cứ trong văn bản -->
        <div v-if="metric?.sourceEvidence" class="space-y-1.5">
          <div class="flex items-center gap-1.5 text-xs font-bold text-amber-700 uppercase tracking-wider">
            <Quote :size="13" class="text-amber-600" />
            <span>ĐOẠN TRÍCH CHỨNG CỨ TRONG VĂN BẢN GỐC</span>
          </div>
          <div class="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs leading-relaxed italic">
            "{{ metric.sourceEvidence }}"
          </div>
        </div>

        <!-- Ghi chú nếu có -->
        <div v-if="metric?.note" class="text-xs text-zinc-500">
          <strong class="text-zinc-700">Ghi chú:</strong> {{ metric.note }}
        </div>
      </div>

      <DialogFooter class="px-5 py-3.5 bg-zinc-50/70 border-t border-zinc-100 flex items-center justify-between sm:justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          class="rounded-full text-xs h-8 px-4 border-zinc-200 text-zinc-700 hover:bg-zinc-100"
          @click="$emit('update:open', false)"
        >
          Đóng
        </Button>

        <Button
          v-if="sourceReport"
          type="button"
          class="rounded-full text-xs h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs flex items-center gap-1.5"
          @click="handleJumpToReport"
        >
          <span>Xem trong trang Báo cáo</span>
          <ArrowRight :size="13" />
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
