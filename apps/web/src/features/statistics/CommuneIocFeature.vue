<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard,
  FileSpreadsheet,
  UploadCloud,
  PlusCircle,
  RefreshCw,
  CheckCircle2,
  Layers,
  Building2,
  Award,
  Sparkles,
  Calendar,
  FileCheck,
  History,
  TrendingUp,
  FileText,
  Users,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CommuneStatService } from './services/commune-stat.service'
import IocMetricCard from './components/IocMetricCard.vue'
import MetricSourceDialog from './components/MetricSourceDialog.vue'
import ExtractionReviewTable from './components/ExtractionReviewTable.vue'
import ReportUploadDialog from './components/ReportUploadDialog.vue'
import ReportHistoryTable from './components/ReportHistoryTable.vue'
import ManualMetricDialog from './components/ManualMetricDialog.vue'

const route = useRoute()
const router = useRouter()

// 1 Page duy nhất: Chuyển đổi giữa 2 tab Dashboard và Báo cáo
const mainTab = ref(route.query.tab === 'reports' ? 'reports' : 'dashboard')
const dashboardFilter = ref('ALL') // 'ALL' | 'CHUNG' | 'DANG_UY' | 'UBND' | 'MTTQ'
const selectedPeriod = ref('Tháng 9/2026')
const isLoading = ref(false)
const isSubmitting = ref(false)

// Modals
const isSourceDialogOpen = ref(false)
const activeMetric = ref(null)
const activeSourceReport = ref(null)
const isUploadOpen = ref(false)
const isManualCreateOpen = ref(false)

// Báo cáo tab state
const reportSubTab = ref('extract')
const lastExtractedReport = ref(null)
const selectedFilterReport = ref(null)
const toastMessage = ref(null)

const periods = [
  'Tháng 9/2026',
  'Quý III/2026',
  '6 tháng đầu năm 2026',
  'Cả năm 2026',
]

const overviewData = ref({
  communeName: 'Xã Thiện Tân',
  motto: 'Đoàn kết - Dân chủ - Phát triển - Phồn vinh',
  year: 2026,
  metrics: [],
  recentReports: [],
})

const showToast = (message) => {
  toastMessage.value = message
  setTimeout(() => {
    toastMessage.value = null
  }, 4000)
}

const loadData = async () => {
  isLoading.value = true
  try {
    const data = await CommuneStatService.getIocOverview({
      year: 2026,
      period: selectedPeriod.value,
      category: 'ALL',
    })
    overviewData.value = data

    // Xử lý nếu có query reportId từ URL
    if (route.query.reportId) {
      const rep = data.recentReports?.find((r) => r.id === route.query.reportId)
      if (rep) {
        selectedFilterReport.value = rep
        mainTab.value = 'reports'
        reportSubTab.value = 'history'
      }
    }
  } catch (err) {
    console.error('Lỗi tải dữ liệu:', err)
  } finally {
    isLoading.value = false
  }
}

// 10 chỉ tiêu cốt lõi theo mẫu idea-1.md
const core10MetricCodes = [
  'DAN_SO',
  'HO_DAN',
  'DIEN_TICH',
  'THON_TDP',
  'DANG_VIEN',
  'HO_SO_HANH_CHINH',
  'HO_SO_DUNG_HAN',
  'THU_NGAN_SACH',
  'HO_NGHEO_CAN_NGHEO',
  'PHAN_ANH_KIEN_NGHI',
]

// Danh sách thẻ hiển thị trên Dashboard theo bộ lọc khối
const displayMetrics = computed(() => {
  const all = overviewData.value.metrics || []
  if (dashboardFilter.value === 'ALL') {
    // 10 thẻ cốt lõi đại diện toàn cảnh
    return core10MetricCodes
      .map((code) => all.find((m) => m.code === code))
      .filter(Boolean)
  }
  return all.filter((m) => m.category === dashboardFilter.value)
})

// Click vào card số liệu -> Mở dialog trích dẫn báo cáo gốc gần nhất
const handleCardClick = async (metric) => {
  activeMetric.value = metric
  activeSourceReport.value = await CommuneStatService.getSourceReportForMetric(metric)
  isSourceDialogOpen.value = true
}

// Từ dialog chuyển thẳng sang xem báo cáo trong Tab Báo cáo
const handleJumpToReport = (report) => {
  isSourceDialogOpen.value = false
  selectedFilterReport.value = report
  mainTab.value = 'reports'
  reportSubTab.value = 'extract'
  showToast(`Đang hiển thị chỉ tiêu trích xuất từ báo cáo: ${report.title}`)
}

// Xử lý sau khi LLM bóc tách xong tệp báo cáo
const handleExtracted = (result) => {
  if (result.extractedMetrics && result.extractedMetrics.length > 0) {
    overviewData.value.metrics = [...result.extractedMetrics, ...overviewData.value.metrics]
    lastExtractedReport.value = result.report
    mainTab.value = 'reports'
    reportSubTab.value = 'extract'
    showToast(`Đã bóc tách thành công ${result.extractedMetrics.length} chỉ tiêu từ tệp ${result.report.fileName}.`)
  }
}

// Bật/tắt switch xác nhận chỉ tiêu
const handleToggleStatus = async (metricId, isConfirmed) => {
  await CommuneStatService.toggleMetricStatus(metricId, isConfirmed)
  const target = overviewData.value.metrics.find((m) => m.id === metricId)
  if (target) {
    target.isConfirmed = isConfirmed
  }
}

// Cập nhật giá trị đã sửa của một chỉ tiêu
const handleUpdateMetric = (updatedMetric) => {
  const idx = overviewData.value.metrics.findIndex((m) => m.id === updatedMetric.id)
  if (idx >= 0) {
    overviewData.value.metrics[idx] = updatedMetric
    showToast(`Đã cập nhật chỉ tiêu: ${updatedMetric.name}`)
  }
}

// Ghi nhận toàn bộ chỉ tiêu đã duyệt vào CSDL
const handleCommitAll = async () => {
  isSubmitting.value = true
  try {
    const confirmed = overviewData.value.metrics.filter((m) => m.isConfirmed)
    await CommuneStatService.commitMetrics(confirmed, lastExtractedReport.value)
    showToast(`Đã lưu thành công ${confirmed.length} chỉ tiêu vào Cơ sở dữ liệu số hóa địa phương!`)
    lastExtractedReport.value = null
    await loadData()
  } catch (error) {
    console.error('Lỗi ghi nhận chỉ tiêu:', error)
  } finally {
    isSubmitting.value = false
  }
}

// Xử lý sau khi thẩm định và chốt lưu báo cáo từ dialog
const handleReportSaved = async (data) => {
  showToast(`Đã ghi nhận thành công ${data?.metricsCount || 'các'} chỉ tiêu từ báo cáo vào CSDL!`)
  await loadData()
}

// Nhập chỉ tiêu thủ công mới
const handleManualCreated = async (newMetric) => {
  await CommuneStatService.createManualMetric(newMetric)
  overviewData.value.metrics.unshift(newMetric)
  showToast(`Đã thêm mới chỉ tiêu: ${newMetric.name}`)
  mainTab.value = 'reports'
  reportSubTab.value = 'extract'
}

// Xem danh sách chỉ tiêu của một báo cáo từ bảng lịch sử
const handleViewReportHistory = (report) => {
  selectedFilterReport.value = report
  reportSubTab.value = 'extract'
  showToast(`Đang hiển thị các chỉ tiêu thuộc báo cáo: ${report.title}`)
}

// Danh sách chỉ tiêu ở tab Đối soát
const reviewMetrics = computed(() => {
  if (selectedFilterReport.value) {
    return overviewData.value.metrics.filter((m) => m.sourceReportId === selectedFilterReport.value.id)
  }
  return overviewData.value.metrics
})

watch(() => route.query.tab, (val) => {
  if (val === 'reports') mainTab.value = 'reports'
  else if (val === 'dashboard') mainTab.value = 'dashboard'
})

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="w-full min-w-0 space-y-6 max-w-7xl mx-auto font-sans select-none">
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
        class="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-zinc-900 text-white px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold max-w-md ml-auto"
      >
        <CheckCircle2 :size="16" class="text-emerald-400 shrink-0" />
        <span>{{ toastMessage }}</span>
      </div>
    </transition>

    <!-- HEADER TRANG DUY NHẤT: THEME LIGHT ĐỒNG BỘ EWORK -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-200/80">
      <div>
        <div class="flex items-center gap-2.5 flex-wrap">
          <h1 class="text-xl sm:text-2xl font-black tracking-tight text-zinc-900">
            Điều hành Xã & Quản lý Báo cáo
          </h1>
          <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80">
            {{ overviewData.communeName }} • Năm 2026
          </span>
        </div>
        <p class="text-xs text-zinc-500 mt-1">
          Hệ thống theo dõi các chỉ tiêu phát triển KTXH, Đảng bộ, Chính quyền và bóc tách báo cáo thông minh.
        </p>
      </div>

      <!-- Controls bên phải: Bộ lọc kỳ & Nút thao tác nhanh -->
      <div class="flex items-center gap-2.5 flex-wrap self-start md:self-auto">
        <!-- Bộ chọn kỳ -->
        <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100/80 border border-zinc-200 text-xs text-zinc-700">
          <Calendar :size="13" class="text-zinc-500" />
          <select
            :value="selectedPeriod"
            class="bg-transparent border-0 text-xs font-semibold text-zinc-800 focus:outline-none cursor-pointer pr-1"
            @change="(e) => { selectedPeriod = e.target.value; loadData(); }"
          >
            <option v-for="p in periods" :key="p" :value="p">
              {{ p }}
            </option>
          </select>
        </div>

        <Button
          type="button"
          variant="outline"
          class="rounded-full text-xs h-8 px-3 border-zinc-200 text-zinc-700 hover:bg-zinc-100 font-medium"
          :disabled="isLoading"
          @click="loadData"
        >
          <RefreshCw :size="12" :class="isLoading ? 'animate-spin' : ''" class="mr-1.5 text-blue-600" />
          Làm mới
        </Button>

        <Button
          type="button"
          class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3.5 font-semibold shadow-xs"
          @click="isUploadOpen = true"
        >
          <UploadCloud :size="13" class="mr-1.5" />
          Tải lên báo cáo
        </Button>
      </div>
    </div>

    <!-- TABS ĐIỀU HƯỚNG CHÍNH CỦA TRANG: DASHBOARD vs BÁO CÁO (CHỈ 1 PAGE DUY NHẤT) -->
    <Tabs v-model="mainTab" class="w-full space-y-5">
      <div class="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
        <TabsList class="bg-zinc-100 p-1 rounded-full inline-flex border border-zinc-200 h-10">
          <TabsTrigger
            value="dashboard"
            class="rounded-full text-xs font-bold px-5 py-2 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs text-zinc-600 transition-all flex items-center gap-2 cursor-pointer"
          >
            <LayoutDashboard :size="14" />
            <span>Dashboard Điều hành Số liệu</span>
          </TabsTrigger>
          <TabsTrigger
            value="reports"
            class="rounded-full text-xs font-bold px-5 py-2 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs text-zinc-600 transition-all flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet :size="14" />
            <span>Quản lý & Trích xuất Báo cáo</span>
          </TabsTrigger>
        </TabsList>

        <div class="text-[11px] text-zinc-500 hidden sm:block">
          * Bấm vào bất kỳ thẻ chỉ tiêu nào để xem văn bản báo cáo nguồn gần nhất
        </div>
      </div>

      <!-- ========================================== -->
      <!-- TAB 1: DASHBOARD ĐIỀU HÀNH SỐ LIỆU (LIGHT THEME) -->
      <!-- ========================================== -->
      <TabsContent value="dashboard" class="space-y-6 focus-visible:outline-none">
        <!-- Bộ lọc phân khối theo ý tưởng idea-1.md -->
        <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <span class="text-xs font-semibold text-zinc-500 mr-1 shrink-0">Phân khối:</span>
          
          <button
            type="button"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer"
            :class="dashboardFilter === 'ALL'
              ? 'bg-zinc-900 text-white shadow-xs'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'"
            @click="dashboardFilter = 'ALL'"
          >
            Tất cả (10 chỉ tiêu cốt lõi)
          </button>

          <button
            type="button"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
            :class="dashboardFilter === 'CHUNG'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100/80'"
            @click="dashboardFilter = 'CHUNG'"
          >
            <Building2 :size="13" />
            <span>Chung toàn xã</span>
          </button>

          <button
            type="button"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
            :class="dashboardFilter === 'DANG_UY'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'bg-rose-50 text-rose-700 hover:bg-rose-100/80'"
            @click="dashboardFilter = 'DANG_UY'"
          >
            <Award :size="13" />
            <span>Khối Đảng ủy</span>
          </button>

          <button
            type="button"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
            :class="dashboardFilter === 'UBND'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100/80'"
            @click="dashboardFilter = 'UBND'"
          >
            <Users :size="13" />
            <span>Khối UBND</span>
          </button>

          <button
            type="button"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
            :class="dashboardFilter === 'MTTQ'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80'"
            @click="dashboardFilter = 'MTTQ'"
          >
            <Sparkles :size="13" />
            <span>MTTQ & Đoàn thể</span>
          </button>
        </div>

        <!-- LƯỚI CARD CHỈ TIÊU (THEME SÁNG, 5 CỘT CHUẨN) -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 lg:gap-4">
          <IocMetricCard
            v-for="(card, idx) in displayMetrics"
            :key="card.id || idx"
            :metric="card"
            :index="idx"
            @click="handleCardClick"
          />
        </div>

        <!-- CÁC KHỐI SỐ LIỆU TỔNG QUAN THEO IDEA-1.MD -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <!-- Khối 1: Tóm tắt Khối Đảng ủy -->
          <div class="p-4 rounded-2xl bg-white border border-zinc-200/80 shadow-xs space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="h-7 w-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                  <Award :size="15" />
                </div>
                <h3 class="text-xs font-bold text-zinc-900 uppercase tracking-wider">Khối Đảng ủy</h3>
              </div>
              <span class="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">16 Chi bộ</span>
            </div>
            <div class="space-y-2 text-xs">
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Tổng số đảng viên:</span>
                <span class="font-bold text-zinc-900">486 đồng chí</span>
              </div>
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Đảng viên mới kết nạp:</span>
                <span class="font-bold text-emerald-600">18 đảng viên</span>
              </div>
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Chi bộ HT tốt nhiệm vụ:</span>
                <span class="font-bold text-blue-600">93,8%</span>
              </div>
              <div class="flex justify-between py-1 text-zinc-600">
                <span>Nhiệm vụ cấp ủy hoàn thành:</span>
                <span class="font-bold text-zinc-900">96,5%</span>
              </div>
            </div>
          </div>

          <!-- Khối 2: Tóm tắt Khối UBND -->
          <div class="p-4 rounded-2xl bg-white border border-zinc-200/80 shadow-xs space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Building2 :size="15" />
                </div>
                <h3 class="text-xs font-bold text-zinc-900 uppercase tracking-wider">Khối UBND</h3>
              </div>
              <span class="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">34 Cán bộ CC</span>
            </div>
            <div class="space-y-2 text-xs">
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Hồ sơ TTHC tiếp nhận:</span>
                <span class="font-bold text-zinc-900">1.284 hồ sơ</span>
              </div>
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Tỷ lệ giải quyết đúng hạn:</span>
                <span class="font-bold text-emerald-600">97,8%</span>
              </div>
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Thu ngân sách:</span>
                <span class="font-bold text-amber-600">12,6 tỷ (96,9% KH)</span>
              </div>
              <div class="flex justify-between py-1 text-zinc-600">
                <span>Giải ngân vốn đầu tư công:</span>
                <span class="font-bold text-blue-600">8,4 tỷ / 10,2 tỷ</span>
              </div>
            </div>
          </div>

          <!-- Khối 3: Tóm tắt Khối MTTQ & Đoàn thể -->
          <div class="p-4 rounded-2xl bg-white border border-zinc-200/80 shadow-xs space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Sparkles :size="15" />
                </div>
                <h3 class="text-xs font-bold text-zinc-900 uppercase tracking-wider">MTTQ & Đoàn thể</h3>
              </div>
              <span class="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">7.420 Đoàn viên</span>
            </div>
            <div class="space-y-2 text-xs">
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Cuộc vận động triển khai:</span>
                <span class="font-bold text-zinc-900">8 phong trào</span>
              </div>
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Tỷ lệ người dân tham gia BHYT:</span>
                <span class="font-bold text-emerald-600">95,2%</span>
              </div>
              <div class="flex justify-between py-1 border-b border-zinc-100 text-zinc-600">
                <span>Hộ nghèo & cận nghèo:</span>
                <span class="font-bold text-rose-600">276 hộ (giảm 42 hộ)</span>
              </div>
              <div class="flex justify-between py-1 text-zinc-600">
                <span>Phản ánh kiến nghị đã giải quyết:</span>
                <span class="font-bold text-zinc-900">24 / 28 kiến nghị</span>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- ========================================== -->
      <!-- TAB 2: QUẢN LÝ & TRÍCH XUẤT BÁO CÁO (LIGHT THEME) -->
      <!-- ========================================== -->
      <TabsContent value="reports" class="space-y-4 focus-visible:outline-none">
        <!-- Sub-header tab Báo cáo -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200/60">
          <Tabs v-model="reportSubTab" class="w-full sm:w-auto">
            <TabsList class="bg-zinc-100 p-1 rounded-full inline-flex border border-zinc-200 h-9">
              <TabsTrigger
                value="extract"
                class="rounded-full text-xs font-semibold px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs text-zinc-600 transition-all flex items-center gap-1.5"
              >
                <FileCheck :size="13" />
                <span>Thẩm định & Đối soát số liệu</span>
              </TabsTrigger>
              <TabsTrigger
                value="history"
                class="rounded-full text-xs font-semibold px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs text-zinc-600 transition-all flex items-center gap-1.5"
              >
                <History :size="13" />
                <span>Kho tài liệu & Báo cáo đã lưu</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <!-- Thao tác nhập mới thủ công -->
          <div class="flex items-center gap-2">
            <div v-if="selectedFilterReport" class="flex items-center gap-2 text-xs">
              <span class="text-zinc-500">Lọc theo:</span>
              <span class="font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                {{ selectedFilterReport.title }}
              </span>
              <button
                type="button"
                class="text-rose-600 hover:text-rose-800 text-[11px] underline font-medium cursor-pointer"
                @click="selectedFilterReport = null"
              >
                Xóa lọc
              </button>
            </div>

            <Button
              type="button"
              variant="outline"
              class="rounded-full text-xs h-8 px-3.5 border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold"
              @click="isManualCreateOpen = true"
            >
              <PlusCircle :size="13" class="mr-1.5 text-blue-600" />
              Nhập số liệu mới
            </Button>
          </div>
        </div>

        <!-- Nội dung Sub-tab 1: Đối soát chỉ tiêu với Switch button -->
        <div v-if="reportSubTab === 'extract'" class="space-y-4">
          <!-- Banner báo cáo vừa bóc tách -->
          <div
            v-if="lastExtractedReport"
            class="p-3.5 rounded-2xl bg-gradient-to-r from-blue-50 via-sky-50 to-indigo-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
          >
            <div class="flex items-start gap-2.5">
              <div class="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles :size="15" />
              </div>
              <div>
                <div class="text-xs font-bold text-zinc-900">
                  Báo cáo vừa tải lên: {{ lastExtractedReport.title }}
                </div>
                <p class="text-[11px] text-zinc-500">
                  {{ lastExtractedReport.fileName }} • {{ lastExtractedReport.period }} • Đã bóc tách tự động {{ lastExtractedReport.extractedCount }} chỉ tiêu.
                </p>
              </div>
            </div>

            <Button
              type="button"
              class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-7 px-4 font-semibold shrink-0 self-start sm:self-auto shadow-xs"
              :disabled="isSubmitting"
              @click="handleCommitAll"
            >
              Ghi nhận toàn bộ
            </Button>
          </div>

          <!-- Bảng đối soát chỉ tiêu (có Switch button xác nhận theo quy định) -->
          <ExtractionReviewTable
            :metrics="reviewMetrics"
            :is-submitting="isSubmitting"
            @toggle-status="handleToggleStatus"
            @update-metric="handleUpdateMetric"
            @commit-all="handleCommitAll"
          />
        </div>

        <!-- Nội dung Sub-tab 2: Danh sách lịch sử báo cáo -->
        <div v-else-if="reportSubTab === 'history'">
          <ReportHistoryTable
            :reports="overviewData.recentReports"
            @view-report="handleViewReportHistory"
          />
        </div>
      </TabsContent>
    </Tabs>

    <!-- Dialog xem báo cáo nguồn khi click vào card -->
    <MetricSourceDialog
      v-model:open="isSourceDialogOpen"
      :metric="activeMetric"
      :source-report="activeSourceReport"
      @select-report="handleJumpToReport"
    />

    <!-- Modal tải lên báo cáo PDF/DOCX trích xuất LLM -->
    <ReportUploadDialog
      v-model:open="isUploadOpen"
      @saved="handleReportSaved"
      @extracted="handleExtracted"
    />

    <!-- Modal nhập chỉ tiêu thủ công mới -->
    <ManualMetricDialog
      v-model:open="isManualCreateOpen"
      @created="handleManualCreated"
    />
  </div>
</template>
