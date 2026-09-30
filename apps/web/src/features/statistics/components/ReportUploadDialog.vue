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
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  ArrowLeft,
  Building2,
  Calendar,
  Quote,
  ShieldCheck,
  AlertCircle,
  Trash2,
} from 'lucide-vue-next'
import { CommuneStatService } from '../services/commune-stat.service'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:open', 'extracted', 'saved'])

// Các giai đoạn (steps): 'UPLOAD' -> 'EXTRACTING' -> 'REVIEW'
const currentStep = ref('UPLOAD')
const errorMessage = ref('')

const fileInputRef = ref(null)
const selectedFile = ref(null)
const isExtracting = ref(false)
const isSubmitting = ref(false)
const progressValue = ref(0)
const progressStatusText = ref('')
let progressInterval = null

// Chuẩn hóa chuỗi văn bản: Xóa lỗi mojibake, ngắt dòng thừa \r\n, khoảng trắng thừa
const cleanText = (val) => {
  if (!val) return ''
  let s = String(val)
  if (s.includes('Ä') || s.includes('Ì') || s.includes('£')) {
    s = s
      .replace(/ÄaÌng/g, 'Đảng')
      .replace(/Ä/g, 'Đ')
      .replace(/BaÌo/g, 'Báo')
      .replace(/caÌo/g, 'cáo')
      .replace(/coÌng/g, 'công')
      .replace(/taÌc/g, 'tác')
      .replace(/ToÌÌ/g, 'Tổ')
      .replace(/chuÌÌc/g, 'chức')
      .replace(/xaÌy/g, 'xây')
      .replace(/duÌÌ£ng/g, 'dựng')
      .replace(/naÌm/g, 'năm')
      .replace(/thaÌng/g, 'tháng')
      .replace(/xaÌ/g, 'xã')
      .replace(/kyÌ/g, 'kỳ')
      .replace(/UBND xaÌ/gi, 'UBND Xã')
      .replace(/ThiêÌ£n/g, 'Thiện')
      .replace(/Tân/g, 'Tân')
  }
  try {
    s = s.normalize('NFC')
  } catch {}
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// Kết quả bóc tách từ LLM
const extractedReport = ref(null)
const extractedMetrics = ref([])

const handleFileSelect = (event) => {
  const files = event.target.files
  if (files && files[0]) {
    selectedFile.value = files[0]
  }
}

const handleDrop = (event) => {
  event.preventDefault()
  const files = event.dataTransfer.files
  if (files && files[0]) {
    selectedFile.value = files[0]
  }
}

// Bắt đầu bóc tách số liệu bằng LLM
const startExtraction = async () => {
  if (!selectedFile.value || isExtracting.value) return

  currentStep.value = 'EXTRACTING'
  isExtracting.value = true
  errorMessage.value = ''
  progressValue.value = 10
  progressStatusText.value = 'Đang tiếp nhận và kiểm tra cấu trúc tệp...'

  // Giả lập tiến trình mượt mà trong lúc LLM xử lý
  if (progressInterval) clearInterval(progressInterval)
  progressInterval = setInterval(() => {
    if (progressValue.value < 35) {
      progressValue.value += 5
      progressStatusText.value = 'Đang trích xuất nội dung văn bản (PDF / Word)...'
    } else if (progressValue.value < 70) {
      progressValue.value += 3
      progressStatusText.value = 'Mô hình AI đang đối soát & phân tích 19 chỉ tiêu điều hành...'
    } else if (progressValue.value < 92) {
      progressValue.value += 1
      progressStatusText.value = 'Đang trích xuất nguyên văn bằng chứng đối soát số liệu...'
    }
  }, 1200)

  try {
    const result = await CommuneStatService.extractReport({
      file: selectedFile.value,
    })

    if (progressInterval) clearInterval(progressInterval)
    progressValue.value = 100
    progressStatusText.value = 'Bóc tách thành công!'

    setTimeout(() => {
      extractedReport.value = {
        ...(result.report || {}),
        title: cleanText(result.report?.title),
        fileName: cleanText(result.report?.fileName || selectedFile.value?.name),
        summary: cleanText(result.report?.summary),
        agency: cleanText(result.report?.agency),
      }
      extractedMetrics.value = (result.extractedMetrics || []).map((m) => ({
        ...m,
        name: cleanText(m.name),
        sourceEvidence: cleanText(m.sourceEvidence),
      }))
      currentStep.value = 'REVIEW'
      isExtracting.value = false
    }, 400)
  } catch (error) {
    if (progressInterval) clearInterval(progressInterval)
    console.error('Lỗi trích xuất báo cáo:', error)
    errorMessage.value = error.message || 'Có lỗi xảy ra trong quá trình bóc tách. Vui lòng thử lại!'
    isExtracting.value = false
  }
}

// Chốt lưu vào CSDL
const handleConfirmAndCommit = async () => {
  if (isSubmitting.value || extractedMetrics.value.length === 0) return
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    const res = await CommuneStatService.commitMetrics(extractedMetrics.value, extractedReport.value)

    emit('saved', {
      report: res?.report || extractedReport.value,
      metricsCount: extractedMetrics.value.length,
      metrics: res?.metrics || extractedMetrics.value,
    })
    emit('extracted', {
      report: res?.report || extractedReport.value,
      extractedMetrics: res?.metrics || extractedMetrics.value,
    })
    emit('update:open', false)
    resetState()
  } catch (error) {
    console.error('Lỗi khi commit báo cáo:', error)
    errorMessage.value = error.message || 'Lỗi khi lưu dữ liệu vào hệ thống. Vui lòng thử lại!'
  } finally {
    isSubmitting.value = false
  }
}

// Tính toán lại tỷ lệ khi chỉnh sửa số liệu thực hiện
const onMetricValueChange = (metric) => {
  if (metric.targetValue && Number(metric.targetValue) > 0) {
    metric.completionRate = Math.round(((Number(metric.actualValue) || 0) / Number(metric.targetValue)) * 1000) / 10
  }
}

// Xóa chỉ tiêu không muốn cập nhật
const removeMetric = (index) => {
  extractedMetrics.value.splice(index, 1)
}

const resetState = () => {
  selectedFile.value = null
  isExtracting.value = false
  isSubmitting.value = false
  currentStep.value = 'UPLOAD'
  extractedReport.value = null
  extractedMetrics.value = []
  progressValue.value = 0
  errorMessage.value = ''
  if (progressInterval) clearInterval(progressInterval)
}

const handleClose = (value) => {
  if (!isExtracting.value && !isSubmitting.value) {
    emit('update:open', value)
    if (!value) resetState()
  }
}

const backToUpload = () => {
  currentStep.value = 'UPLOAD'
}
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent
      :class="[
        'w-[96vw] p-0 rounded-2xl overflow-hidden border border-slate-200 bg-white text-slate-900 shadow-2xl transition-all duration-300',
        currentStep === 'REVIEW' ? 'sm:max-w-5xl lg:max-w-6xl max-h-[92vh] flex flex-col' : 'sm:max-w-[500px]'
      ]"
    >
      <!-- HEADER -->
      <DialogHeader class="px-6 pt-5 pb-4 border-b border-slate-100 bg-slate-50/70 text-left">
        <div class="flex items-center justify-between">
          <div>
            <DialogTitle class="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles v-if="currentStep === 'REVIEW'" class="text-amber-500" :size="18" />
              <UploadCloud v-else class="text-blue-600" :size="18" />
              <span>{{ currentStep === 'REVIEW' ? 'Thẩm định số liệu bóc tách từ báo cáo' : 'Tải lên báo cáo số liệu' }}</span>
            </DialogTitle>
            <DialogDescription class="text-xs text-slate-500 mt-0.5">
              <span v-if="currentStep === 'UPLOAD'">Chỉ cần tải tệp lên (.pdf, .docx). Hệ thống AI sẽ tự động nhận diện và bóc tách các chỉ tiêu.</span>
              <span v-else-if="currentStep === 'EXTRACTING'">Đang đọc văn bản và sử dụng mô hình AI bóc tách đối soát 19 chỉ tiêu điều hành...</span>
              <span v-else>Rà soát các số liệu đã được AI bóc tách từ báo cáo. Bạn có thể điều chỉnh giá trị thực hiện hoặc loại bỏ bớt chỉ tiêu trước khi lưu.</span>
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <!-- BODY BƯỚC 1: CHỌN FILE -->
      <div v-if="currentStep === 'UPLOAD'" class="p-6 space-y-4">
        <div
          class="border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer bg-blue-50/20 hover:bg-blue-50/60 border-blue-200"
          @click="fileInputRef?.click()"
          @dragover.prevent
          @drop="handleDrop"
        >
          <input
            ref="fileInputRef"
            type="file"
            accept=".pdf,.docx,.doc"
            class="hidden"
            @change="handleFileSelect"
          />

          <div v-if="selectedFile" class="flex flex-col items-center gap-2 py-2">
            <div class="h-12 w-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-xs">
              <FileSpreadsheet v-if="selectedFile.name.endsWith('.xlsx')" :size="24" />
              <FileText v-else :size="24" />
            </div>
            <span class="text-sm font-semibold text-slate-900 break-all max-w-[380px]">{{ cleanText(selectedFile.name) }}</span>
            <span class="text-xs text-slate-500">
              {{ (selectedFile.size / 1024 / 1024).toFixed(2) }} MB • Nhấp để đổi tệp khác
            </span>
          </div>

          <div v-else class="flex flex-col items-center gap-2 py-4">
            <div class="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 mb-1">
              <UploadCloud :size="24" />
            </div>
            <div class="text-sm text-slate-700">
              Kéo thả tệp báo cáo vào đây hoặc <span class="text-blue-600 font-semibold underline">chọn từ máy tính</span>
            </div>
            <span class="text-xs text-slate-400">
              Hỗ trợ định dạng PDF (.pdf), Word (.docx, .doc)
            </span>
          </div>
        </div>

        <div class="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2.5">
          <Sparkles class="text-amber-600 shrink-0 mt-0.5" :size="15" />
          <span>
            <strong>Tự động 100%:</strong> Bạn không cần nhập mã số, tiêu đề hay năm. AI sẽ tự động đọc văn bản và bóc tách các chỉ tiêu KTXH tương ứng.
          </span>
        </div>
      </div>

      <!-- BODY BƯỚC 2: THANH TIẾN TRÌNH ĐANG BÓC TÁCH HOẶC BÁO LỖI -->
      <div v-else-if="currentStep === 'EXTRACTING'" class="p-8 space-y-6 text-center">
        <div v-if="errorMessage" class="w-14 h-14 mx-auto rounded-2xl bg-red-100 text-red-600 flex items-center justify-center">
          <AlertCircle :size="28" />
        </div>
        <div v-else class="w-14 h-14 mx-auto rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
          <Loader2 class="animate-spin" :size="28" />
        </div>

        <div class="space-y-1">
          <h4 class="text-sm font-bold text-slate-900">{{ errorMessage ? 'Không thể bóc tách báo cáo' : 'Đang bóc tách số liệu báo cáo' }}</h4>
          <p class="text-xs text-slate-500 font-mono">{{ cleanText(selectedFile?.name) }}</p>
        </div>

        <div v-if="!errorMessage" class="space-y-2 max-w-md mx-auto">
          <div class="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>{{ progressStatusText }}</span>
            <span class="text-blue-600 font-mono">{{ progressValue }}%</span>
          </div>
          <Progress :model-value="progressValue" class="h-2.5" />
        </div>

        <div v-else class="bg-red-50 text-red-700 p-3 rounded-xl text-xs max-w-md mx-auto border border-red-200 space-y-2">
          <p>{{ errorMessage }}</p>
          <div class="flex items-center justify-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="rounded-full text-xs h-7 px-3 border-red-200 text-red-700 hover:bg-red-100"
              @click="currentStep = 'UPLOAD'"
            >
              Chọn lại tệp
            </Button>
            <Button
              type="button"
              size="sm"
              class="rounded-full text-xs h-7 px-3 bg-blue-600 hover:bg-blue-700 text-white"
              @click="startExtraction"
            >
              Thử lại
            </Button>
          </div>
        </div>
      </div>

      <!-- BODY BƯỚC 3: XEM TRƯỚC VÀ DUYỆT SỐ LIỆU (REVIEW & APPROVE) -->
      <div v-else-if="currentStep === 'REVIEW'" class="flex-1 overflow-y-auto p-6 space-y-5">
        <!-- Card Thông tin báo cáo AI nhận diện -->
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4.5 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
            <div class="flex items-center gap-2">
              <Badge class="bg-blue-600 text-white border-0 font-bold px-2.5 py-0.5 text-xs rounded-full">
                {{ cleanText(extractedReport?.code) || '489/BC-UBND' }}
              </Badge>
              <Badge variant="outline" class="border-slate-300 text-slate-700 text-xs rounded-full">
                {{ extractedReport?.category === 'DANG_UY' ? 'Khối Đảng ủy' : extractedReport?.category === 'MTTQ' ? 'Khối Mặt trận' : 'Khối UBND' }}
              </Badge>
            </div>
            <div class="flex items-center gap-4 text-xs text-slate-600">
              <span class="flex items-center gap-1 font-medium">
                <Building2 :size="13" class="text-slate-400" />
                {{ cleanText(extractedReport?.agency) || 'UBND Xã Thiện Tân' }}
              </span>
              <span class="flex items-center gap-1 font-mono font-medium">
                <Calendar :size="13" class="text-slate-400" />
                Năm {{ extractedReport?.year || 2026 }}
              </span>
            </div>
          </div>

          <div>
            <h3 class="text-sm font-bold text-slate-900 leading-snug">
              {{ cleanText(extractedReport?.title) }}
            </h3>
            <p v-if="extractedReport?.summary" class="text-xs text-slate-600 mt-1.5 leading-relaxed bg-white/70 p-2.5 rounded-xl border border-slate-200">
              💡 <strong>Tóm tắt:</strong> {{ cleanText(extractedReport?.summary) }}
            </p>
          </div>
        </div>

        <!-- Báo lỗi nếu có trong bước Thẩm định -->
        <div
          v-if="errorMessage"
          class="bg-red-50 text-red-700 p-3 rounded-xl text-xs border border-red-200 flex items-center justify-between"
        >
          <div class="flex items-center gap-2">
            <AlertCircle :size="16" class="shrink-0 text-red-600" />
            <span>{{ errorMessage }}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-6 px-2 text-xs text-red-700 rounded-full hover:bg-red-100"
            @click="errorMessage = ''"
          >
            Đóng
          </Button>
        </div>

        <!-- Bảng danh sách các thông số chỉ tiêu bóc tách được -->
        <div class="space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h4 class="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Các chỉ tiêu đã bóc tách từ báo cáo
              </h4>
              <Badge class="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-full text-xs font-semibold px-2.5 py-0.5">
                {{ extractedMetrics.length }} chỉ tiêu
              </Badge>
            </div>
            <span class="text-xs text-slate-500">
              Kiểm tra số liệu hoặc điều chỉnh trực tiếp trước khi phê duyệt lưu trữ
            </span>
          </div>

          <div class="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
            <Table>
              <TableHeader class="bg-slate-50/80 border-b border-slate-200">
                <TableRow class="hover:bg-transparent">
                  <TableHead class="w-12 text-center text-xs font-semibold text-slate-600 whitespace-nowrap">STT</TableHead>
                  <TableHead class="w-56 text-xs font-semibold text-slate-600 whitespace-nowrap">Chỉ tiêu điều hành</TableHead>
                  <TableHead class="w-24 text-xs font-semibold text-slate-600 text-center whitespace-nowrap">Khối</TableHead>
                  <TableHead class="w-40 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Thực hiện</TableHead>
                  <TableHead class="w-28 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Kế hoạch</TableHead>
                  <TableHead class="w-20 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">Tỷ lệ</TableHead>
                  <TableHead class="min-w-[260px] text-xs font-semibold text-slate-600 whitespace-nowrap">Trích dẫn bằng chứng</TableHead>
                  <TableHead class="w-14 text-center text-xs font-semibold text-slate-600 whitespace-nowrap">Xóa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="(metric, idx) in extractedMetrics"
                  :key="metric.code || idx"
                  class="hover:bg-slate-50/70 transition-colors"
                >
                  <!-- STT -->
                  <TableCell class="w-12 text-center py-3 font-mono text-xs text-slate-400">
                    {{ idx + 1 }}
                  </TableCell>

                  <!-- Tên & Mã chỉ tiêu -->
                  <TableCell class="w-56 py-3">
                    <div class="font-semibold text-xs text-slate-900 leading-snug">{{ cleanText(metric.name) }}</div>
                    <div class="font-mono text-[10px] text-blue-600 font-medium mt-0.5">{{ metric.code }}</div>
                  </TableCell>

                  <!-- Khối -->
                  <TableCell class="w-24 py-3 text-center">
                    <Badge variant="outline" class="text-[10px] rounded-full px-2 py-0 border-slate-200 text-slate-600 whitespace-nowrap">
                      {{ metric.category }}
                    </Badge>
                  </TableCell>

                  <!-- Thực hiện (input edit) -->
                  <TableCell class="w-40 py-3 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                      <Input
                        v-model="metric.actualValue"
                        type="number"
                        step="any"
                        class="h-8 w-24 text-right text-xs font-bold rounded-lg border-slate-200 p-1 font-mono focus-visible:ring-1"
                        @input="() => onMetricValueChange(metric)"
                      />
                      <span class="text-xs font-medium text-slate-500 whitespace-nowrap min-w-[28px] text-left">{{ metric.unit }}</span>
                    </div>
                  </TableCell>

                  <!-- Kế hoạch -->
                  <TableCell class="w-28 py-3 text-right font-mono text-xs text-slate-600 whitespace-nowrap">
                    {{ metric.targetValue !== null && metric.targetValue !== undefined ? `${metric.targetValue} ${metric.unit}` : '—' }}
                  </TableCell>

                  <!-- Tỷ lệ hoàn thành -->
                  <TableCell class="w-20 py-3 text-right font-mono text-xs font-bold whitespace-nowrap">
                    <span
                      v-if="metric.completionRate !== null && metric.completionRate !== undefined"
                      :class="metric.completionRate >= 100 ? 'text-emerald-600' : 'text-blue-600'"
                    >
                      {{ metric.completionRate }}%
                    </span>
                    <span v-else class="text-slate-400">—</span>
                  </TableCell>

                  <!-- Bằng chứng nguyên văn -->
                  <TableCell class="min-w-[260px] py-3">
                    <div class="text-[11px] text-slate-600 bg-slate-50/80 p-2 rounded-xl border border-slate-100 flex items-start gap-1.5 leading-relaxed">
                      <Quote :size="12" class="text-slate-400 shrink-0 mt-0.5" />
                      <span class="italic">{{ cleanText(metric.sourceEvidence) || '—' }}</span>
                    </div>
                  </TableCell>

                  <!-- Thao tác xóa -->
                  <TableCell class="w-14 text-center py-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Loại bỏ chỉ tiêu này"
                      @click="removeMetric(idx)"
                    >
                      <Trash2 :size="14" />
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <!-- FOOTER -->
      <DialogFooter class="px-6 py-3.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3">
        <template v-if="currentStep === 'UPLOAD'">
          <Button
            type="button"
            variant="outline"
            class="rounded-full text-xs h-9 px-4 border-slate-200 text-slate-700 hover:bg-slate-100 font-medium"
            @click="handleClose(false)"
          >
            Hủy
          </Button>

          <Button
            type="button"
            class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-9 px-5 font-semibold shadow-xs flex items-center gap-1.5"
            :disabled="!selectedFile"
            @click="startExtraction"
          >
            <Sparkles :size="14" />
            <span>Bóc tách số liệu ngay</span>
          </Button>
        </template>

        <template v-else-if="currentStep === 'REVIEW'">
          <Button
            type="button"
            variant="outline"
            class="rounded-full text-xs h-9 px-4 border-slate-200 text-slate-700 hover:bg-slate-100 font-medium flex items-center gap-1.5"
            :disabled="isSubmitting"
            @click="backToUpload"
          >
            <ArrowLeft :size="13" />
            <span>Chọn tệp khác</span>
          </Button>

          <Button
            type="button"
            class="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 px-6 font-semibold shadow-xs flex items-center gap-2"
            :disabled="extractedMetrics.length === 0 || isSubmitting"
            @click="handleConfirmAndCommit"
          >
            <Loader2 v-if="isSubmitting" :size="14" class="animate-spin" />
            <ShieldCheck v-else :size="15" />
            <span>Xác nhận & Cập nhật Điều hành ({{ extractedMetrics.length }} chỉ tiêu)</span>
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
