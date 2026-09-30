<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Building2,
  Award,
  Sparkles,
  CheckCircle2,
  Users,
  Layers,
  RefreshCw,
} from 'lucide-vue-next'
import { CommuneStatService } from './services/commune-stat.service'
import IocMetricCard from './components/IocMetricCard.vue'
import MetricSourceDialog from './components/MetricSourceDialog.vue'

const router = useRouter()

const dashboardFilter = ref('ALL') // 'ALL' | 'CHUNG' | 'DANG_UY' | 'UBND' | 'MTTQ'
const isLoading = ref(false)
const isSyncing = ref(false)

// Đồng hồ thời gian thực (Live System Clock)
const currentTime = ref('')
const currentDate = ref('')
let clockTimer = null

const updateClock = () => {
  const now = new Date()
  currentTime.value = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  currentDate.value = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Dialog xem báo cáo nguồn
const isSourceDialogOpen = ref(false)
const activeMetric = ref(null)
const activeSourceReport = ref(null)
const toastMessage = ref(null)

const overviewData = ref({
  communeName: 'Xã Thiện Tân',
  year: 2026,
  metrics: [],
  recentReports: [],
})

const showToast = (message) => {
  toastMessage.value = message
  setTimeout(() => {
    toastMessage.value = null
  }, 3500)
}

const loadData = async () => {
  isLoading.value = true
  try {
    const data = await CommuneStatService.getIocOverview({
      year: 2026,
      period: 'Tháng 9/2026',
      category: 'ALL',
    })
    overviewData.value = data
  } catch (err) {
    console.error('Lỗi tải dữ liệu điều hành:', err)
  } finally {
    isLoading.value = false
  }
}

// Map các chỉ tiêu theo mã code để render động
const metricsMap = computed(() => {
  const map = {}
  for (const m of overviewData.value.metrics || []) {
    map[m.code] = m
  }
  return map
})

// Đồng bộ tự động số hồ sơ từ eWork
const handleSyncEwork = async () => {
  isSyncing.value = true
  try {
    const res = await CommuneStatService.syncFromEwork(2026, 'Tháng 9/2026')
    if (res?.success) {
      showToast('Đã đồng bộ số liệu hồ sơ từ eWork vào CSDL!')
      await loadData()
    } else {
      showToast(res?.message || 'Chưa có đủ dữ liệu eWork để đồng bộ.')
    }
  } catch (err) {
    console.error(err)
    showToast('Không thể đồng bộ eWork lúc này.')
  } finally {
    isSyncing.value = false
  }
}

// 19 chỉ tiêu tiêu chuẩn toàn diện KTXH & Hệ thống chính trị xã
const STANDARD_METRICS_META = {
  DAN_SO: { name: 'Dân số toàn xã', category: 'CHUNG', unit: 'người', icon: 'Users', isCore: true },
  HO_DAN: { name: 'Tổng số hộ gia đình', category: 'CHUNG', unit: 'hộ', icon: 'Home', isCore: true },
  DIEN_TICH: { name: 'Diện tích tự nhiên', category: 'CHUNG', unit: 'km²', icon: 'MapPin', isCore: true },
  THON_TDP: { name: 'Thôn, tổ dân phố', category: 'CHUNG', unit: 'thôn', icon: 'Building2', isCore: true },
  CAN_BO_CC: { name: 'Cán bộ, công chức, VC', category: 'CHUNG', unit: 'người', icon: 'UserCheck', isCore: false },
  DANG_VIEN: { name: 'Tổng số đảng viên', category: 'CHUNG', unit: 'đồng chí', icon: 'Award', isCore: true },
  TO_CHUC_DANG: { name: 'Tổ chức đảng, chi bộ trực thuộc', category: 'DANG_UY', unit: 'chi bộ', icon: 'Building2', isCore: false },
  DANG_VIEN_KET_NAP: { name: 'Đảng viên kết nạp trong năm', category: 'DANG_UY', unit: 'đảng viên', icon: 'Award', isCore: false },
  CHI_BO_HOAN_THANH_TOT: { name: 'Tỷ lệ chi bộ HT tốt nhiệm vụ', category: 'DANG_UY', unit: '%', icon: 'Award', isCore: false },
  NV_CAP_UY_HOAN_THANH: { name: 'Tỷ lệ nhiệm vụ cấp ủy hoàn thành', category: 'DANG_UY', unit: '%', icon: 'CheckCircle2', isCore: false },
  HO_SO_HANH_CHINH: { name: 'Hồ sơ hành chính tiếp nhận', category: 'UBND', unit: 'hồ sơ', icon: 'FileText', isCore: true },
  HO_SO_DUNG_HAN: { name: 'Tỷ lệ giải quyết đúng hạn', category: 'UBND', unit: '%', icon: 'CheckCircle2', isCore: true },
  THU_NGAN_SACH: { name: 'Kết quả thu ngân sách địa bàn', category: 'UBND', unit: 'triệu đồng', icon: 'Coins', isCore: true },
  GIAI_NGAN_VON: { name: 'Giải ngân vốn đầu tư công', category: 'UBND', unit: 'triệu đồng', icon: 'TrendingUp', isCore: false },
  HO_NGHEO_CAN_NGHEO: { name: 'Số hộ nghèo và cận nghèo', category: 'UBND', unit: 'hộ', icon: 'Heart', isCore: true },
  TY_LE_BHYT: { name: 'Tỷ lệ người dân tham gia BHYT', category: 'UBND', unit: '%', icon: 'TrendingUp', isCore: false },
  PHAN_ANH_KIEN_NGHI: { name: 'Phản ánh, kiến nghị xử lý', category: 'UBND', unit: 'đơn', icon: 'MessageSquare', isCore: true },
  DOAN_VIEN_HOI_VIEN: { name: 'Tổng số đoàn viên, hội viên', category: 'MTTQ', unit: 'người', icon: 'Users', isCore: false },
  PHONG_TRAO_TRIEN_KHAI: { name: 'Số cuộc vận động, phong trào', category: 'MTTQ', unit: 'cuộc', icon: 'Sparkles', isCore: false },
}

// 10 chỉ tiêu cốt lõi đại diện toàn cảnh KTXH & Hệ thống chính trị xã
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

// Lấy thông tin chỉ tiêu theo mã, luôn đảm bảo giá trị mặc định = 0 nếu chưa có
const getMetricByCode = (code) => {
  const found = (overviewData.value.metrics || []).find((m) => m.code === code)
  if (found) {
    return {
      ...found,
      actualValue: found.actualValue ?? 0,
    }
  }
  const meta = STANDARD_METRICS_META[code] || {}
  return {
    code,
    name: meta.name || code,
    category: meta.category || 'CHUNG',
    unit: meta.unit || '',
    actualValue: 0,
    targetValue: null,
    completionRate: 0,
    icon: meta.icon || 'TrendingUp',
    isCore: meta.isCore || false,
    sourceEvidence: 'Chưa có số liệu phát sinh từ báo cáo cho chỉ tiêu này (mặc định = 0).',
    sourceReportId: overviewData.value.recentReports?.find((r) => r.category === meta.category) || overviewData.value.recentReports?.[0] || null,
  }
}

const getMetricValue = (code) => {
  const m = getMetricByCode(code)
  return m.actualValue ?? 0
}

const getFormattedMetricValue = (code) => {
  const val = getMetricValue(code)
  if (typeof val === 'number') {
    return val.toLocaleString('vi-VN')
  }
  return String(val)
}

const getMetricRate = (code) => {
  const m = getMetricByCode(code)
  return m.completionRate ?? 0
}

// Danh sách thẻ hiển thị trên Dashboard theo bộ lọc khối (luôn hiển thị đủ và = 0 nếu chưa có số liệu)
const displayMetrics = computed(() => {
  if (dashboardFilter.value === 'ALL') {
    return core10MetricCodes.map((code) => getMetricByCode(code))
  }
  const categoryCodes = Object.keys(STANDARD_METRICS_META).filter(
    (code) => STANDARD_METRICS_META[code].category === dashboardFilter.value
  )
  return categoryCodes.map((code) => getMetricByCode(code))
})

// Click vào card số liệu hoặc dòng chỉ tiêu -> Mở dialog trích dẫn báo cáo gốc gần nhất
const handleCardClick = async (metric) => {
  if (!metric) return
  activeMetric.value = metric
  activeSourceReport.value = await CommuneStatService.getSourceReportForMetric(
    metric,
    overviewData.value.recentReports || []
  )
  isSourceDialogOpen.value = true
}

// Click theo mã code
const handleMetricClickByCode = async (code) => {
  const metric = getMetricByCode(code)
  await handleCardClick(metric)
}

// Từ dialog chuyển thẳng sang trang Báo cáo
const handleJumpToReport = (report) => {
  isSourceDialogOpen.value = false
  const repId = report?._id || report?.id
  if (repId) {
    router.push({ path: '/commune-reports', query: { reportId: repId } })
  } else {
    router.push('/commune-reports')
  }
}

onMounted(() => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
  loadData()
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <div class="w-full min-w-0 space-y-6 max-w-7xl mx-auto font-sans select-none pb-12">
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

    <!-- 1. EXECUTIVE HERO COMMAND BANNER (VỪA HÀO NHOÁNG VỪA TINH TẾ) -->
    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 text-white p-5 sm:p-7 shadow-xl border border-white/10">
      <!-- Ánh sáng chìm trang trí nền (Ambient Glow Effect) -->
      <div class="absolute -right-16 -bottom-16 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
      <div class="absolute -left-16 -top-16 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div class="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <!-- Khối Tiêu đề & Nhận diện Trung tâm IOC -->
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-white/10 text-cyan-300 border border-white/15 backdrop-blur-xs">
              <Layers :size="12" class="text-cyan-300" />
              Trung tâm Điều hành (IOC)
            </span>
          </div>

          <h1 class="text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-xs">
            Ủy Ban Nhân Dân Xã Thiện Tân
          </h1>
        </div>

        <!-- Khối Đồng hồ Thời gian thực Kỹ thuật số & Tác vụ -->
        <div class="shrink-0 flex items-center gap-3">
          <button
            type="button"
            class="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white/10 hover:bg-white/20 border border-white/20 text-cyan-200 transition-all cursor-pointer backdrop-blur-md"
            :disabled="isLoading || isSyncing"
            @click="loadData"
          >
            <RefreshCw :size="13" :class="{ 'animate-spin': isLoading }" />
            <span>Làm mới</span>
          </button>

          <button
            type="button"
            class="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 text-cyan-200 transition-all cursor-pointer backdrop-blur-md"
            :disabled="isSyncing"
            @click="handleSyncEwork"
          >
            <RefreshCw :size="13" :class="{ 'animate-spin': isSyncing }" />
            <span>Đồng bộ eWork</span>
          </button>

          <div class="px-4 py-2 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 text-left sm:text-right shadow-inner">
            <div class="text-xl sm:text-2xl font-mono font-black text-cyan-300 tracking-wider drop-shadow-xs">
              {{ currentTime || '--:--:--' }}
            </div>
            <div class="text-[11px] text-blue-200/80 font-medium capitalize mt-0.5">
              {{ currentDate }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. BỘ LỌC PHÂN KHỐI CHUYÊN NGÀNH (PILL TABS) -->
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            type="button"
            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer whitespace-nowrap shadow-2xs"
            :class="dashboardFilter === 'ALL'
              ? 'bg-zinc-900 text-white ring-2 ring-zinc-900/10'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'"
            @click="dashboardFilter = 'ALL'"
          >
            Tất cả
          </button>

          <button
            type="button"
            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 whitespace-nowrap shadow-2xs"
            :class="dashboardFilter === 'CHUNG'
              ? 'bg-blue-600 text-white ring-2 ring-blue-600/20'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100/80'"
            @click="dashboardFilter = 'CHUNG'"
          >
            <Building2 :size="13" />
            <span>Toàn xã</span>
          </button>

          <button
            type="button"
            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 whitespace-nowrap shadow-2xs"
            :class="dashboardFilter === 'DANG_UY'
              ? 'bg-rose-600 text-white ring-2 ring-rose-600/20'
              : 'bg-rose-50 text-rose-700 hover:bg-rose-100/80'"
            @click="dashboardFilter = 'DANG_UY'"
          >
            <Award :size="13" />
            <span>Đảng ủy</span>
          </button>

          <button
            type="button"
            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 whitespace-nowrap shadow-2xs"
            :class="dashboardFilter === 'UBND'
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-600/20'
              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100/80'"
            @click="dashboardFilter = 'UBND'"
          >
            <Users :size="13" />
            <span>UBND</span>
          </button>

          <button
            type="button"
            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 whitespace-nowrap shadow-2xs"
            :class="dashboardFilter === 'MTTQ'
              ? 'bg-emerald-600 text-white ring-2 ring-emerald-600/20'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80'"
            @click="dashboardFilter = 'MTTQ'"
          >
            <Sparkles :size="13" />
            <span>MTTQ</span>
          </button>
        </div>
      </div>

      <!-- 3. LƯỚI CARD CHỈ TIÊU (THEME SÁNG, 5 CỘT CHUẨN, ICON 3D & MICRO-PROGRESS BAR) -->
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 lg:gap-4">
        <IocMetricCard
          v-for="(card, idx) in displayMetrics"
          :key="card._id || card.id || idx"
          :metric="card"
          :index="idx"
          @click="handleCardClick"
        />
      </div>

      <!-- 4. BA TRỤ CỘT ĐIỀU HÀNH HOÀNH TRÁNG (ĐẢNG BỘ - CHÍNH QUYỀN - MẶT TRẬN) -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4.5 pt-2">
        <!-- Khối 1: Tóm tắt Khối Đảng ủy (Sắc đỏ cờ Crimson) -->
        <div class="p-5 rounded-3xl bg-white border border-rose-100/90 shadow-xs hover:shadow-md transition-all duration-200 space-y-4 relative overflow-hidden">
          <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-red-600" />
          
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="h-9 w-9 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center shadow-xs">
                <Award :size="18" />
              </div>
              <div>
                <h3 class="text-xs font-bold text-zinc-900 uppercase tracking-wider">Đảng ủy</h3>
              </div>
            </div>
            <span
              class="text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200/80 whitespace-nowrap shrink-0 cursor-pointer hover:bg-rose-100 transition-colors"
              title="Xem báo cáo số liệu Chi bộ"
              @click="handleMetricClickByCode('TO_CHUC_DANG')"
            >
              {{ getMetricValue('TO_CHUC_DANG') }} Chi bộ
            </span>
          </div>

          <div class="space-y-1.5 text-xs">
            <div
              class="flex justify-between items-center py-1.5 px-2 rounded-xl border-b border-zinc-100 text-zinc-600 cursor-pointer hover:bg-rose-50/60 transition-colors"
              title="Xem báo cáo Đảng viên"
              @click="handleMetricClickByCode('DANG_VIEN')"
            >
              <span>Đảng viên:</span>
              <span class="font-black text-zinc-900 font-mono">{{ getFormattedMetricValue('DANG_VIEN') }} đồng chí</span>
            </div>
            <div
              class="flex justify-between items-center py-1.5 px-2 rounded-xl border-b border-zinc-100 text-zinc-600 cursor-pointer hover:bg-rose-50/60 transition-colors"
              title="Xem báo cáo Kết nạp Đảng"
              @click="handleMetricClickByCode('DANG_VIEN_KET_NAP')"
            >
              <span>Kết nạp mới:</span>
              <span class="font-black text-emerald-600 font-mono">{{ getMetricValue('DANG_VIEN_KET_NAP') }} ({{ getMetricRate('DANG_VIEN_KET_NAP') }}%)</span>
            </div>
            <div
              class="space-y-1 py-1.5 px-2 rounded-xl border-b border-zinc-100 cursor-pointer hover:bg-rose-50/60 transition-colors"
              title="Xem báo cáo Đánh giá Chi bộ"
              @click="handleMetricClickByCode('CHI_BO_HOAN_THANH_TOT')"
            >
              <div class="flex justify-between items-center text-zinc-600">
                <span>Chi bộ tốt:</span>
                <span class="font-black text-blue-600 font-mono">{{ getMetricValue('CHI_BO_HOAN_THANH_TOT') }}%</span>
              </div>
              <div class="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                <div class="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600" :style="{ width: `${Math.min(100, getMetricValue('CHI_BO_HOAN_THANH_TOT'))}%` }" />
              </div>
            </div>
            <div
              class="space-y-1 py-1.5 px-2 rounded-xl cursor-pointer hover:bg-rose-50/60 transition-colors"
              title="Xem báo cáo Hoàn thành nhiệm vụ cấp ủy"
              @click="handleMetricClickByCode('NV_CAP_UY_HOAN_THANH')"
            >
              <div class="flex justify-between items-center text-zinc-600">
                <span>Hoàn thành NV:</span>
                <span class="font-black text-rose-600 font-mono">{{ getMetricValue('NV_CAP_UY_HOAN_THANH') }}%</span>
              </div>
              <div class="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                <div class="h-full rounded-full bg-gradient-to-r from-rose-500 to-red-600" :style="{ width: `${Math.min(100, getMetricValue('NV_CAP_UY_HOAN_THANH'))}%` }" />
              </div>
            </div>
          </div>
        </div>

        <!-- Khối 2: Tóm tắt Khối UBND (Sắc xanh Sapphire Government) -->
        <div class="p-5 rounded-3xl bg-white border border-blue-100/90 shadow-xs hover:shadow-md transition-all duration-200 space-y-4 relative overflow-hidden">
          <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-600" />

          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-xs">
                <Building2 :size="18" />
              </div>
              <div>
                <h3 class="text-xs font-bold text-zinc-900 uppercase tracking-wider">UBND</h3>
              </div>
            </div>
            <span
              class="text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200/80 whitespace-nowrap shrink-0 cursor-pointer hover:bg-blue-100 transition-colors"
              title="Xem báo cáo Đội ngũ cán bộ"
              @click="handleMetricClickByCode('CAN_BO_CC')"
            >
              {{ getMetricValue('CAN_BO_CC') }} Cán bộ
            </span>
          </div>

          <div class="space-y-1.5 text-xs">
            <div
              class="flex justify-between items-center py-1.5 px-2 rounded-xl border-b border-zinc-100 text-zinc-600 cursor-pointer hover:bg-blue-50/60 transition-colors"
              title="Xem báo cáo Tiếp nhận Hồ sơ TTHC"
              @click="handleMetricClickByCode('HO_SO_HANH_CHINH')"
            >
              <span>Hồ sơ TTHC:</span>
              <span class="font-black text-zinc-900 font-mono">{{ getFormattedMetricValue('HO_SO_HANH_CHINH') }} hồ sơ</span>
            </div>
            <div
              class="space-y-1 py-1.5 px-2 rounded-xl border-b border-zinc-100 cursor-pointer hover:bg-blue-50/60 transition-colors"
              title="Xem báo cáo Tỷ lệ giải quyết đúng hạn"
              @click="handleMetricClickByCode('HO_SO_DUNG_HAN')"
            >
              <div class="flex justify-between items-center text-zinc-600">
                <span>Đúng hạn:</span>
                <span class="font-black text-emerald-600 font-mono">{{ getMetricValue('HO_SO_DUNG_HAN') }}%</span>
              </div>
              <div class="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" :style="{ width: `${Math.min(100, getMetricValue('HO_SO_DUNG_HAN'))}%` }" />
              </div>
            </div>
            <div
              class="space-y-1 py-1.5 px-2 rounded-xl border-b border-zinc-100 cursor-pointer hover:bg-blue-50/60 transition-colors"
              title="Xem báo cáo Thu ngân sách"
              @click="handleMetricClickByCode('THU_NGAN_SACH')"
            >
              <div class="flex justify-between items-center text-zinc-600">
                <span>Thu ngân sách:</span>
                <span class="font-black text-amber-600 font-mono">{{ getFormattedMetricValue('THU_NGAN_SACH') }} triệu ({{ getMetricRate('THU_NGAN_SACH') }}%)</span>
              </div>
              <div class="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                <div class="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600" :style="{ width: `${Math.min(100, getMetricRate('THU_NGAN_SACH'))}%` }" />
              </div>
            </div>
            <div
              class="flex justify-between items-center py-1.5 px-2 rounded-xl text-zinc-600 cursor-pointer hover:bg-blue-50/60 transition-colors"
              title="Xem báo cáo Giải ngân vốn đầu tư công"
              @click="handleMetricClickByCode('GIAI_NGAN_VON')"
            >
              <span>Giải ngân ĐTC:</span>
              <span class="font-black text-blue-600 font-mono">{{ getFormattedMetricValue('GIAI_NGAN_VON') }} triệu ({{ getMetricRate('GIAI_NGAN_VON') }}%)</span>
            </div>
          </div>
        </div>

        <!-- Khối 3: Tóm tắt Khối MTTQ & Đoàn thể (Sắc xanh ngọc Emerald Unity) -->
        <div class="p-5 rounded-3xl bg-white border border-emerald-100/90 shadow-xs hover:shadow-md transition-all duration-200 space-y-4 relative overflow-hidden">
          <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-600" />

          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-xs">
                <Sparkles :size="18" />
              </div>
              <div>
                <h3 class="text-xs font-bold text-zinc-900 uppercase tracking-wider">MTTQ</h3>
              </div>
            </div>
            <span
              class="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/80 whitespace-nowrap shrink-0 cursor-pointer hover:bg-emerald-100 transition-colors"
              title="Xem báo cáo Đoàn viên, hội viên"
              @click="handleMetricClickByCode('DOAN_VIEN_HOI_VIEN')"
            >
              {{ getFormattedMetricValue('DOAN_VIEN_HOI_VIEN') }} Đoàn viên
            </span>
          </div>

          <div class="space-y-1.5 text-xs">
            <div
              class="flex justify-between items-center py-1.5 px-2 rounded-xl border-b border-zinc-100 text-zinc-600 cursor-pointer hover:bg-emerald-50/60 transition-colors"
              title="Xem báo cáo Phong trào NTM"
              @click="handleMetricClickByCode('PHONG_TRAO_TRIEN_KHAI')"
            >
              <span>Phong trào NTM:</span>
              <span class="font-black text-zinc-900 font-mono">{{ getMetricValue('PHONG_TRAO_TRIEN_KHAI') }} phong trào</span>
            </div>
            <div
              class="space-y-1 py-1.5 px-2 rounded-xl border-b border-zinc-100 cursor-pointer hover:bg-emerald-50/60 transition-colors"
              title="Xem báo cáo Tỷ lệ BHYT"
              @click="handleMetricClickByCode('TY_LE_BHYT')"
            >
              <div class="flex justify-between items-center text-zinc-600">
                <span>Tỷ lệ BHYT:</span>
                <span class="font-black text-emerald-600 font-mono">{{ getMetricValue('TY_LE_BHYT') }}%</span>
              </div>
              <div class="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" :style="{ width: `${Math.min(100, getMetricValue('TY_LE_BHYT'))}%` }" />
              </div>
            </div>
            <div
              class="flex justify-between items-center py-1.5 px-2 rounded-xl border-b border-zinc-100 text-zinc-600 cursor-pointer hover:bg-emerald-50/60 transition-colors"
              title="Xem báo cáo Hộ nghèo và cận nghèo"
              @click="handleMetricClickByCode('HO_NGHEO_CAN_NGHEO')"
            >
              <span>Hộ nghèo:</span>
              <span class="font-black text-rose-600 font-mono">{{ getMetricValue('HO_NGHEO_CAN_NGHEO') }} hộ</span>
            </div>
            <div
              class="flex justify-between items-center py-1.5 px-2 rounded-xl text-zinc-600 cursor-pointer hover:bg-emerald-50/60 transition-colors"
              title="Xem báo cáo Xử lý phản ánh, kiến nghị"
              @click="handleMetricClickByCode('PHAN_ANH_KIEN_NGHI')"
            >
              <span>Xử lý kiến nghị:</span>
              <span class="font-black text-zinc-900 font-mono">{{ getMetricValue('PHAN_ANH_KIEN_NGHI') }} đơn ({{ getMetricRate('PHAN_ANH_KIEN_NGHI') }}%)</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Dialog xem báo cáo nguồn khi click vào card chỉ tiêu -->
    <MetricSourceDialog
      v-model:open="isSourceDialogOpen"
      :metric="activeMetric"
      :source-report="activeSourceReport"
      @select-report="handleJumpToReport"
    />
  </div>
</template>
