<script setup>
import { ref } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlusCircle, Sparkles } from 'lucide-vue-next'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:open', 'created'])

const form = ref({
  code: '',
  name: '',
  category: 'CHUNG',
  unit: 'người',
  actualValue: '',
  targetValue: '',
  period: 'Tháng 9/2026',
  year: 2026,
  sourceEvidence: '',
  note: '',
})

const isSubmitting = ref(false)

const resetForm = () => {
  form.value = {
    code: '',
    name: '',
    category: 'CHUNG',
    unit: 'người',
    actualValue: '',
    targetValue: '',
    period: 'Tháng 9/2026',
    year: 2026,
    sourceEvidence: '',
    note: '',
  }
}

const handleSubmit = () => {
  if (!form.value.name || !form.value.actualValue) return
  isSubmitting.value = true

  const newMetric = {
    code: form.value.code || 'CT-' + Date.now().toString().slice(-4),
    name: form.value.name,
    category: form.value.category,
    unit: form.value.unit,
    actualValue: Number(form.value.actualValue),
    targetValue: form.value.targetValue ? Number(form.value.targetValue) : null,
    period: form.value.period,
    year: Number(form.value.year) || 2026,
    sourceEvidence: form.value.sourceEvidence || 'Số liệu nhập trực tiếp bởi chuyên viên.',
    note: form.value.note || 'Cán bộ cập nhật thủ công.',
    isConfirmed: true,
  }

  emit('created', newMetric)
  emit('update:open', false)
  resetForm()
  isSubmitting.value = false
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => $emit('update:open', val)">
    <DialogContent class="w-[95vw] sm:max-w-[500px] p-5 rounded-2xl border-slate-200 shadow-xl bg-white">
      <DialogHeader>
        <DialogTitle class="text-base font-bold text-slate-900 flex items-center gap-2">
          <PlusCircle :size="18" class="text-blue-600" />
          <span>Nhập số liệu chỉ tiêu mới</span>
        </DialogTitle>
        <DialogDescription class="text-xs text-slate-500">
          Dành cho các chỉ tiêu bổ sung hoặc cập nhật định kỳ không qua tệp văn bản.
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-3.5 py-2 text-xs" @submit.prevent="handleSubmit">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="font-semibold text-slate-700">Khối quản lý *</label>
            <select
              v-model="form.category"
              class="w-full text-xs h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="CHUNG">Chung toàn xã</option>
              <option value="DANG_UY">Khối Đảng ủy</option>
              <option value="UBND">Khối UBND</option>
              <option value="MTTQ">Khối MTTQ & Đoàn thể</option>
            </select>
          </div>

          <div class="space-y-1">
            <label class="font-semibold text-slate-700">Mã chỉ tiêu (tùy chọn)</label>
            <Input
              v-model="form.code"
              placeholder="VD: DAN_SO, THU_NGAN_SACH..."
              class="h-8 text-xs rounded-lg"
            />
          </div>
        </div>

        <div class="space-y-1">
          <label class="font-semibold text-slate-700">Tên chỉ tiêu *</label>
          <Input
            v-model="form.name"
            required
            placeholder="VD: Tổng số hộ dân, Số thôn văn hóa..."
            class="h-8 text-xs rounded-lg"
          />
        </div>

        <div class="grid grid-cols-3 gap-2.5">
          <div class="space-y-1">
            <label class="font-semibold text-slate-700">Giá trị thực tế *</label>
            <Input
              v-model="form.actualValue"
              required
              type="number"
              step="any"
              placeholder="18642"
              class="h-8 text-xs rounded-lg font-bold"
            />
          </div>

          <div class="space-y-1">
            <label class="font-semibold text-slate-700">Đơn vị tính *</label>
            <Input
              v-model="form.unit"
              required
              placeholder="người, %, tỷ..."
              class="h-8 text-xs rounded-lg"
            />
          </div>

          <div class="space-y-1">
            <label class="font-semibold text-slate-700">Kế hoạch giao</label>
            <Input
              v-model="form.targetValue"
              type="number"
              step="any"
              placeholder="18700"
              class="h-8 text-xs rounded-lg"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="font-semibold text-slate-700">Kỳ báo cáo</label>
            <Input
              v-model="form.period"
              placeholder="Tháng 9/2026, Năm 2026"
              class="h-8 text-xs rounded-lg"
            />
          </div>
          <div class="space-y-1">
            <label class="font-semibold text-slate-700">Năm</label>
            <Input
              v-model="form.year"
              type="number"
              placeholder="2026"
              class="h-8 text-xs rounded-lg"
            />
          </div>
        </div>

        <div class="space-y-1">
          <label class="font-semibold text-slate-700">Chứng cứ / Căn cứ số liệu</label>
          <Input
            v-model="form.sourceEvidence"
            placeholder="VD: Theo số liệu rà soát của Công an xã ngày 15/9/2026..."
            class="h-8 text-xs rounded-lg"
          />
        </div>

        <DialogFooter class="flex-row items-center justify-end gap-2 pt-3 border-t border-slate-100 mt-2">
          <Button
            type="button"
            variant="outline"
            class="rounded-full text-xs h-8 px-4"
            @click="$emit('update:open', false)"
          >
            Hủy
          </Button>
          <Button
            type="submit"
            class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-4 font-semibold shadow-xs"
            :disabled="!form.name || !form.actualValue || isSubmitting"
          >
            Lưu chỉ tiêu
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
