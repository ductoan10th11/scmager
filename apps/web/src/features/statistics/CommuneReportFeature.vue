<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ArrowLeft,
  FileText,
  UploadCloud,
  RefreshCw,
  Search,
  Eye,
  Download,
  CheckCircle2,
  Quote,
  Trash2,
  AlertTriangle,
  Loader2,
  Building2,
  Calendar,
  Layers,
  Award,
  TrendingUp,
  CheckCircle,
  FileSpreadsheet,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CommuneStatService } from './services/commune-stat.service'
import ReportUploadDialog from './components/ReportUploadDialog.vue'

const router = useRouter()
const route = useRoute()

const isLoading = ref(false)
const isUploadOpen = ref(false)
const searchQuery = ref('')
const toastMessage = ref(null)

// Dialog xem chi tiết chỉ tiêu trích xuất từ 1 báo cáo
const selectedReport = ref(null)
const isDetailOpen = ref(false)
const modalCategoryFilter = ref('ALL')

// Dialog xác nhận xóa báo cáo
const isDeleteOpen = ref(false)
const reportToDelete = ref(null)
const isDeleting = ref(false)

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

const openDeleteConfirm = (report) => {
  reportToDelete.value = report
  isDeleteOpen.value = true
}

const handleDeleteReport = async () => {
  if (!reportToDelete.value || isDeleting.value) return
  isDeleting.value = true
  try {
    const repId = reportToDelete.value._id || reportToDelete.value.id
    await CommuneStatService.deleteReport(repId)
    showToast(`Đã xóa thành công báo cáo: ${cleanText(reportToDelete.value.title || reportToDelete.value.fileName)}`)
    isDeleteOpen.value = false
    reportToDelete.value = null
    await loadData()
  } catch (error) {
    console.error('Lỗi khi xóa báo cáo:', error)
    showToast('Xóa báo cáo thất bại: ' + (error.message || 'Lỗi hệ thống'))
  } finally {
    isDeleting.value = false
  }
}

// Danh sách báo cáo nạp động từ CSDL
const reports = ref([])
const allMetrics = ref([])
const reportDetailMetrics = ref([])

const showToast = (message) => {
  toastMessage.value = message
  setTimeout(() => {
    toastMessage.value = null
  }, 3500)
}

const loadData = async () => {
  isLoading.value = true
  try {
    const [reportsRes, overviewRes] = await Promise.all([
      CommuneStatService.getReportsList({ year: 2026 }),
      CommuneStatService.getIocOverview({ year: 2026 }),
    ])
    reports.value = reportsRes.reports || []
    allMetrics.value = overviewRes.metrics || []

    if (route.query.reportId) {
      const rep = reports.value.find((r) => (r._id || r.id) === route.query.reportId)
      if (rep) openReportDetail(rep)
    }
  } catch (err) {
    console.error('Lỗi tải dữ liệu báo cáo:', err)
  } finally {
    isLoading.value = false
  }
}

// Lọc danh sách báo cáo theo từ khóa tìm kiếm
const filteredReports = computed(() => {
  if (!searchQuery.value.trim()) return reports.value
  const q = searchQuery.value.trim().toLowerCase()
  return reports.value.filter(
    (r) =>
      cleanText(r.title).toLowerCase().includes(q) ||
      cleanText(r.code).toLowerCase().includes(q) ||
      cleanText(r.fileName).toLowerCase().includes(q) ||
      cleanText(r.agency).toLowerCase().includes(q)
  )
})

// Mở dialog xem danh sách chỉ tiêu của báo cáo
const openReportDetail = async (report) => {
  selectedReport.value = report
  modalCategoryFilter.value = 'ALL'
  isDetailOpen.value = true
  reportDetailMetrics.value = []
  const repId = report._id || report.id
  if (repId) {
    try {
      const detail = await CommuneStatService.getReportDetail(repId)
      reportDetailMetrics.value = detail.metrics || []
    } catch (e) {
      console.warn('Lỗi tải chi tiết chỉ tiêu báo cáo:', e)
    }
  }
}

// Lấy danh sách chỉ tiêu gắn với báo cáo đang mở
const currentReportMetrics = computed(() => {
  if (reportDetailMetrics.value.length > 0) {
    return reportDetailMetrics.value
  }
  if (!selectedReport.value) return []
  const repId = selectedReport.value._id || selectedReport.value.id
  return allMetrics.value.filter(
    (m) =>
      m.sourceReportId === repId ||
      m.sourceReportId?._id === repId
  )
})

// Lọc chỉ tiêu theo khối chuyên ngành trong modal
const modalDisplayMetrics = computed(() => {
  const list = currentReportMetrics.value
  if (modalCategoryFilter.value === 'ALL') return list
  return list.filter((m) => m.category === modalCategoryFilter.value)
})

// Tính toán các chỉ số KPI tóm tắt nhanh cho báo cáo
const modalKpis = computed(() => {
  const list = currentReportMetrics.value
  const total = list.length
  const reached = list.filter((m) => m.completionRate !== null && m.completionRate >= 100).length
  const inProgress = list.filter((m) => m.completionRate !== null && m.completionRate < 100).length
  const rates = list.filter((m) => m.completionRate !== null).map((m) => Number(m.completionRate))
  const avgRate = rates.length > 0 ? (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1) : null
  const ubndCount = list.filter((m) => m.category === 'UBND').length
  const dangCount = list.filter((m) => m.category === 'DANG_UY').length
  const mttqCount = list.filter((m) => m.category === 'MTTQ').length
  return { total, reached, inProgress, avgRate, ubndCount, dangCount, mttqCount }
})

// Xử lý sau khi người dùng thẩm định và lưu báo cáo vào CSDL thành công
const handleReportSaved = async (data) => {
  showToast(`Đã ghi nhận thành công ${data?.metricsCount || 'các'} chỉ tiêu từ báo cáo vào CSDL!`)
  await loadData()
}

const handleDownload = (report) => {
  const repId = report._id || report.id
  if (repId && report.fileUrl) {
    window.open(`/api/commune-stats/reports/${repId}/download`, '_blank')
  } else {
    showToast(`Đang tải tệp: ${cleanText(report.fileName)}`)
  }
}

watch(
  () => route.query.reportId,
  (newId) => {
    if (newId) {
      const rep = reports.value.find((r) => (r._id || r.id) === newId)
      if (rep) openReportDetail(rep)
    }
  }
)

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="w-full min-w-0 space-y-6 max-w-7xl mx-auto font-sans pb-12">
    <!-- Toast thông báo kết quả -->
    <transition
      enter-active-class="transform ease-out duration-200 transition"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="toastMessage"
        class="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-zinc-900 text-white px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold max-w-md"
      >
        <CheckCircle2 :size="16" class="text-emerald-400 shrink-0" />
        <span>{{ toastMessage }}</span>
      </div>
    </transition>

    <!-- HEADER TRANG BÁO CÁO (ĐỒNG BỘ CHUẨN VỚI TRANG ĐIỀU HÀNH) -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-200/80">
      <div>
        <div class="flex items-center gap-2.5">
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
            Báo cáo Xã Thiện Tân
          </h1>
          <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80 whitespace-nowrap shrink-0">
            Xã Thiện Tân • Năm 2026
          </span>
        </div>
        <p class="text-xs text-zinc-500 mt-1">
          Lưu trữ, tra cứu các văn bản báo cáo kinh tế - xã hội, công tác Đảng và các số liệu số hóa của xã.
        </p>
      </div>

      <!-- Controls bên phải: Làm mới & Tải lên báo cáo -->
      <div class="flex items-center gap-2.5 shrink-0 self-start md:self-auto">
        <Button
          type="button"
          variant="outline"
          class="rounded-full text-xs h-8 px-3.5 border-zinc-200 text-zinc-700 hover:bg-zinc-100 font-medium"
          :disabled="isLoading"
          @click="loadData"
        >
          <RefreshCw :size="12" :class="isLoading ? 'animate-spin' : ''" class="mr-1.5 text-blue-600" />
          Làm mới
        </Button>

        <Button
          type="button"
          class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-4 font-semibold shadow-xs"
          @click="isUploadOpen = true"
        >
          <UploadCloud :size="13" class="mr-1.5" />
          Tải lên báo cáo
        </Button>
      </div>
    </div>

    <!-- BẢNG LỊCH SỬ BÁO CÁO (PHÍA DƯỚI) -->
    <div class="rounded-2xl border border-zinc-200/80 bg-white overflow-hidden shadow-xs">
      <!-- Toolbar của bảng: Tiêu đề danh sách + Ô tìm kiếm -->
      <div class="p-4 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-50/50">
        <div class="flex items-center gap-2">
          <FileText :size="16" class="text-blue-600 shrink-0" />
          <h2 class="text-sm font-bold text-zinc-900">Lịch sử văn bản báo cáo đã lưu</h2>
          <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-200/70 text-zinc-700 whitespace-nowrap shrink-0">
            {{ filteredReports.length }} tài liệu
          </span>
        </div>

        <div class="relative w-full sm:w-72">
          <Search :size="13" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <Input
            v-model="searchQuery"
            placeholder="Tìm tên, số hiệu báo cáo..."
            class="h-8 pl-8 text-xs rounded-full border-zinc-200 bg-white w-full"
          />
        </div>
      </div>

      <div class="w-full overflow-x-auto">
        <Table class="w-full text-xs">
          <TableHeader class="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
            <TableRow>
              <TableHead class="font-bold pl-5 py-3">Tên báo cáo & Văn bản gốc</TableHead>
              <TableHead class="w-36 font-bold py-3 whitespace-nowrap">Thời gian tải lên</TableHead>
              <TableHead class="w-28 text-center font-bold py-3 pr-5 whitespace-nowrap">Thao tác</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            <TableRow
              v-for="rep in filteredReports"
              :key="rep._id || rep.id"
              class="hover:bg-zinc-50/60 border-b border-zinc-100 last:border-0 transition-colors"
            >
              <!-- Cột 1: Tên báo cáo & Tệp đính kèm -->
              <TableCell class="pl-5 py-3.5">
                <div class="flex items-start gap-3">
                  <div class="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5 border border-blue-100 shadow-2xs">
                    <FileText :size="16" />
                  </div>
                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-bold text-zinc-900 leading-snug text-sm line-clamp-2" :title="cleanText(rep.title)">
                        {{ cleanText(rep.title) }}
                      </span>
                      <span v-if="rep.code" class="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/80 whitespace-nowrap shrink-0">
                        {{ cleanText(rep.code) }}
                      </span>
                    </div>

                    <div class="flex items-center gap-2 text-xs text-zinc-500 flex-wrap">
                      <span class="font-medium text-zinc-700 shrink-0">{{ cleanText(rep.agency) || 'Xã Thiện Tân' }}</span>
                      <span class="text-zinc-300 shrink-0">•</span>
                      <span class="font-mono text-zinc-600 truncate max-w-[280px] shrink-0" :title="cleanText(rep.fileName)">{{ cleanText(rep.fileName) }}</span>
                      <span v-if="rep.fileSize" class="text-zinc-400 shrink-0">({{ rep.fileSize }})</span>
                      <span v-if="rep.extractedCount" class="text-blue-600 font-semibold shrink-0">• {{ rep.extractedCount }} chỉ tiêu</span>
                    </div>
                  </div>
                </div>
              </TableCell>

              <!-- Cột 2: Ngày tải lên -->
              <TableCell class="py-3.5 whitespace-nowrap text-zinc-500 font-mono text-xs">
                {{ rep.uploadDate || (rep.createdAt ? new Date(rep.createdAt).toLocaleDateString('vi-VN') : '18/09/2026') }}
              </TableCell>

              <!-- Cột 3: Thao tác -->
              <TableCell class="py-3.5 pr-5 text-center whitespace-nowrap">
                <div class="flex items-center justify-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-full text-zinc-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                    title="Xem chi tiết các chỉ tiêu trích xuất"
                    @click="openReportDetail(rep)"
                  >
                    <Eye :size="14" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-full text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 cursor-pointer"
                    title="Tải tệp đính kèm"
                    @click="handleDownload(rep)"
                  >
                    <Download :size="14" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-full text-zinc-500 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                    title="Xóa báo cáo"
                    @click="openDeleteConfirm(rep)"
                  >
                    <Trash2 :size="14" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>

            <TableRow v-if="filteredReports.length === 0">
              <TableCell colspan="3" class="h-28 text-center text-xs text-zinc-400">
                Không tìm thấy báo cáo phù hợp với từ khóa tìm kiếm.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>

    <!-- DIALOG XEM DANH SÁCH CHỈ TIÊU CỦA BÁO CÁO (EXECUTIVE MODAL) -->
    <Dialog :open="isDetailOpen" @update:open="(val) => isDetailOpen = val">
      <DialogContent class="w-[96vw] sm:max-w-5xl p-0 rounded-3xl overflow-hidden border border-zinc-200 bg-white text-zinc-900 shadow-2xl max-h-[90vh] flex flex-col">
        <!-- 1. EXECUTIVE HEADER -->
        <DialogHeader class="px-6 py-5 border-b border-zinc-200/80 bg-gradient-to-r from-slate-50 via-blue-50/30 to-indigo-50/20 text-left shrink-0">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div class="flex items-start gap-3.5 min-w-0">
              <div class="h-10 w-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                <FileText :size="20" />
              </div>

              <div class="min-w-0 space-y-1.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-bold text-blue-700 bg-blue-100/70 px-2.5 py-0.5 rounded-full border border-blue-200 whitespace-nowrap shrink-0">
                    {{ cleanText(selectedReport?.code) || '489/BC-UBND' }}
                  </span>
                  <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200 whitespace-nowrap shrink-0">
                    Năm {{ selectedReport?.year || 2026 }}
                  </span>
                  <span class="text-xs font-medium text-zinc-600 flex items-center gap-1 shrink-0">
                    <Building2 :size="13" class="text-zinc-400" />
                    {{ cleanText(selectedReport?.agency) || 'UBND Xã Thiện Tân' }}
                  </span>
                  <span class="text-xs text-zinc-400 font-mono shrink-0">
                    • {{ selectedReport?.uploadDate || '18/09/2026' }}
                  </span>
                </div>

                <DialogTitle class="text-base sm:text-lg font-bold text-zinc-900 leading-snug">
                  {{ cleanText(selectedReport?.title) }}
                </DialogTitle>

                <DialogDescription class="text-xs text-zinc-500 flex items-center gap-2 flex-wrap pt-0.5">
                  <span class="font-mono text-zinc-700 truncate max-w-sm" :title="cleanText(selectedReport?.fileName)">
                    {{ cleanText(selectedReport?.fileName) }}
                  </span>
                  <span v-if="selectedReport?.fileSize" class="text-zinc-400">({{ selectedReport?.fileSize }})</span>
                </DialogDescription>
              </div>
            </div>

            <!-- Nút Tải tệp ngay trên Header -->
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="rounded-full text-xs h-8 px-3.5 border-zinc-200 text-zinc-700 hover:bg-zinc-100 shrink-0 font-medium self-start flex items-center gap-1.5 cursor-pointer"
              @click="handleDownload(selectedReport)"
            >
              <Download :size="13" class="text-blue-600" />
              <span>Tải tệp đính kèm</span>
            </Button>
          </div>
        </DialogHeader>

        <!-- 2. BODY CHỨA DẢI KPI VÀ BẢNG SỐ LIỆU -->
        <div class="p-6 overflow-y-auto space-y-5 flex-1">
          <!-- 4 THẺ TỔNG QUAN KPI NHANH -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="bg-zinc-50 rounded-2xl p-3 border border-zinc-200/80">
              <div class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Tổng chỉ tiêu</div>
              <div class="text-xl font-bold font-mono text-zinc-900 mt-1">
                {{ modalKpis.total }} <span class="text-xs font-normal text-zinc-500">chỉ tiêu</span>
              </div>
            </div>

            <div class="bg-emerald-50/60 rounded-2xl p-3 border border-emerald-200/80">
              <div class="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 :size="12" class="text-emerald-600" />
                Đạt & Vượt Kế Hoạch
              </div>
              <div class="text-xl font-bold font-mono text-emerald-700 mt-1">
                {{ modalKpis.reached }} <span class="text-xs font-normal text-emerald-600">chỉ tiêu</span>
              </div>
            </div>

            <div class="bg-amber-50/60 rounded-2xl p-3 border border-amber-200/80">
              <div class="text-[11px] font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                <TrendingUp :size="12" class="text-amber-600" />
                Cần Phấn Đấu
              </div>
              <div class="text-xl font-bold font-mono text-amber-700 mt-1">
                {{ modalKpis.inProgress }} <span class="text-xs font-normal text-amber-600">chỉ tiêu</span>
              </div>
            </div>

            <div class="bg-blue-50/60 rounded-2xl p-3 border border-blue-200/80">
              <div class="text-[11px] font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                <Award :size="12" class="text-blue-600" />
                Tiến Độ Bình Quân
              </div>
              <div class="text-xl font-bold font-mono text-blue-700 mt-1">
                {{ modalKpis.avgRate ? modalKpis.avgRate + '%' : '100%' }}
              </div>
            </div>
          </div>

          <!-- BỘ LỌC PHÂN KHỐI TRONG MODAL -->
          <div class="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <button
                type="button"
                class="px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                :class="modalCategoryFilter === 'ALL'
                  ? 'bg-zinc-900 text-white shadow-xs'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'"
                @click="modalCategoryFilter = 'ALL'"
              >
                Tất cả ({{ modalKpis.total }})
              </button>

              <button
                type="button"
                class="px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                :class="modalCategoryFilter === 'UBND'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'"
                @click="modalCategoryFilter = 'UBND'"
              >
                Khối UBND ({{ modalKpis.ubndCount }})
              </button>

              <button
                type="button"
                class="px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                :class="modalCategoryFilter === 'DANG_UY'
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'"
                @click="modalCategoryFilter = 'DANG_UY'"
              >
                Khối Đảng ủy ({{ modalKpis.dangCount }})
              </button>

              <button
                type="button"
                class="px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                :class="modalCategoryFilter === 'MTTQ'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'"
                @click="modalCategoryFilter = 'MTTQ'"
              >
                Khối MTTQ ({{ modalKpis.mttqCount }})
              </button>
            </div>

            <span class="text-xs text-zinc-400">
              Đối soát trực tiếp từ văn bản báo cáo
            </span>
          </div>

          <!-- BẢNG CHỈ TIÊU CHI TIẾT -->
          <div v-if="modalDisplayMetrics.length > 0" class="rounded-2xl border border-zinc-200 overflow-hidden shadow-xs">
            <Table class="w-full text-xs">
              <TableHeader class="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                <TableRow>
                  <TableHead class="w-12 text-center font-bold whitespace-nowrap">STT</TableHead>
                  <TableHead class="font-bold min-w-[200px] whitespace-nowrap">Chỉ tiêu điều hành</TableHead>
                  <TableHead class="w-20 text-center font-bold whitespace-nowrap">Khối</TableHead>
                  <TableHead class="w-28 text-right font-bold whitespace-nowrap">Thực hiện</TableHead>
                  <TableHead class="w-24 text-right font-bold whitespace-nowrap">Kế hoạch</TableHead>
                  <TableHead class="w-28 text-center font-bold whitespace-nowrap">Tỷ lệ hoàn thành</TableHead>
                  <TableHead class="min-w-[280px] font-bold whitespace-nowrap">Căn cứ trích dẫn nguyên văn</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                <TableRow
                  v-for="(metric, idx) in modalDisplayMetrics"
                  :key="metric.id || metric._id || idx"
                  class="border-b border-zinc-100 last:border-0 hover:bg-blue-50/30 transition-colors"
                >
                  <!-- STT -->
                  <TableCell class="text-center font-mono text-xs text-zinc-400 py-3">
                    {{ idx + 1 }}
                  </TableCell>

                  <!-- Tên & Mã chỉ tiêu -->
                  <TableCell class="py-3">
                    <div class="font-semibold text-zinc-900 leading-snug">{{ cleanText(metric.name) }}</div>
                    <div class="font-mono text-[10px] text-blue-600 font-medium mt-0.5 inline-block bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                      {{ metric.code }}
                    </div>
                  </TableCell>

                  <!-- Khối -->
                  <TableCell class="text-center py-3 whitespace-nowrap">
                    <span
                      class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      :class="metric.category === 'DANG_UY'
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : metric.category === 'MTTQ'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'"
                    >
                      {{ metric.category === 'DANG_UY' ? 'Đảng ủy' : metric.category === 'MTTQ' ? 'MTTQ' : 'UBND' }}
                    </span>
                  </TableCell>

                  <!-- Thực hiện -->
                  <TableCell class="text-right font-bold text-zinc-900 font-mono whitespace-nowrap py-3">
                    <span class="text-sm text-blue-600">{{ Number(metric.actualValue).toLocaleString('vi-VN') }}</span>
                    <span class="text-xs font-normal text-zinc-500 ml-1">{{ metric.unit }}</span>
                  </TableCell>

                  <!-- Kế hoạch -->
                  <TableCell class="text-right font-mono text-xs text-zinc-600 whitespace-nowrap py-3">
                    {{ metric.targetValue !== null && metric.targetValue !== undefined ? `${Number(metric.targetValue).toLocaleString('vi-VN')} ${metric.unit}` : '—' }}
                  </TableCell>

                  <!-- Tỷ lệ hoàn thành -->
                  <TableCell class="text-center whitespace-nowrap py-3">
                    <span
                      v-if="metric.completionRate !== null && metric.completionRate !== undefined"
                      class="inline-flex items-center gap-1 text-xs font-bold font-mono px-2.5 py-0.5 rounded-full border"
                      :class="metric.completionRate >= 100
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : metric.completionRate >= 80
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'"
                    >
                      <span class="h-1.5 w-1.5 rounded-full" :class="metric.completionRate >= 100 ? 'bg-emerald-500' : metric.completionRate >= 80 ? 'bg-blue-500' : 'bg-amber-500'"></span>
                      {{ metric.completionRate }}%
                    </span>
                    <span v-else class="text-zinc-400 font-mono">—</span>
                  </TableCell>

                  <!-- Bằng chứng nguyên văn không bị ngắt dòng vô cớ -->
                  <TableCell class="text-xs text-zinc-700 py-3">
                    <div v-if="metric.sourceEvidence" class="bg-zinc-50 p-2.5 rounded-xl border border-zinc-100 flex items-start gap-2 leading-relaxed">
                      <Quote :size="13" class="text-amber-600 shrink-0 mt-0.5" />
                      <span class="italic text-[11px] text-zinc-600">{{ cleanText(metric.sourceEvidence) }}</span>
                    </div>
                    <span v-else class="text-zinc-400">—</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div v-else class="py-12 text-center space-y-2 bg-zinc-50/50 rounded-2xl border border-dashed border-zinc-200">
            <FileText :size="32" class="mx-auto text-zinc-300" />
            <p class="text-xs font-medium text-zinc-600">Không có chỉ tiêu nào thuộc khối này trong báo cáo.</p>
          </div>
        </div>

        <!-- 3. FOOTER -->
        <DialogFooter class="px-6 py-3.5 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between shrink-0">
          <div class="text-[11px] text-zinc-500 hidden sm:block">
            Số liệu đã được số hóa và đồng bộ vào Trung tâm Điều hành IOC Xã Thiện Tân.
          </div>
          <Button
            type="button"
            variant="outline"
            class="rounded-full text-xs h-8 px-5 border-zinc-200 text-zinc-700 hover:bg-zinc-100 font-medium cursor-pointer"
            @click="isDetailOpen = false"
          >
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- DIALOG XÁC NHẬN XÓA BÁO CÁO -->
    <Dialog :open="isDeleteOpen" @update:open="(val) => isDeleteOpen = val">
      <DialogContent class="w-[95vw] sm:max-w-md p-0 rounded-2xl overflow-hidden border border-zinc-200 bg-white text-zinc-900 shadow-2xl">
        <DialogHeader class="px-5 pt-5 pb-3 border-b border-zinc-100 bg-red-50/40 text-left">
          <div class="flex items-center gap-2.5">
            <div class="h-9 w-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle :size="18" />
            </div>
            <div>
              <DialogTitle class="text-base font-bold text-zinc-900 leading-snug">
                Xác nhận xóa báo cáo
              </DialogTitle>
              <DialogDescription class="text-xs text-zinc-500 mt-0.5">
                Hành động này không thể hoàn tác.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div class="p-5 space-y-3 text-xs text-zinc-700">
          <p>
            Bạn có chắc chắn muốn xóa báo cáo <strong class="text-zinc-900">{{ cleanText(reportToDelete?.title || reportToDelete?.fileName) }}</strong>?
          </p>
          <div class="bg-zinc-50 p-3 rounded-xl border border-zinc-200/80 space-y-1 text-[11px] text-zinc-600">
            <div>• <strong>Số hiệu:</strong> {{ cleanText(reportToDelete?.code) || 'Chưa xác định' }}</div>
            <div>• <strong>Năm báo cáo:</strong> {{ reportToDelete?.year || 2026 }}</div>
            <div>• <strong>Tệp đính kèm:</strong> {{ cleanText(reportToDelete?.fileName) }}</div>
            <div class="text-red-600 pt-1 font-medium">• Toàn bộ tệp lưu trữ và các chỉ tiêu liên kết với báo cáo này sẽ bị xóa khỏi hệ thống.</div>
          </div>
        </div>

        <DialogFooter class="px-5 py-3.5 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            class="rounded-full text-xs h-8 px-4 border-zinc-200 text-zinc-700 hover:bg-zinc-100 font-medium"
            :disabled="isDeleting"
            @click="isDeleteOpen = false"
          >
            Hủy
          </Button>
          <Button
            type="button"
            class="rounded-full bg-red-600 hover:bg-red-700 text-white text-xs h-8 px-4 font-semibold shadow-xs flex items-center gap-1.5"
            :disabled="isDeleting"
            @click="handleDeleteReport"
          >
            <Loader2 v-if="isDeleting" :size="13" class="animate-spin" />
            <Trash2 v-else :size="13" />
            <span>Xóa báo cáo</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Modal tải lên báo cáo PDF/DOCX trích xuất LLM và thẩm định duyệt số liệu -->
    <ReportUploadDialog
      v-model:open="isUploadOpen"
      @saved="handleReportSaved"
    />
  </div>
</template>
