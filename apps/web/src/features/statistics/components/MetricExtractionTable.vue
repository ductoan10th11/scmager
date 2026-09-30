<script setup>
import { ref, computed } from 'vue'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Database } from 'lucide-vue-next'

const props = defineProps({
  metrics: {
    type: Array,
    default: () => [],
  },
  isSubmitting: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['toggle-status', 'commit-all'])

const selectedCategory = ref('ALL')

const categories = computed(() => {
  const cats = new Set(props.metrics.map((m) => m.category).filter(Boolean))
  return ['ALL', ...Array.from(cats)]
})

const filteredMetrics = computed(() => {
  if (selectedCategory.value === 'ALL') return props.metrics
  return props.metrics.filter((m) => m.category === selectedCategory.value)
})

const confirmedCount = computed(() => props.metrics.filter((m) => m.isConfirmed).length)

const handleSwitchChange = (metric, checked) => {
  emit('toggle-status', metric.id, checked)
}

const handleCommit = () => {
  emit('commit-all')
}
</script>

<template>
  <div class="w-full min-w-0 bg-white rounded-xl border border-blue-100/90 shadow-none overflow-hidden">
    <!-- Header & Controls: Responsive trên cả mobile và desktop -->
    <div class="p-3.5 sm:p-4 border-b border-blue-100 flex flex-col gap-3">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h3 class="text-sm sm:text-base font-semibold text-slate-900 leading-tight">
            Danh mục chỉ tiêu thống kê
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">
            Bật công tắc để xác nhận đưa chỉ tiêu vào cơ sở dữ liệu số của xã.
          </p>
        </div>

        <Button
          type="button"
          class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3.5 shadow-xs self-start sm:self-auto shrink-0 font-medium"
          :disabled="isSubmitting || confirmedCount === 0"
          @click="handleCommit"
        >
          <Database :size="13" class="mr-1.5" />
          <span>Ghi nhận CSDL ({{ confirmedCount }})</span>
        </Button>
      </div>

      <!-- Bộ lọc lĩnh vực: Thanh cuộn ngang mượt mà trên màn hình nhỏ -->
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 -mx-1 px-1">
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          :class="[
            'text-xs px-2.5 py-1 rounded-full font-medium transition-colors shrink-0 whitespace-nowrap border',
            selectedCategory === cat 
              ? 'bg-blue-600 text-white border-blue-600 shadow-xs' 
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'
          ]"
          @click="selectedCategory = cat"
        >
          {{ cat === 'ALL' ? 'Tất cả' : cat }}
        </button>
      </div>
    </div>

    <!-- Bảng dữ liệu có scroll ngang an toàn trên mobile và width đồng nhất -->
    <div class="w-full min-w-0 overflow-x-auto">
      <Table class="w-full min-w-[640px]">
        <TableHeader class="bg-blue-50/50 border-b border-blue-100/80">
          <TableRow class="hover:bg-transparent border-blue-100/70">
            <TableHead class="w-[75px] text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider pl-4">Mã</TableHead>
            <TableHead class="text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider">Chỉ tiêu</TableHead>
            <TableHead class="w-[130px] text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider">Lĩnh vực</TableHead>
            <TableHead class="w-[85px] text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider text-right">Đơn vị</TableHead>
            <TableHead class="w-[95px] text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider text-right">Kế hoạch</TableHead>
            <TableHead class="w-[95px] text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider text-right">Thực hiện</TableHead>
            <TableHead class="w-[85px] text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider text-center">Tiến độ</TableHead>
            <TableHead class="w-[110px] text-[11px] font-semibold text-blue-900/70 uppercase tracking-wider text-center pr-4">Ghi nhận</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="metric in filteredMetrics"
            :key="metric.id"
            class="hover:bg-blue-50/40 border-slate-100 transition-colors"
          >
            <!-- Mã -->
            <TableCell class="font-mono text-xs text-slate-400 font-medium pl-4 py-2.5">
              {{ metric.code }}
            </TableCell>

            <!-- Tên chỉ tiêu -->
            <TableCell class="py-2.5">
              <div class="flex flex-col pr-2">
                <span class="text-xs sm:text-sm font-medium text-slate-900 leading-snug">
                  {{ metric.name }}
                </span>
                <span v-if="metric.note" class="text-[11px] text-slate-400 mt-0.5 line-clamp-1" :title="metric.note">
                  {{ metric.note }}
                </span>
              </div>
            </TableCell>

            <!-- Lĩnh vực -->
            <TableCell class="py-2.5">
              <Badge variant="outline" class="text-[10px] font-medium bg-blue-50 text-blue-700 border-blue-200/80 shrink-0">
                {{ metric.category }}
              </Badge>
            </TableCell>

            <!-- Đơn vị -->
            <TableCell class="text-xs text-slate-500 text-right py-2.5">
              {{ metric.unit }}
            </TableCell>

            <!-- Kế hoạch -->
            <TableCell class="text-xs text-slate-600 text-right tabular-nums py-2.5">
              {{ Number(metric.targetValue).toLocaleString('vi-VN') }}
            </TableCell>

            <!-- Thực hiện -->
            <TableCell class="text-xs font-semibold text-slate-900 text-right tabular-nums py-2.5">
              {{ Number(metric.actualValue).toLocaleString('vi-VN') }}
            </TableCell>

            <!-- Tiến độ -->
            <TableCell class="text-center py-2.5">
              <span class="text-xs font-medium tabular-nums" :class="metric.completionRate >= 100 ? 'text-blue-700 font-bold' : 'text-slate-600'">
                {{ metric.completionRate }}%
              </span>
            </TableCell>

            <!-- Switch Trạng thái (Tuân thủ rule frontend) -->
            <TableCell class="text-center py-2.5 pr-4">
              <div class="flex items-center justify-center">
                <Switch
                  :checked="metric.isConfirmed"
                  @update:checked="(val) => handleSwitchChange(metric, val)"
                />
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="filteredMetrics.length === 0">
            <TableCell colspan="8" class="h-24 text-center text-xs text-slate-400">
              Không có chỉ tiêu nào trong lĩnh vực này.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Footer tóm tắt số liệu -->
    <div class="px-4 py-2.5 bg-blue-50/30 border-t border-blue-100 flex items-center justify-between text-xs text-slate-500">
      <span>Tổng số: <strong class="text-slate-800">{{ metrics.length }}</strong> chỉ tiêu</span>
      <span>Đã bật: <strong class="text-blue-700 font-semibold">{{ confirmedCount }}</strong></span>
    </div>
  </div>
</template>
