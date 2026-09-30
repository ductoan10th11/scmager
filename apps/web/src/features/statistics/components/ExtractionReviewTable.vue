<script setup>
import { ref } from 'vue'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  CheckCircle2, 
  Save, 
  Quote, 
  Edit3, 
  Check, 
  X,
  FileCheck,
  AlertCircle
} from 'lucide-vue-next'

const props = defineProps({
  metrics: {
    type: Array,
    required: true,
  },
  isSubmitting: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['toggleStatus', 'commitAll', 'updateMetric'])

const editingId = ref(null)
const editForm = ref({
  actualValue: 0,
  targetValue: 0,
  unit: '',
  note: '',
})

const startEdit = (metric) => {
  editingId.value = metric.id
  editForm.value = {
    actualValue: metric.actualValue,
    targetValue: metric.targetValue || 0,
    unit: metric.unit,
    note: metric.note || '',
  }
}

const cancelEdit = () => {
  editingId.value = null
}

const saveEdit = (metric) => {
  emit('updateMetric', {
    ...metric,
    actualValue: Number(editForm.value.actualValue) || 0,
    targetValue: Number(editForm.value.targetValue) || null,
    unit: editForm.value.unit,
    note: editForm.value.note,
  })
  editingId.value = null
}

const getCategoryBadge = (cat) => {
  switch (cat) {
    case 'CHUNG': return { label: 'Toàn xã', class: 'bg-sky-50 text-sky-700 border-sky-200' }
    case 'DANG_UY': return { label: 'Đảng ủy', class: 'bg-rose-50 text-rose-700 border-rose-200' }
    case 'UBND': return { label: 'UBND', class: 'bg-blue-50 text-blue-700 border-blue-200' }
    case 'MTTQ': return { label: 'MTTQ', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    default: return { label: 'Chỉ tiêu', class: 'bg-slate-50 text-slate-700 border-slate-200' }
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Header thanh tác vụ thẩm định -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
      <div>
        <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
          <FileCheck :size="16" class="text-blue-600" />
          <span>Danh sách chỉ tiêu trích xuất từ Báo cáo</span>
          <Badge variant="outline" class="rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border-blue-200">
            {{ metrics.length }} chỉ tiêu
          </Badge>
        </h3>
        <p class="text-xs text-slate-500 mt-0.5">
          Vui lòng kiểm tra đối soát, bật/tắt Switch duyệt từng chỉ tiêu trước khi lưu vào CSDL xã.
        </p>
      </div>

      <div class="flex items-center gap-2 shrink-0 self-start sm:self-auto">
        <Button
          type="button"
          class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-4 font-semibold shadow-xs flex items-center gap-1.5"
          :disabled="isSubmitting || metrics.length === 0"
          @click="$emit('commitAll')"
        >
          <Save :size="13" />
          <span>{{ isSubmitting ? 'Đang ghi nhận...' : 'Ghi nhận toàn bộ vào CSDL' }}</span>
        </Button>
      </div>
    </div>

    <!-- Bảng đối soát -->
    <div class="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
      <div class="overflow-x-auto">
        <Table class="w-full text-xs">
          <TableHeader class="bg-slate-50 border-b border-slate-200 text-slate-700">
            <TableRow>
              <TableHead class="w-12 text-center font-bold">STT</TableHead>
              <TableHead class="w-24 font-bold">Khối</TableHead>
              <TableHead class="min-w-[180px] font-bold">Tên chỉ tiêu</TableHead>
              <TableHead class="w-24 text-right font-bold">Thực hiện</TableHead>
              <TableHead class="w-20 font-bold">Đơn vị</TableHead>
              <TableHead class="w-24 text-right font-bold">Kế hoạch</TableHead>
              <TableHead class="min-w-[260px] font-bold">Đoạn trích chứng cứ trong văn bản</TableHead>
              <TableHead class="w-24 text-center font-bold">Xác nhận</TableHead>
              <TableHead class="w-20 text-center font-bold">Thao tác</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            <TableRow
              v-for="(metric, idx) in metrics"
              :key="metric.id || idx"
              class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0"
              :class="!metric.isConfirmed ? 'opacity-60 bg-slate-50/40' : ''"
            >
              <!-- STT -->
              <TableCell class="text-center font-mono text-slate-500 text-[11px]">
                {{ idx + 1 }}
              </TableCell>

              <!-- Khối -->
              <TableCell>
                <span
                  class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                  :class="getCategoryBadge(metric.category).class"
                >
                  {{ getCategoryBadge(metric.category).label }}
                </span>
              </TableCell>

              <!-- Tên chỉ tiêu -->
              <TableCell class="font-semibold text-slate-900">
                <div>{{ metric.name }}</div>
                <div class="text-[10px] font-mono text-slate-400 font-normal">{{ metric.code }}</div>
              </TableCell>

              <!-- Giá trị thực tế -->
              <TableCell class="text-right font-bold text-slate-900">
                <template v-if="editingId === metric.id">
                  <Input
                    v-model="editForm.actualValue"
                    type="number"
                    step="any"
                    class="h-7 text-xs w-20 text-right ml-auto"
                  />
                </template>
                <template v-else>
                  <span class="text-blue-700 font-extrabold text-sm">
                    {{ Number(metric.actualValue).toLocaleString('vi-VN') }}
                  </span>
                </template>
              </TableCell>

              <!-- Đơn vị -->
              <TableCell class="text-slate-600 font-medium">
                <template v-if="editingId === metric.id">
                  <Input
                    v-model="editForm.unit"
                    type="text"
                    class="h-7 text-xs w-16"
                  />
                </template>
                <template v-else>
                  {{ metric.unit }}
                </template>
              </TableCell>

              <!-- Kế hoạch -->
              <TableCell class="text-right text-slate-500">
                <template v-if="editingId === metric.id">
                  <Input
                    v-model="editForm.targetValue"
                    type="number"
                    step="any"
                    class="h-7 text-xs w-20 text-right ml-auto"
                  />
                </template>
                <template v-else>
                  {{ metric.targetValue ? Number(metric.targetValue).toLocaleString('vi-VN') : '-' }}
                </template>
              </TableCell>

              <!-- Đoạn trích chứng cứ -->
              <TableCell class="text-slate-600 text-[11px] leading-relaxed">
                <div class="flex items-start gap-1.5 p-2 rounded-lg bg-amber-50/70 border border-amber-200/60 text-amber-900 italic">
                  <Quote :size="12" class="text-amber-600 shrink-0 mt-0.5" />
                  <span>{{ metric.sourceEvidence || 'Trích xuất tự động từ văn bản' }}</span>
                </div>
              </TableCell>

              <!-- Thuộc tính trạng thái: BẮT BUỘC DÙNG SWITCH BUTTON theo User Rule -->
              <TableCell class="text-center">
                <div class="flex items-center justify-center">
                  <Switch
                    :checked="metric.isConfirmed"
                    @update:checked="(val) => $emit('toggleStatus', metric.id, val)"
                  />
                </div>
              </TableCell>

              <!-- Thao tác Sửa/Lưu -->
              <TableCell class="text-center">
                <template v-if="editingId === metric.id">
                  <div class="flex items-center justify-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      class="h-6 w-6 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      @click="saveEdit(metric)"
                    >
                      <Check :size="12" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      class="h-6 w-6 rounded-full border-slate-300"
                      @click="cancelEdit"
                    >
                      <X :size="12" />
                    </Button>
                  </div>
                </template>
                <template v-else>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                    @click="startEdit(metric)"
                  >
                    <Edit3 :size="13" />
                  </Button>
                </template>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  </div>
</template>
