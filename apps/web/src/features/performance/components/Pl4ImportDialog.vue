<script setup>
import { ref, watch } from 'vue'
import { Upload } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PerformanceService } from '../services/performance.service'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'imported'])
const importFile = ref(null)
const importInput = ref(null)
const importError = ref(null)
const importResult = ref(null)
const importing = ref(false)

const reset = () => {
  importFile.value = null
  importError.value = null
  importResult.value = null
  if (importInput.value) importInput.value.value = ''
}

watch(() => props.open, (open) => {
  if (open) reset()
})

const close = () => emit('update:open', false)

const selectFile = (event) => {
  importFile.value = event.target.files?.[0] || null
  importError.value = null
  importResult.value = null
}

const importWorkbook = async () => {
  if (!importFile.value) {
    importError.value = 'Chọn file PL4 .xlsx trước khi nhập.'
    return
  }
  importing.value = true
  importError.value = null
  importResult.value = null
  try {
    const response = await PerformanceService.importWorkbook(importFile.value)
    importResult.value = response.data
    emit('imported', response.data)
  } catch (requestError) {
    const errors = requestError.details?.errors
    importError.value = Array.isArray(errors) && errors.length
      ? errors.join('\n')
      : (requestError.message || 'Không thể nhập bảng KPI.')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>Thêm hàng loạt</DialogTitle>
        <DialogDescription>Nhập file KPI PL4 để tạo hoặc cập nhật các nhiệm vụ. Chỉ nhận `.xlsx` đúng mẫu; sai cấu trúc, công thức nhập liệu, macro hoặc liên kết ngoài đều bị từ chối.</DialogDescription>
      </DialogHeader>
      <div v-if="!importResult" class="grid gap-3 py-2">
        <label class="grid gap-2 text-sm font-semibold text-zinc-700"><span>File PL4</span><Input ref="importInput" type="file" accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" class="h-10 cursor-pointer" @change="selectFile" /></label>
        <p v-if="importFile" class="text-xs font-medium text-zinc-600">{{ importFile.name }}</p>
        <p v-if="importError" class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium leading-6 text-rose-700">{{ importError }}</p>
      </div>
      <div v-else class="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><p class="font-bold">Đã nhập {{ importResult.importedRows }} dòng cho {{ importResult.user.fullName }}.</p><p class="mt-1">Tạo {{ importResult.createdDocuments }} và cập nhật {{ importResult.updatedDocuments }} nhiệm vụ.</p></div>
      <DialogFooter class="gap-2 sm:gap-2">
        <Button variant="outline" :disabled="importing" @click="close">{{ importResult ? 'Đóng' : 'Hủy' }}</Button>
        <Button v-if="!importResult" :disabled="importing || !importFile" @click="importWorkbook"><Upload class="h-4 w-4" :class="{ 'animate-pulse': importing }" />{{ importing ? 'Đang kiểm tra và nhập' : 'Kiểm tra và nhập' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
