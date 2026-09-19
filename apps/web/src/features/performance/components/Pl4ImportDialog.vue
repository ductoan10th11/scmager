<script setup>
import { computed, ref, watch } from 'vue'
import { Download, FileSpreadsheet, Upload, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PerformanceService } from '../services/performance.service'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'imported'])
const importFile = ref(null)
const importInput = ref(null)
const importError = ref(null)
const importResult = ref(null)
const importing = ref(false)
const checking = ref(false)
const preview = ref(null)
const downloadingTemplate = ref(false)
const dragging = ref(false)

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const fileSize = computed(() => {
  const bytes = importFile.value?.size ?? 0
  if (!bytes) return ''
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})

const reset = () => {
  importFile.value = null
  importError.value = null
  importResult.value = null
  preview.value = null
  dragging.value = false
  if (importInput.value) importInput.value.value = ''
}

watch(() => props.open, (open) => {
  if (open) reset()
})

const close = () => emit('update:open', false)

// Accept a file from either the picker or a drop, rejecting anything that is
// clearly not a .xlsx before it reaches the server.
const acceptFile = (file) => {
  if (!file) return
  const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.type === XLSX_MIME
  if (!isXlsx) {
    importError.value = 'Chỉ nhận tệp Excel .xlsx đúng mẫu PL4.'
    return
  }
  importFile.value = file
  importError.value = null
  importResult.value = null
  preview.value = null
}

const selectFile = (event) => acceptFile(event.target.files?.[0])
const onDrop = (event) => {
  dragging.value = false
  acceptFile(event.dataTransfer?.files?.[0])
}
const clearFile = () => {
  importFile.value = null
  preview.value = null
  importError.value = null
  if (importInput.value) importInput.value.value = ''
}

const downloadTemplate = async () => {
  downloadingTemplate.value = true
  importError.value = null
  try {
    const { blob, filename } = await PerformanceService.downloadImportTemplate()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch (requestError) {
    importError.value = requestError.message || 'Không tải được file mẫu.'
  } finally {
    downloadingTemplate.value = false
  }
}

const describeError = (requestError, fallback) => {
  const errors = requestError.details?.errors
  return Array.isArray(errors) && errors.length
    ? errors.join('\n')
    : (requestError.message || fallback)
}

// Step one: validate the file and report what would change. Nothing is written
// until the user confirms what they see.
const checkWorkbook = async () => {
  if (!importFile.value) {
    importError.value = 'Chọn file PL4 .xlsx trước khi nhập.'
    return
  }
  checking.value = true
  importError.value = null
  preview.value = null
  try {
    const response = await PerformanceService.previewWorkbook(importFile.value)
    preview.value = response.data
  } catch (requestError) {
    importError.value = describeError(requestError, 'Không kiểm tra được file.')
  } finally {
    checking.value = false
  }
}

// Step two: the user confirmed, so write it.
const importWorkbook = async () => {
  if (!importFile.value || !preview.value) return
  importing.value = true
  importError.value = null
  try {
    const response = await PerformanceService.importWorkbook(importFile.value)
    importResult.value = response.data
    emit('imported', response.data)
  } catch (requestError) {
    importError.value = describeError(requestError, 'Không thể nhập bảng KPI.')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>Thêm hàng loạt</DialogTitle>
        <DialogDescription>
          Nhập file KPI PL4 để tạo hoặc cập nhật các nhiệm vụ. Chỉ nhận tệp <code>.xlsx</code> đúng mẫu;
          sai cấu trúc, có công thức, macro hoặc liên kết ngoài đều bị từ chối.
        </DialogDescription>
      </DialogHeader>

      <div v-if="!importResult" class="grid gap-4 py-1">
        <!-- Downloading the blank form first is the reliable path: it is the very
             file the importer validates against. -->
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3">
          <div class="min-w-0">
            <p class="text-sm font-bold text-sky-900">Chưa có file mẫu?</p>
            <p class="mt-0.5 text-xs text-sky-800">Tải mẫu chuẩn, điền họ tên và các dòng nhiệm vụ rồi nhập lại.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0 gap-1.5 border-sky-300 bg-white text-sky-800 hover:bg-sky-100"
            :disabled="downloadingTemplate"
            @click="downloadTemplate"
          >
            <Download class="h-4 w-4" :class="{ 'animate-pulse': downloadingTemplate }" />
            {{ downloadingTemplate ? 'Đang tải' : 'Tải file mẫu' }}
          </Button>
        </div>

        <!-- Large drop zone: the whole area is clickable and accepts a dragged file. -->
        <div
          class="relative rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
          :class="dragging ? 'border-sky-500 bg-sky-50' : 'border-zinc-300 bg-zinc-50/60 hover:border-zinc-400 hover:bg-zinc-50'"
          @dragover.prevent="dragging = true"
          @dragenter.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
          @click="importInput?.click()"
        >
          <input
            ref="importInput"
            type="file"
            class="hidden"
            accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx"
            @change="selectFile"
          />
          <template v-if="importFile">
            <FileSpreadsheet class="mx-auto h-10 w-10 text-emerald-600" />
            <p class="mt-3 truncate text-sm font-bold text-zinc-900">{{ importFile.name }}</p>
            <p class="mt-0.5 text-xs text-zinc-500">{{ fileSize }} · bấm để chọn tệp khác</p>
            <button
              type="button"
              class="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-600 shadow-sm hover:text-rose-700"
              @click.stop="clearFile"
            ><X class="h-3 w-3" />Bỏ tệp này</button>
          </template>
          <template v-else>
            <Upload class="mx-auto h-10 w-10" :class="dragging ? 'text-sky-600' : 'text-zinc-400'" />
            <p class="mt-3 text-sm font-bold text-zinc-800">Kéo thả file PL4 vào đây</p>
            <p class="mt-1 text-xs text-zinc-500">hoặc bấm để chọn tệp từ máy · chỉ nhận .xlsx</p>
          </template>
        </div>

        <!-- What the file would do, shown before anything is written. -->
        <div v-if="preview" class="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <p class="text-sm font-bold text-emerald-900">File hợp lệ. Xác nhận trước khi ghi vào hệ thống:</p>
          <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-xs text-emerald-700">Nhập KPI cho</dt>
              <dd class="mt-0.5 font-bold text-zinc-900">{{ preview.user.fullName }}</dd>
              <dd class="text-xs text-zinc-600">
                {{ preview.user.username }}<template v-if="preview.user.departmentName"> · {{ preview.user.departmentName }}</template>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-emerald-700">Số dòng nhiệm vụ</dt>
              <dd class="mt-0.5 font-bold text-zinc-900">{{ preview.importedRows }}</dd>
              <dd class="text-xs text-zinc-600">
                tạo mới {{ preview.createdDocuments }} · cập nhật {{ preview.updatedDocuments }}
              </dd>
            </div>
          </dl>

          <div class="mt-3 max-h-52 overflow-auto rounded-md border border-emerald-200 bg-white">
            <table class="w-full text-left text-xs">
              <thead class="sticky top-0 bg-zinc-50 text-zinc-500">
                <tr>
                  <th class="px-2 py-1.5 font-semibold">#</th>
                  <th class="px-2 py-1.5 font-semibold">Nhiệm vụ</th>
                  <th class="px-2 py-1.5 font-semibold">Hạn</th>
                  <th class="px-2 py-1.5 text-right font-semibold">Điểm</th>
                  <th class="px-2 py-1.5 font-semibold">Xử lý</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr v-for="row in preview.rows" :key="row.order">
                  <td class="px-2 py-1.5 text-zinc-400">{{ row.order }}</td>
                  <td class="max-w-[240px] truncate px-2 py-1.5 text-zinc-800" :title="row.content">{{ row.content }}</td>
                  <td class="whitespace-nowrap px-2 py-1.5 text-zinc-600">{{ row.deadline }}</td>
                  <td class="px-2 py-1.5 text-right font-semibold text-zinc-800">{{ row.point }}</td>
                  <td class="whitespace-nowrap px-2 py-1.5">
                    <span v-if="row.action === 'create'" class="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">Tạo mới</span>
                    <span v-else class="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800" :title="row.matchedSoKyHieu">Cập nhật</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="mt-3 text-xs text-emerald-800">
            Bấm “Xác nhận nhập” để ghi. Nếu có bất kỳ dòng nào lỗi, toàn bộ sẽ được hoàn tác.
          </p>
        </div>

        <p
          v-if="importError"
          class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium leading-6 text-rose-700"
        >{{ importError }}</p>
      </div>

      <div v-else class="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <p class="font-bold">Đã nhập {{ importResult.importedRows }} dòng cho {{ importResult.user.fullName }}.</p>
        <p class="mt-1">Tạo {{ importResult.createdDocuments }} và cập nhật {{ importResult.updatedDocuments }} nhiệm vụ.</p>
      </div>

      <DialogFooter class="gap-2 sm:gap-2">
        <Button variant="outline" :disabled="importing || checking" @click="close">{{ importResult ? 'Đóng' : 'Hủy' }}</Button>
        <Button
          v-if="!importResult && !preview"
          :disabled="checking || !importFile"
          @click="checkWorkbook"
        >
          <FileSpreadsheet class="h-4 w-4" :class="{ 'animate-pulse': checking }" />{{ checking ? 'Đang kiểm tra' : 'Kiểm tra file' }}
        </Button>
        <Button
          v-if="!importResult && preview"
          :disabled="importing"
          @click="importWorkbook"
        >
          <Upload class="h-4 w-4" :class="{ 'animate-pulse': importing }" />{{ importing ? 'Đang nhập' : `Xác nhận nhập ${preview.importedRows} dòng` }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
