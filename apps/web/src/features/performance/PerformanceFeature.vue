<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  CalendarDays,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Loader2,
  TriangleAlert,
  Users,
  X,
  Search,
  Building2,
  ArrowRight,
  Shield,
  Award,
  Calendar as CalendarIcon,
  Check,
  AlertCircle
} from 'lucide-vue-next'
import { CalendarDate } from '@internationalized/date'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PerformanceService } from './services/performance.service'
import { useAuth } from '@/features/auth/composables/useAuth'

const { user } = useAuth()
const loading = ref(false)
const error = ref(null)
const payload = ref(null)
const documentTab = ref('all')
const assigneeSort = ref('specialists-with-data')
const assigneeSearch = ref('')
const documentSearch = ref('')
const selectedDocument = ref(null)
const selectedAssignee = ref(null)
const detailLoading = ref(false)
const downloadingUserId = ref(null)
const exportDialogOpen = ref(false)
const exportAssignee = ref(null)
const exportRange = ref({ startDate: '', endDate: '' })
const exportRangeError = ref(null)
const exportStartPickerOpen = ref(false)
const exportEndPickerOpen = ref(false)
const period = ref(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date())
    .filter((part) => part.type !== 'literal')
    .map((part) => part.value)
    .join('-')
)

const summary = computed(() => payload.value?.summary ?? {})
const assignees = computed(() => payload.value?.assignees ?? [])

const sortedAssignees = computed(() => {
  const list = [...assignees.value].sort((left, right) => {
    const byName = () => left.user.fullName.localeCompare(right.user.fullName, 'vi')
    if (assigneeSort.value === 'point') return right.projectedPoint - left.projectedPoint || byName()
    if (assigneeSort.value === 'documents') return right.documentCount - left.documentCount || right.projectedPoint - left.projectedPoint || byName()
    if (assigneeSort.value === 'active') return right.inProgressDocumentCount - left.inProgressDocumentCount || right.pendingPoint - left.pendingPoint || byName()
    if (assigneeSort.value === 'overdue') return right.overdueDocumentCount - left.overdueDocumentCount || right.inProgressDocumentCount - left.inProgressDocumentCount || byName()

    const priority = (row) => (row.user.role?.code === 'SPECIALIST' && row.documentCount > 0 ? 0 : row.documentCount > 0 ? 1 : 2)
    return (
      priority(left) - priority(right) ||
      right.projectedPoint - left.projectedPoint ||
      right.inProgressDocumentCount - left.inProgressDocumentCount ||
      byName()
    )
  })

  if (!assigneeSearch.value.trim()) return list
  const query = assigneeSearch.value.toLowerCase().trim()
  return list.filter((row) => {
    const name = row.user?.fullName?.toLowerCase() || ''
    const pos = row.user?.position?.toLowerCase() || ''
    const dept = row.user?.department?.name?.toLowerCase() || ''
    const role = row.user?.role?.name?.toLowerCase() || ''
    return name.includes(query) || pos.includes(query) || dept.includes(query) || role.includes(query)
  })
})

const documents = computed(() => payload.value?.documents ?? [])

const assigneeDocuments = computed(() =>
  selectedAssignee.value
    ? documents.value.filter((document) => document.owner?.id === selectedAssignee.value.user.id)
    : []
)

const detailLogs = computed(() => selectedDocument.value?.trackLogs ?? [])

const documentTabs = computed(() => {
  const query = documentSearch.value.toLowerCase().trim()
  const filterByQuery = (docs) => {
    if (!query) return docs
    return docs.filter((doc) => {
      const soDen = String(doc.soDen || '').toLowerCase()
      const soKyHieu = String(doc.soKyHieu || doc.documentId || '').toLowerCase()
      const trichYeu = String(doc.trichYeu || '').toLowerCase()
      const owner = String(doc.owner?.fullName || '').toLowerCase()
      return soDen.includes(query) || soKyHieu.includes(query) || trichYeu.includes(query) || owner.includes(query)
    })
  }

  return [
    { value: 'all', count: filterByQuery(documents.value).length, documents: filterByQuery(documents.value) },
    { value: 'active', count: filterByQuery(documents.value.filter((d) => d.status !== 'COMPLETED')).length, documents: filterByQuery(documents.value.filter((d) => d.status !== 'COMPLETED')) },
    { value: 'completed', count: filterByQuery(documents.value.filter((d) => d.status === 'COMPLETED')).length, documents: filterByQuery(documents.value.filter((d) => d.status === 'COMPLETED')) },
  ]
})

const canSeeAssignees = computed(() => user.value?.role?.code !== 'SPECIALIST')

const formatNumber = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value ?? 0))
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('vi-VN') : '—')
const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

const statusLabel = (status) =>
  ({
    COMPLETED: 'Đã xử lý',
    OVERDUE: 'Quá hạn',
    IN_PROGRESS: 'Đang xử lý',
    PENDING_RECONCILIATION: 'Chờ đối soát',
    PENDING_SCORE: 'Chờ duyệt điểm',
    UNRESOLVED_PERFORMER: 'Chưa map người soạn',
  }[status] || 'Chưa xác định')

const statusConfig = (status) => {
  switch (status) {
    case 'COMPLETED':
      return { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' }
    case 'OVERDUE':
      return { border: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' }
    case 'IN_PROGRESS':
      return { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' }
    case 'PENDING_RECONCILIATION':
      return { border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' }
    case 'PENDING_SCORE':
      return { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' }
    case 'UNRESOLVED_PERFORMER':
      return { border: 'border-zinc-300', bg: 'bg-zinc-100', text: 'text-zinc-700', dot: 'bg-zinc-400' }
    default:
      return { border: 'border-zinc-200', bg: 'bg-zinc-50', text: 'text-zinc-600', dot: 'bg-zinc-400' }
  }
}


const getRoleBadge = (code, name) => {
  switch (code) {
    case 'ADMIN':
      return { bg: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Quản trị hệ thống' }
    case 'OFFICE_CHIEF':
      return { bg: 'bg-purple-50 text-purple-700 border-purple-200', label: 'Chánh văn phòng' }
    case 'COMMUNE_LEADER':
      return { bg: 'bg-indigo-50 text-indigo-700 border-indigo-200', label: 'Lãnh đạo xã' }
    case 'DEPARTMENT_LEADER':
      return { bg: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Trưởng phòng' }
    default:
      return { bg: 'bg-zinc-50 text-zinc-700 border-zinc-200', label: name || 'Chuyên viên' }
  }
}

const metricCards = computed(() => [
  {
    label: 'Tổng nhiệm vụ',
    value: summary.value.totalDocuments,
    note: `Kỳ ${payload.value?.period || period.value}`,
    icon: FileText,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-50 border-blue-100',
  },
  {
    label: 'Đã xử lý',
    value: summary.value.completedDocuments,
    note: 'Đã hoàn thành và chốt trạng thái',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-50 border-emerald-100',
  },
  {
    label: 'Đang xử lý',
    value: summary.value.inProgressDocuments,
    note: 'Gồm các mục chờ đối soát',
    icon: Clock3,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-50 border-amber-100',
  },
  {
    label: 'Quá hạn',
    value: summary.value.overdueDocuments,
    note: 'Chưa hoàn thành đúng hạn',
    icon: TriangleAlert,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-50 border-rose-100',
  },
  {
    label: 'KPI đã chốt',
    value: summary.value.totalPoint,
    note: 'Từ văn bản đã hoàn thành',
    icon: BarChart3,
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-50 border-purple-100',
  },
  {
    label: 'Điểm đang giao',
    value: summary.value.pendingPoint,
    note: 'Điểm văn bản đang thực hiện',
    icon: Users,
    iconColor: 'text-cyan-600',
    iconBg: 'bg-cyan-50 border-cyan-100',
  },
])

const openDocument = (document) => {
  selectedAssignee.value = null
  selectedDocument.value = document
  detailLoading.value = false
}

const openAssignee = (assignee) => {
  selectedDocument.value = null
  selectedAssignee.value = assignee
}

const closeDetail = () => {
  selectedDocument.value = null
  selectedAssignee.value = null
}

let pollTimer = null

const fetchData = async (isBackground = false) => {
  if (!isBackground) {
    loading.value = true
  }
  error.value = null
  try {
    payload.value = (await PerformanceService.overview(period.value)).data
  } catch (requestError) {
    if (!isBackground) {
      error.value = requestError.message || 'Không tải được dữ liệu KPI.'
    }
  } finally {
    if (!isBackground) {
      loading.value = false
    }
  }
}

const periodPickerOpen = ref(false)
const pickerYear = ref(Number(period.value.slice(0, 4)))
const periodKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`
const periodLabel = computed(() => `Tháng ${Number(period.value.slice(5, 7))}/${period.value.slice(0, 4)}`)
const isSelectedMonth = (month) => periodKey(pickerYear.value, month) === period.value

const selectPeriod = (year, month) => {
  pickerYear.value = year
  period.value = periodKey(year, month)
  periodPickerOpen.value = false
}

const shiftPeriod = (delta) => {
  const [year, month] = period.value.split('-').map(Number)
  const shifted = new Date(year, month - 1 + delta, 1)
  selectPeriod(shifted.getFullYear(), shifted.getMonth() + 1)
}

watch(periodPickerOpen, (open) => {
  if (open) pickerYear.value = Number(period.value.slice(0, 4))
})
watch(period, () => {
  closeDetail()
  fetchData()
})

const LEADERSHIP_CRITERIA = [
  { key: 'fieldResultScore', label: 'd) Kết quả hoạt động của lĩnh vực được giao phụ trách' },
  { key: 'executionScore', label: 'đ) Khả năng tổ chức triển khai thực hiện nhiệm vụ' },
  { key: 'cohesionScore', label: 'e) Năng lực tập hợp, đoàn kết công chức thuộc phạm vi quản lý' },
]
const canRateLeadership = computed(() => ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(user.value?.role?.code))
const leadershipDialogOpen = ref(false)
const leadershipTarget = ref(null)
const leadershipSaving = ref(false)
const leadershipError = ref(null)
const leadershipForm = ref({ fieldResultScore: '', executionScore: '', cohesionScore: '', note: '' })

const openLeadershipDialog = (row) => {
  leadershipTarget.value = row
  leadershipError.value = null
  const current = row.leadership ?? {}
  leadershipForm.value = {
    fieldResultScore: current.fieldResultScore ?? '',
    executionScore: current.executionScore ?? '',
    cohesionScore: current.cohesionScore ?? '',
    note: current.note ?? '',
  }
  leadershipDialogOpen.value = true
}

const saveLeadershipAssessment = async () => {
  if (!leadershipTarget.value) return
  leadershipSaving.value = true
  leadershipError.value = null
  try {
    await PerformanceService.saveLeadershipAssessment({
      userId: leadershipTarget.value.user.id,
      period: period.value,
      ...Object.fromEntries(
        LEADERSHIP_CRITERIA.filter(({ key }) => leadershipForm.value[key] !== '').map(({ key }) => [
          key,
          Number(leadershipForm.value[key]),
        ])
      ),
      note: leadershipForm.value.note.trim(),
    })
    leadershipDialogOpen.value = false
    await fetchData()
  } catch (requestError) {
    leadershipError.value = requestError.message || 'Không lưu được điểm đánh giá.'
  } finally {
    leadershipSaving.value = false
  }
}

const monthBounds = (month) => {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(year, monthNumber, 0).getDate()
  return {
    startDate: `${year}-${String(monthNumber).padStart(2, '0')}-01`,
    endDate: `${year}-${String(monthNumber).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

const calendarDateFromValue = (value) => {
  const [year, month, day] = String(value ?? '').split('-').map(Number)
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? new CalendarDate(year, month, day)
    : undefined
}
const formatExportDate = (value) => {
  const [year, month, day] = String(value ?? '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : 'Chọn ngày'
}
const exportStartCalendarDate = computed({
  get: () => calendarDateFromValue(exportRange.value.startDate),
  set: (value) => {
    if (!value) return
    exportRange.value.startDate = value.toString()
    exportStartPickerOpen.value = false
  },
})
const exportEndCalendarDate = computed({
  get: () => calendarDateFromValue(exportRange.value.endDate),
  set: (value) => {
    if (!value) return
    exportRange.value.endDate = value.toString()
    exportEndPickerOpen.value = false
  },
})

const openExportDialog = (assignee) => {
  exportAssignee.value = assignee
  exportRange.value = monthBounds(period.value)
  exportRangeError.value = null
  exportStartPickerOpen.value = false
  exportEndPickerOpen.value = false
  exportDialogOpen.value = true
}

const downloadKpi = async () => {
  const assignee = exportAssignee.value
  if (!assignee) return
  if (!exportRange.value.startDate || !exportRange.value.endDate) {
    exportRangeError.value = 'Chọn đầy đủ từ ngày và đến ngày.'
    return
  }
  if (exportRange.value.startDate > exportRange.value.endDate) {
    exportRangeError.value = 'Từ ngày không được sau đến ngày.'
    return
  }
  downloadingUserId.value = assignee.user.id
  exportRangeError.value = null
  error.value = null
  try {
    const { blob, filename } = await PerformanceService.download({
      userId: assignee.user.id,
      startDate: exportRange.value.startDate,
      endDate: exportRange.value.endDate,
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    exportDialogOpen.value = false
  } catch (requestError) {
    error.value = requestError.message || 'Không thể tạo file KPI.'
  } finally {
    downloadingUserId.value = null
  }
}

onMounted(() => {
  fetchData()

  // Polling 10 RPM (mỗi 6 giây) tự động làm mới ngầm khi tab đang mở và không mở popup
  pollTimer = setInterval(() => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      !leadershipDialogOpen.value &&
      !exportDialogOpen.value &&
      !periodPickerOpen.value
    ) {
      fetchData(true)
    }
  }, 6000)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<template>
  <div class="flex-1 h-full flex flex-col bg-zinc-50/40 overflow-hidden relative">
    <!-- Header -->
    <header class="shrink-0 px-6 py-4 md:py-5 border-b border-zinc-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-20">
      <div class="mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <!-- Title & Subtitle -->
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="text-xl md:text-2xl font-black tracking-tight text-zinc-900 truncate">Hiệu suất công việc</h1>
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/60 shrink-0">
              {{ periodLabel }}
            </span>
          </div>
          <p class="text-xs font-medium text-zinc-500 mt-0.5 truncate">
            Đối soát điểm KPI trực tiếp từ văn bản đến, tracklog và hạn xử lý.
          </p>
        </div>

        <!-- Period Selector Controls -->
        <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <div class="flex items-center bg-white border border-zinc-200/80 rounded-full p-1 shadow-sm">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
              title="Tháng trước"
              :disabled="loading"
              @click="shiftPeriod(-1)"
            >
              <ChevronLeft class="h-4 w-4" />
            </Button>

            <Popover v-model:open="periodPickerOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  class="h-8 px-3 rounded-full text-xs font-bold text-zinc-800 hover:bg-zinc-100 flex items-center gap-1.5"
                  title="Chọn kỳ hiển thị"
                >
                  <CalendarDays class="h-3.5 w-3.5 text-blue-600" />
                  <span>{{ periodLabel }}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="w-[260px] p-3 rounded-2xl shadow-xl border-zinc-200/80">
                <div class="flex items-center justify-between px-1 pb-2 border-b border-zinc-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-full text-zinc-500 hover:text-zinc-900"
                    title="Năm trước"
                    @click="pickerYear -= 1"
                  >
                    <ChevronLeft class="h-4 w-4" />
                  </Button>
                  <strong class="text-sm font-bold text-zinc-900">Năm {{ pickerYear }}</strong>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-full text-zinc-500 hover:text-zinc-900"
                    title="Năm sau"
                    @click="pickerYear += 1"
                  >
                    <ChevronRight class="h-4 w-4" />
                  </Button>
                </div>
                <div class="mt-3 grid grid-cols-3 gap-1.5">
                  <Button
                    v-for="month in 12"
                    :key="month"
                    :variant="isSelectedMonth(month) ? 'default' : 'ghost'"
                    class="h-9 rounded-xl text-xs font-bold transition-all"
                    :class="isSelectedMonth(month) ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-700 hover:bg-zinc-100'"
                    @click="selectPeriod(pickerYear, month)"
                  >
                    Tháng {{ month }}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
              title="Tháng sau"
              :disabled="loading"
              @click="shiftPeriod(1)"
            >
              <ChevronRight class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Scrollable Area -->
    <main class="flex-1 overflow-y-auto px-4 py-5 sm:px-6 md:px-8 space-y-6 max-w-[1600px] mx-auto w-full">
      <!-- Error Message -->
      <div v-if="error" class="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm font-semibold text-rose-700 flex items-center gap-3 shadow-sm">
        <AlertCircle class="w-5 h-5 shrink-0 text-rose-600" />
        <span>{{ error }}</span>
      </div>

      <!-- Loading State -->
      <div v-if="loading && !payload" class="flex flex-col items-center justify-center py-28 text-zinc-400 gap-3">
        <Loader2 class="h-8 w-8 animate-spin text-blue-600" />
        <span class="text-sm font-bold tracking-wide animate-pulse text-zinc-500">Đang đối soát dữ liệu và tính toán KPI...</span>
      </div>

      <template v-else>
        <!-- 1. METRICS OVERVIEW (6 CARDS) -->
        <section class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
          <Card
            v-for="metric in metricCards"
            :key="metric.label"
            class="rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border" :class="[metric.iconBg, metric.iconColor]">
                <component :is="metric.icon" class="w-4 h-4" />
              </span>
              <strong class="text-2xl font-black text-zinc-900 tracking-tight leading-none">
                {{ formatNumber(metric.value) }}
              </strong>
            </div>
            <p class="mt-3 text-xs font-bold text-zinc-800 truncate">{{ metric.label }}</p>
            <p class="mt-0.5 text-[11px] font-medium text-zinc-400 truncate">{{ metric.note }}</p>
          </Card>
        </section>

        <!-- 2. STAFF KPI LEADERBOARD -->
        <Card class="rounded-2xl border border-zinc-200/70 bg-white shadow-sm overflow-hidden">
          <!-- Card Header & Search / Sort -->
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 px-6 py-4 border-b border-zinc-100 bg-white">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="text-base font-bold text-zinc-900 tracking-tight">
                  {{ canSeeAssignees ? 'Bảng điểm KPI cán bộ' : 'Chỉ số KPI của tôi' }}
                </h2>
                <Badge variant="outline" class="rounded-full font-bold text-xs bg-zinc-50 text-zinc-600">
                  {{ sortedAssignees.length }} cán bộ
                </Badge>
              </div>
              <p class="text-xs font-medium text-zinc-500 mt-0.5">
                Điểm số tổng hợp theo hạn xử lý văn bản và kết quả hoàn thành trong kỳ.
              </p>
            </div>

            <div class="flex items-center flex-wrap gap-2.5">
              <!-- Search Staff -->
              <div class="relative group">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
                  <Search class="w-3.5 h-3.5" />
                </span>
                <Input
                  v-model="assigneeSearch"
                  placeholder="Tìm kiếm cán bộ..."
                  class="pl-9 pr-3 h-9 w-[180px] sm:w-[210px] bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 rounded-full text-xs font-medium transition-all"
                />
              </div>

              <!-- Sort Select -->
              <div class="flex items-center gap-1.5">
                <Select v-model="assigneeSort">
                  <SelectTrigger class="h-9 w-[170px] rounded-full border-zinc-200 bg-white text-xs font-semibold text-zinc-700">
                    <SelectValue placeholder="Sắp xếp theo" />
                  </SelectTrigger>
                  <SelectContent class="rounded-xl shadow-lg border-zinc-200">
                    <SelectItem value="specialists-with-data">Chuyên viên có dữ liệu</SelectItem>
                    <SelectItem value="point">Điểm KPI cao nhất</SelectItem>
                    <SelectItem value="documents">Nhiều văn bản nhất</SelectItem>
                    <SelectItem value="active">Đang xử lý nhiều</SelectItem>
                    <SelectItem value="overdue">Quá hạn nhiều</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <!-- Staff Table -->
          <div class="overflow-x-auto">
            <Table class="min-w-[820px]">
              <TableHeader class="bg-zinc-50/70 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                <TableRow class="border-b border-zinc-100 hover:bg-transparent">
                  <TableHead class="py-3 px-6 font-bold text-zinc-500">Cán bộ công chức</TableHead>
                  <TableHead class="py-3 px-4 text-right font-bold text-zinc-500">Tổng văn bản</TableHead>
                  <TableHead class="py-3 px-4 text-right font-bold text-zinc-500">Đã hoàn thành</TableHead>
                  <TableHead class="py-3 px-4 text-right font-bold text-zinc-500">Đang xử lý</TableHead>
                  <TableHead class="py-3 px-6 text-right font-bold text-zinc-500">Điểm KPI tháng</TableHead>
                  <TableHead class="py-3 px-6 text-center font-bold text-zinc-500">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-zinc-100">
                <TableRow
                  v-for="row in sortedAssignees"
                  :key="row.user.id"
                  tabindex="0"
                  role="button"
                  class="cursor-pointer hover:bg-blue-50/30 transition-colors group"
                  @click="openAssignee(row)"
                  @keydown.enter="openAssignee(row)"
                  @keydown.space.prevent="openAssignee(row)"
                >
                  <!-- Col 1: Name, Role, Dept -->
                  <TableCell class="py-3.5 px-6 min-w-[260px]">
                    <div class="min-w-0">
                      <p class="text-sm font-bold text-zinc-900 group-hover:text-blue-600 transition-colors leading-tight">
                        {{ row.user.fullName }}
                      </p>
                      <p class="text-xs font-medium text-zinc-500 mt-0.5 truncate">
                        {{ row.user.position || row.user.role?.name || row.user.username }} · {{ row.user.department?.name || 'Chưa phân phòng' }}
                      </p>
                      <span
                        class="inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border mt-1"
                        :class="getRoleBadge(row.user.role?.code, row.user.role?.name).bg"
                      >
                        {{ getRoleBadge(row.user.role?.code, row.user.role?.name).label }}
                      </span>
                    </div>
                  </TableCell>

                  <!-- Col 2: Total Docs -->
                  <TableCell class="py-3.5 px-4 text-right">
                    <span class="text-sm font-bold text-zinc-800">{{ formatNumber(row.documentCount) }}</span>
                  </TableCell>

                  <!-- Col 3: Completed Docs -->
                  <TableCell class="py-3.5 px-4 text-right">
                    <span class="text-sm font-bold text-emerald-600">
                      {{ formatNumber(row.completedDocumentCount) }}
                    </span>
                  </TableCell>

                  <!-- Col 4: In Progress Docs -->
                  <TableCell class="py-3.5 px-4 text-right">
                    <span class="text-sm font-bold text-amber-600">
                      {{ formatNumber(row.inProgressDocumentCount) }}
                    </span>
                  </TableCell>

                  <!-- Col 5: Monthly KPI -->
                  <TableCell class="py-3.5 px-6 text-right">
                    <div class="flex flex-col items-end">
                      <span class="text-base font-black text-zinc-950 leading-tight tracking-tight">
                        {{ formatNumber(row.monthlyKpi) }}
                      </span>
                      <p
                        v-if="row.user.role?.code === 'DEPARTMENT_LEADER' && row.departmentMemberCount"
                        class="text-[10px] font-semibold text-zinc-400 mt-0.5"
                        :title="`Gồm phần việc của chính trưởng phòng (${formatNumber(row.ownMonthlyKpi)}) cộng toàn bộ ${row.departmentMemberCount} chuyên viên trong phòng`"
                      >
                        gộp {{ row.departmentMemberCount }} chuyên viên
                      </p>
                    </div>
                  </TableCell>

                  <!-- Col 6: Actions -->
                  <TableCell class="py-3.5 px-6 text-center" @click.stop>
                    <div class="flex items-center justify-center gap-1.5">
                      <!-- Leadership Score Button -->
                      <Button
                        v-if="canRateLeadership && row.user.role?.code === 'DEPARTMENT_LEADER'"
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 rounded-full hover:bg-emerald-50 text-zinc-400 hover:text-emerald-600 transition-colors"
                        :title="`Chấm 3 chỉ tiêu lãnh đạo cho ${row.user.fullName}`"
                        @click="openLeadershipDialog(row)"
                      >
                        <CheckCircle2 class="h-4 w-4" :class="row.leadership?.ratedAt ? 'text-emerald-600 fill-emerald-100' : 'text-zinc-400'" />
                      </Button>

                      <!-- Download Excel Button -->
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 rounded-full text-zinc-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        :title="`Tải bảng KPI của ${row.user.fullName}`"
                        :disabled="downloadingUserId === row.user.id"
                        @click="openExportDialog(row)"
                      >
                        <Download class="h-4 w-4" :class="{ 'animate-spin': downloadingUserId === row.user.id }" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                <!-- Empty State -->
                <TableRow v-if="!sortedAssignees.length">
                  <TableCell colspan="6" class="py-12 text-center text-zinc-400 text-sm font-medium">
                    Không tìm thấy cán bộ nào trong phạm vi xem hoặc theo từ khóa tìm kiếm.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>

        <!-- 3. TASKS & DOCUMENTS BREAKDOWN -->
        <Card class="rounded-2xl border border-zinc-200/70 bg-white shadow-sm overflow-hidden">
          <Tabs v-model="documentTab">
            <!-- Tabs & Search Toolbar -->
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 px-6 py-4 border-b border-zinc-100 bg-white">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="text-base font-bold text-zinc-900 tracking-tight">Văn bản & Nhiệm vụ trong kỳ</h2>
                  <Badge v-if="summary.unmappedDocuments" variant="outline" class="rounded-full bg-amber-50 text-amber-700 border-amber-200 font-bold text-xs">
                    {{ formatNumber(summary.unmappedDocuments) }} chưa map người soạn
                  </Badge>
                </div>
                <p class="text-xs font-medium text-zinc-500 mt-0.5">
                  Nhiệm vụ và công việc ngoài hệ thống được tính theo hạn xử lý văn bản.
                </p>
              </div>

              <div class="flex items-center flex-wrap gap-3">
                <!-- Search Documents -->
                <div class="relative group">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
                    <Search class="w-3.5 h-3.5" />
                  </span>
                  <Input
                    v-model="documentSearch"
                    placeholder="Tìm theo số K/H, trích yếu..."
                    class="pl-9 pr-3 h-9 w-[200px] sm:w-[240px] bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 rounded-full text-xs font-medium transition-all"
                  />
                </div>

                <!-- Tabs Filter -->
                <TabsList class="rounded-full bg-zinc-100 p-1 h-9">
                  <TabsTrigger value="all" class="rounded-full px-3.5 py-1 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    Tất cả ({{ documentTabs[0].count }})
                  </TabsTrigger>
                  <TabsTrigger value="active" class="rounded-full px-3.5 py-1 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    Đang xử lý ({{ documentTabs[1].count }})
                  </TabsTrigger>
                  <TabsTrigger value="completed" class="rounded-full px-3.5 py-1 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    Đã xử lý ({{ documentTabs[2].count }})
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <!-- Tabs Content Tables -->
            <TabsContent v-for="tab in documentTabs" :key="tab.value" :value="tab.value" class="m-0 overflow-x-auto">
              <Table class="min-w-[1050px]">
                <TableHeader class="bg-zinc-50/70 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                  <TableRow class="border-b border-zinc-100 hover:bg-transparent">
                    <TableHead class="py-3 px-6 font-bold text-zinc-500">Thông tin văn bản</TableHead>
                    <TableHead class="py-3 px-4 font-bold text-zinc-500">Người thực hiện</TableHead>
                    <TableHead class="py-3 px-4 font-bold text-zinc-500">Trạng thái</TableHead>
                    <TableHead class="py-3 px-4 text-right font-bold text-zinc-500">Điểm KPI</TableHead>
                    <TableHead class="py-3 px-4 font-bold text-zinc-500">Hạn xử lý</TableHead>
                    <TableHead class="py-3 px-6 font-bold text-zinc-500">Nộp kết quả</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody class="divide-y divide-zinc-100">
                  <TableRow
                    v-for="document in tab.documents"
                    :key="document.id"
                    tabindex="0"
                    role="button"
                    class="cursor-pointer hover:bg-blue-50/30 transition-colors group"
                    @click="openDocument(document)"
                    @keydown.enter="openDocument(document)"
                    @keydown.space.prevent="openDocument(document)"
                  >
                    <!-- Col 1: Doc Info -->
                    <TableCell class="py-3.5 px-6 max-w-[420px]">
                      <div class="flex items-center gap-2">
                        <span v-if="document.soDen" class="shrink-0 rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-black text-white">
                          SĐ {{ document.soDen }}
                        </span>
                        <span class="truncate font-bold text-sm text-zinc-900 group-hover:text-blue-600 transition-colors">
                          {{ document.soKyHieu || document.documentId }}
                        </span>
                      </div>
                      <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600 font-medium">
                        {{ document.trichYeu || 'Không có trích yếu nội dung.' }}
                      </p>
                    </TableCell>

                    <!-- Col 2: Owner -->
                    <TableCell class="py-3.5 px-4 min-w-[160px]">
                      <p class="font-bold text-xs text-zinc-800 leading-tight">
                        {{ document.owner?.fullName || 'Chưa map người xử lý' }}
                      </p>
                      <p class="mt-0.5 text-[11px] text-zinc-500 truncate">
                        {{ document.owner?.position || document.owner?.username || '—' }}
                      </p>
                    </TableCell>

                    <!-- Col 3: Status -->
                    <TableCell class="py-3.5 px-4">
                      <span
                        class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold"
                        :class="[statusConfig(document.status).bg, statusConfig(document.status).border, statusConfig(document.status).text]"
                      >
                        <span class="w-1.5 h-1.5 rounded-full" :class="statusConfig(document.status).dot"></span>
                        {{ statusLabel(document.status) }}
                      </span>
                    </TableCell>

                    <!-- Col 4: Point -->
                    <TableCell class="py-3.5 px-4 text-right">
                      <p class="font-black text-sm text-blue-700 leading-tight">
                        {{ formatNumber(document.kpiEligible === false ? document.point : document.completed ? document.creditedPoint : document.point) }}
                      </p>
                      <p v-if="document.kpiEligible === false" class="text-[10px] font-semibold text-amber-700 mt-0.5">chưa chốt KPI</p>
                      <p v-else-if="document.completed && document.point !== document.creditedPoint" class="text-[10px] font-semibold text-rose-600 mt-0.5">
                        gốc {{ formatNumber(document.point) }}
                      </p>
                    </TableCell>

                    <!-- Col 5: Deadline -->
                    <TableCell class="py-3.5 px-4">
                      <p class="font-bold text-xs text-zinc-800">{{ formatDate(document.deadline) }}</p>
                      <p v-if="document.lateWorkingDays" class="mt-0.5 text-[10px] font-bold text-rose-600">
                        Trễ {{ document.lateWorkingDays }} ngày
                      </p>
                    </TableCell>

                    <!-- Col 6: Submission / Completion -->
                    <TableCell class="py-3.5 px-6 text-xs text-zinc-600">
                      <p class="font-medium">{{ formatDateTime(document.submittedAt) }}</p>
                      <p v-if="document.completedAt" class="text-[11px] text-zinc-400 mt-0.5">
                        Hoàn tất: {{ formatDateTime(document.completedAt) }}
                      </p>
                    </TableCell>
                  </TableRow>

                  <!-- Empty State -->
                  <TableRow v-if="!tab.documents.length">
                    <TableCell colspan="6" class="py-12 text-center text-zinc-400 text-sm font-medium">
                      Không có văn bản phù hợp trong danh sách này.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </Card>
      </template>
    </main>

    <!-- Dialog: Rate Leadership -->
    <Dialog v-model:open="leadershipDialogOpen">
      <DialogContent class="sm:max-w-[560px] p-0 rounded-[28px] overflow-hidden border-0 shadow-2xl">
        <div class="px-6 pt-6 pb-4 border-b border-zinc-100 bg-zinc-50/50">
          <DialogTitle class="text-lg font-bold text-zinc-900 flex items-center gap-2">
            <Award class="w-5 h-5 text-indigo-600" />
            Chấm chỉ tiêu lãnh đạo
          </DialogTitle>
          <DialogDescription class="text-xs text-zinc-500 mt-1">
            Đánh giá cho cán bộ <strong>{{ leadershipTarget?.user.fullName }}</strong> · Kỳ {{ periodLabel }}. Điểm tỷ lệ từ 0 đến 1 (ví dụ 0.9 = 90%, 1 = 100%).
          </DialogDescription>
        </div>

        <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div v-for="criterion in LEADERSHIP_CRITERIA" :key="criterion.key" class="space-y-1.5">
            <label class="text-xs font-bold text-zinc-700 block">
              {{ criterion.label }}
            </label>
            <Input
              v-model="leadershipForm[criterion.key]"
              type="number"
              min="0"
              max="1"
              step="0.05"
              class="h-10 rounded-xl bg-white border-zinc-200 font-semibold"
              placeholder="Nhập từ 0 đến 1 (để trống nếu chưa chấm)"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-bold text-zinc-700 block">Ghi chú nhận xét</label>
            <Input
              v-model="leadershipForm.note"
              class="h-10 rounded-xl bg-white border-zinc-200"
              placeholder="Ghi chú nhận xét của lãnh đạo (không bắt buộc)"
            />
          </div>

          <p v-if="leadershipError" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {{ leadershipError }}
          </p>
        </div>

        <div class="px-6 py-4 bg-white border-t border-zinc-100 flex items-center justify-end gap-3">
          <Button
            variant="outline"
            :disabled="leadershipSaving"
            class="h-10 px-5 rounded-full font-bold border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            @click="leadershipDialogOpen = false"
          >
            Hủy bỏ
          </Button>
          <Button
            :disabled="leadershipSaving"
            class="h-10 px-6 rounded-full font-bold bg-zinc-900 text-white hover:bg-zinc-800 shadow-md transition-all flex items-center gap-2"
            @click="saveLeadershipAssessment"
          >
            <Loader2 v-if="leadershipSaving" class="w-4 h-4 animate-spin" />
            <span>{{ leadershipSaving ? 'Đang lưu...' : 'Lưu điểm đánh giá' }}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Dialog: Export KPI Excel -->
    <Dialog v-model:open="exportDialogOpen">
      <DialogContent class="sm:max-w-[460px] p-0 rounded-[28px] overflow-hidden border-0 shadow-2xl">
        <div class="px-6 pt-6 pb-4 border-b border-zinc-100 bg-zinc-50/50">
          <DialogTitle class="text-lg font-bold text-zinc-900 flex items-center gap-2">
            <Download class="w-5 h-5 text-blue-600" />
            Tải bảng tổng hợp KPI
          </DialogTitle>
          <DialogDescription class="text-xs text-zinc-500 mt-1">
            Xuất file Excel cho cán bộ <strong>{{ exportAssignee?.user.fullName }}</strong> theo khoảng thời gian xử lý văn bản.
          </DialogDescription>
        </div>

        <div class="p-6 space-y-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <!-- Start Date -->
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-zinc-600 uppercase tracking-wider pl-1">Từ ngày</label>
              <Popover v-model:open="exportStartPickerOpen">
                <PopoverTrigger as-child>
                  <Button
                    variant="outline"
                    class="h-10 w-full justify-between rounded-xl border-zinc-200 bg-white px-3 font-semibold text-zinc-800 text-xs"
                  >
                    <span>{{ formatExportDate(exportRange.startDate) }}</span>
                    <CalendarIcon class="h-4 w-4 text-zinc-400" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" class="w-auto p-0 rounded-2xl shadow-xl border-zinc-200">
                  <Calendar v-model="exportStartCalendarDate" locale="vi-VN" :max-value="exportEndCalendarDate" initial-focus />
                </PopoverContent>
              </Popover>
            </div>

            <!-- End Date -->
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-zinc-600 uppercase tracking-wider pl-1">Đến ngày</label>
              <Popover v-model:open="exportEndPickerOpen">
                <PopoverTrigger as-child>
                  <Button
                    variant="outline"
                    class="h-10 w-full justify-between rounded-xl border-zinc-200 bg-white px-3 font-semibold text-zinc-800 text-xs"
                  >
                    <span>{{ formatExportDate(exportRange.endDate) }}</span>
                    <CalendarIcon class="h-4 w-4 text-zinc-400" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" class="w-auto p-0 rounded-2xl shadow-xl border-zinc-200">
                  <Calendar v-model="exportEndCalendarDate" locale="vi-VN" :min-value="exportStartCalendarDate" initial-focus />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <p v-if="exportRangeError" class="text-xs font-semibold text-rose-600 bg-rose-50 px-3 py-2 rounded-xl border border-rose-200">
            {{ exportRangeError }}
          </p>
        </div>

        <div class="px-6 py-4 bg-white border-t border-zinc-100 flex items-center justify-end gap-3">
          <Button
            variant="outline"
            :disabled="Boolean(downloadingUserId)"
            class="h-10 px-5 rounded-full font-bold border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            @click="exportDialogOpen = false"
          >
            Hủy bỏ
          </Button>
          <Button
            :disabled="Boolean(downloadingUserId)"
            class="h-10 px-6 rounded-full font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all flex items-center gap-2"
            @click="downloadKpi"
          >
            <Download class="h-4 w-4" :class="{ 'animate-pulse': Boolean(downloadingUserId) }" />
            <span>{{ downloadingUserId ? 'Đang xuất file...' : 'Tải file Excel' }}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Slide-over Detail Drawer -->
    <Teleport to="body">
      <Transition name="performance-drawer">
        <div v-if="selectedDocument || selectedAssignee" class="fixed inset-0 z-[80]">
          <!-- Backdrop -->
          <button
            class="absolute inset-0 h-full w-full cursor-default bg-zinc-950/30 backdrop-blur-sm transition-opacity"
            type="button"
            aria-label="Đóng chi tiết"
            @click="closeDetail"
          />

          <!-- Drawer Content -->
          <aside class="absolute right-0 top-0 flex h-full w-full max-w-[620px] flex-col border-l border-zinc-200/80 bg-white shadow-2xl">
            <!-- Header -->
            <div class="flex items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4 bg-zinc-50/60">
              <div class="min-w-0">
                <h2 class="text-base font-bold text-zinc-900">
                  {{ selectedDocument ? 'Chi tiết văn bản & Tracklog' : 'Hồ sơ hiệu suất cán bộ' }}
                </h2>
                <p class="mt-0.5 truncate text-xs text-zinc-500 font-medium">
                  {{ selectedDocument?.soKyHieu || selectedDocument?.documentId || selectedAssignee?.user.fullName }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <Loader2 v-if="detailLoading" class="h-4 w-4 animate-spin text-zinc-400" />
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60"
                  title="Đóng"
                  @click="closeDetail"
                >
                  <X class="h-4 w-4" />
                </Button>
              </div>
            </div>

            <!-- Content: Assignee Details -->
            <div v-if="selectedAssignee" class="min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
              <!-- Staff Profile Card -->
              <div class="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                <div class="min-w-0">
                  <h3 class="text-lg font-bold text-zinc-900 leading-tight">
                    {{ selectedAssignee.user.fullName }}
                  </h3>
                  <p class="text-xs font-medium text-zinc-500 mt-1">
                    {{ selectedAssignee.user.position || selectedAssignee.user.role?.name || selectedAssignee.user.username }} · {{ selectedAssignee.user.department?.name || 'Chưa phân phòng' }}
                  </p>
                  <span
                    class="inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border mt-1.5"
                    :class="getRoleBadge(selectedAssignee.user.role?.code, selectedAssignee.user.role?.name).bg"
                  >
                    {{ getRoleBadge(selectedAssignee.user.role?.code, selectedAssignee.user.role?.name).label }}
                  </span>
                </div>
              </div>

              <!-- 4 Stat Badges -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div class="rounded-xl bg-blue-50/80 border border-blue-100 p-3 text-center">
                  <span class="text-[10px] font-bold uppercase text-blue-600 block">KPI đã chốt</span>
                  <strong class="mt-1 text-xl font-black text-blue-800 block leading-tight">
                    {{ formatNumber(selectedAssignee.totalPoint) }}
                  </strong>
                </div>
                <div class="rounded-xl bg-amber-50/80 border border-amber-100 p-3 text-center">
                  <span class="text-[10px] font-bold uppercase text-amber-600 block">Điểm đang giao</span>
                  <strong class="mt-1 text-xl font-black text-amber-800 block leading-tight">
                    {{ formatNumber(selectedAssignee.pendingPoint) }}
                  </strong>
                </div>
                <div class="rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-center">
                  <span class="text-[10px] font-bold uppercase text-zinc-500 block">Văn bản / Quá hạn</span>
                  <strong class="mt-1 text-xl font-black text-zinc-800 block leading-tight">
                    {{ selectedAssignee.documentCount }} / {{ selectedAssignee.overdueDocumentCount }}
                  </strong>
                </div>
                <div class="rounded-xl bg-rose-50/80 border border-rose-100 p-3 text-center">
                  <span class="text-[10px] font-bold uppercase text-rose-600 block">Ngày trễ</span>
                  <strong class="mt-1 text-xl font-black text-rose-800 block leading-tight">
                    {{ selectedAssignee.lateWorkingDays }}
                  </strong>
                </div>
              </div>

              <!-- Assignee Documents List -->
              <div class="space-y-3 pt-2">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Văn bản gán cho cán bộ trong kỳ
                  </h4>
                  <Badge variant="outline" class="rounded-full font-bold text-[11px]">
                    {{ assigneeDocuments.length }} văn bản
                  </Badge>
                </div>

                <div class="rounded-2xl border border-zinc-200/80 overflow-hidden">
                  <Table>
                    <TableHeader class="bg-zinc-50/70 text-[10px] uppercase font-bold text-zinc-500">
                      <TableRow>
                        <TableHead class="py-2.5 px-4 font-bold">Văn bản</TableHead>
                        <TableHead class="py-2.5 px-3 text-right font-bold">Điểm</TableHead>
                        <TableHead class="py-2.5 px-3 text-center font-bold">Xong</TableHead>
                        <TableHead class="py-2.5 px-3 text-right font-bold">Chậm</TableHead>
                        <TableHead class="py-2.5 px-3 text-right font-bold">Làm lại</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody class="divide-y divide-zinc-100">
                      <TableRow
                        v-for="document in assigneeDocuments"
                        :key="document.id"
                        tabindex="0"
                        role="button"
                        class="cursor-pointer hover:bg-blue-50/40 transition-colors"
                        @click="openDocument(document)"
                      >
                        <TableCell class="py-3 px-4 max-w-[240px]">
                          <p class="truncate font-bold text-xs text-zinc-900">{{ document.soKyHieu || document.documentId }}</p>
                          <p class="mt-0.5 line-clamp-1 text-[11px] text-zinc-500">{{ document.trichYeu || 'Không có trích yếu.' }}</p>
                        </TableCell>
                        <TableCell class="py-3 px-3 text-right font-black text-xs text-blue-700">
                          {{ formatNumber(document.point) }}
                        </TableCell>
                        <TableCell class="py-3 px-3 text-center">
                          <Check v-if="document.completed" class="w-4 h-4 text-emerald-600 mx-auto" />
                          <span v-else class="text-zinc-300">—</span>
                        </TableCell>
                        <TableCell class="py-3 px-3 text-right font-bold text-xs" :class="document.lateWorkingDays ? 'text-rose-600' : 'text-zinc-400'">
                          {{ formatNumber(document.lateWorkingDays) }}
                        </TableCell>
                        <TableCell class="py-3 px-3 text-right font-bold text-xs" :class="document.reworkCount ? 'text-amber-700' : 'text-zinc-400'">
                          {{ formatNumber(document.reworkCount) }}
                        </TableCell>
                      </TableRow>
                      <TableRow v-if="!assigneeDocuments.length">
                        <TableCell colspan="5" class="py-8 text-center text-xs font-medium text-zinc-400">
                          Chưa có văn bản gán cho nhân sự này trong kỳ.
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <!-- Content: Document Details & Tracklog -->
            <div v-else-if="selectedDocument" class="min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
              <!-- Document Header & Meta -->
              <div class="space-y-3 pb-4 border-b border-zinc-100">
                <div class="flex flex-wrap items-center gap-2">
                  <span v-if="selectedDocument.soDen" class="rounded-md bg-zinc-900 px-2 py-0.5 text-xs font-black text-white">
                    SĐ {{ selectedDocument.soDen }}
                  </span>
                  <span class="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-bold text-zinc-800">
                    {{ selectedDocument.soKyHieu || selectedDocument.documentId }}
                  </span>
                  <span
                    class="rounded-full border px-2.5 py-0.5 text-xs font-bold"
                    :class="[statusConfig(selectedDocument.status).bg, statusConfig(selectedDocument.status).border, statusConfig(selectedDocument.status).text]"
                  >
                    {{ statusLabel(selectedDocument.status) }}
                  </span>
                </div>

                <h3 class="text-base font-bold text-zinc-900 leading-relaxed">
                  {{ selectedDocument.trichYeu || 'Không có trích yếu văn bản.' }}
                </h3>

                <div class="grid grid-cols-2 gap-3 pt-2">
                  <div class="bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                    <span class="text-[10px] font-bold uppercase text-zinc-400 block">Người xử lý</span>
                    <strong class="text-xs font-bold text-zinc-800 block mt-1">
                      {{ selectedDocument.processing?.currentAssignee?.fullName || selectedDocument.processing?.currentAssignee?.externalFullName || selectedDocument.owner?.fullName || 'Chưa map người xử lý' }}
                    </strong>
                  </div>
                  <div class="bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                    <span class="text-[10px] font-bold uppercase text-zinc-400 block">Hạn xử lý</span>
                    <strong class="text-xs font-bold text-zinc-800 block mt-1">
                      {{ formatDate(selectedDocument.deadline) }}
                    </strong>
                  </div>
                  <div class="bg-blue-50/70 p-3 rounded-xl border border-blue-100">
                    <span class="text-[10px] font-bold uppercase text-blue-600 block">Điểm KPI</span>
                    <strong class="text-base font-black text-blue-800 block mt-0.5">
                      {{ formatNumber(selectedDocument.point) }}
                    </strong>
                  </div>
                  <div class="bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                    <span class="text-[10px] font-bold uppercase text-zinc-400 block">Ngày đến</span>
                    <strong class="text-xs font-bold text-zinc-800 block mt-1">
                      {{ selectedDocument.ngayDen || '—' }}
                    </strong>
                  </div>
                </div>
              </div>

              <!-- Reconciliation & Status Details -->
              <div class="space-y-2 pb-4 border-b border-zinc-100 text-xs">
                <h4 class="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Kết quả đối soát KPI</h4>
                <div class="flex justify-between py-1">
                  <span class="text-zinc-500 font-medium">Người nhận điểm</span>
                  <span class="font-bold text-zinc-800 text-right">
                    {{ selectedDocument.owner?.fullName || 'Chưa map được' }}
                  </span>
                </div>
                <div v-if="selectedDocument.reconciliation?.lastError" class="flex justify-between py-1 text-rose-600">
                  <span class="font-medium">Lý do chờ</span>
                  <span class="font-bold text-right max-w-[280px]">{{ selectedDocument.reconciliation.lastError }}</span>
                </div>
                <div class="flex justify-between py-1">
                  <span class="text-zinc-500 font-medium">Thời điểm nộp</span>
                  <span class="font-bold text-zinc-800 text-right">{{ formatDateTime(selectedDocument.submittedAt) }}</span>
                </div>
                <div class="flex justify-between py-1">
                  <span class="text-zinc-500 font-medium">Thời điểm hoàn tất</span>
                  <span class="font-bold text-zinc-800 text-right">{{ formatDateTime(selectedDocument.completedAt) }}</span>
                </div>
              </div>

              <!-- Visual Vertical Timeline: Tracklogs -->
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Lịch sử xử lý & luân chuyển
                  </h4>
                  <Badge variant="outline" class="rounded-full font-bold text-[11px]">
                    {{ detailLogs.length }} bước
                  </Badge>
                </div>

                <div v-if="detailLogs.length" class="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-200">
                  <div
                    v-for="(log, index) in detailLogs"
                    :key="log.id || index"
                    class="relative"
                  >
                    <!-- Node Dot -->
                    <span class="absolute -left-6 top-1.5 w-5 h-5 rounded-full border-2 border-white bg-blue-600 flex items-center justify-center shadow-sm">
                      <span class="w-1.5 h-1.5 rounded-full bg-white"></span>
                    </span>

                    <div class="bg-zinc-50 border border-zinc-100 rounded-xl p-3 space-y-1.5">
                      <div class="flex items-center gap-1.5 text-xs">
                        <span class="font-bold text-zinc-900">{{ log.sender?.fullName || 'Hệ thống' }}</span>
                        <ArrowRight v-if="log.receiver?.fullName" class="w-3.5 h-3.5 text-zinc-400" />
                        <span v-if="log.receiver?.fullName" class="font-bold text-blue-600">{{ log.receiver.fullName }}</span>
                      </div>
                      <p v-if="log.action" class="text-xs font-semibold text-indigo-600">
                        {{ log.action }}
                      </p>
                      <p v-if="log.comment || log.content" class="text-xs text-zinc-700 bg-white p-2 rounded-lg border border-zinc-100 leading-relaxed font-medium">
                        {{ log.comment || log.content }}
                      </p>
                      <p class="text-[10px] font-medium text-zinc-400">
                        {{ log.completedAt || log.processingAt || log.receivedAt || log.updatedAt || 'Không có thời điểm' }}
                      </p>
                    </div>
                  </div>
                </div>

                <div v-else class="text-center py-8 text-zinc-400 text-xs font-medium bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                  Chưa có thông tin tracklog cho văn bản này.
                </div>
              </div>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.performance-drawer-enter-active,
.performance-drawer-leave-active {
  transition: opacity 220ms ease;
}
.performance-drawer-enter-active > button,
.performance-drawer-leave-active > button {
  transition: opacity 220ms ease;
}
.performance-drawer-enter-active > aside,
.performance-drawer-leave-active > aside {
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.performance-drawer-enter-from > button,
.performance-drawer-leave-to > button {
  opacity: 0;
}
.performance-drawer-enter-from > aside,
.performance-drawer-leave-to > aside {
  transform: translateX(100%);
}
</style>
