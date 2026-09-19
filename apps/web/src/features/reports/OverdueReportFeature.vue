<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  Clock3,
  FileText,
  Download,
  Search,
  RotateCcw,
  Calendar as CalendarIcon,
  Building2,
  User,
  X,
  ExternalLink
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import OfficeDocumentDrawer from '@/features/office-documents/components/OfficeDocumentDrawer.vue'
import { CalendarDate } from '@internationalized/date'
import SlidingTabs from '@/components/ui/sliding-tabs/SlidingTabs.vue'
import { http } from '@/shared/api/http'
import { useAuth } from '@/features/auth/composables/useAuth'
import { ReportService } from './services/report.service'

const { user } = useAuth()

const VIEW_TABS = [
  { id: 'items', label: 'Chi tiết văn bản' },
  { id: 'department', label: 'Theo phòng ban' },
  { id: 'user', label: 'Theo người xử lý' },
]

const DEADLINE_STATUS_LABEL = {
  PENDING_OVERDUE: 'Đang quá hạn',
  DONE_LATE: 'Đã xử lý (trễ hạn)',
}

const isDepartmentLocked = computed(() => user.value?.role?.code === 'DEPARTMENT_LEADER')

const filters = reactive({
  departmentId: isDepartmentLocked.value ? (user.value?.department?._id ?? user.value?.department ?? '') : '',
  userId: '',
  dateFrom: '',
  dateTo: '',
})

const statusPreset = ref('all')
const searchQuery = ref('')
const dateFromPickerOpen = ref(false)
const dateToPickerOpen = ref(false)

// State xem chi tiết văn bản (Slide-over drawer như office-documents)
const drawerOpen = ref(false)
const selectedDocumentId = ref('')
const selectedItem = ref(null)

const calendarDateFromValue = (value) => {
  const [year, month, day] = String(value ?? '').split('-').map(Number)
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? new CalendarDate(year, month, day)
    : undefined
}

const formatDateDisplay = (value, placeholder = 'Chọn ngày') => {
  const [year, month, day] = String(value ?? '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : placeholder
}

const dateFromCalendarDate = computed({
  get: () => calendarDateFromValue(filters.dateFrom),
  set: (value) => {
    filters.dateFrom = value ? value.toString() : ''
    dateFromPickerOpen.value = false
    fetchReport()
  },
})

const dateToCalendarDate = computed({
  get: () => calendarDateFromValue(filters.dateTo),
  set: (value) => {
    filters.dateTo = value ? value.toString() : ''
    dateToPickerOpen.value = false
    fetchReport()
  },
})

const departments = ref([])
const users = ref([])
const loading = ref(false)
const downloading = ref(false)
const error = ref('')
const payload = ref({ items: [], departmentSummary: [], userSummary: [] })
const meta = ref({ total: 0, generatedAt: null, truncated: false })
const activeView = ref('items')

const filteredUsers = computed(() =>
  filters.departmentId
    ? users.value.filter((candidate) => String(candidate.department?._id ?? candidate.department ?? '') === String(filters.departmentId))
    : users.value
)

const requestFilters = computed(() => ({
  departmentId: filters.departmentId,
  userId: filters.userId,
  dateFrom: filters.dateFrom,
  dateTo: filters.dateTo,
  pageType: 'incoming',
  deadlineStatus: 'PENDING_OVERDUE,DONE_LATE',
}))

// Status presets handler: Lọc cục bộ trên danh sách, không gọi API làm mất thống kê
const setStatusPreset = (preset) => {
  statusPreset.value = preset
}

// Local search & status filter across views
const filteredItems = computed(() => {
  let list = payload.value.items ?? []
  if (statusPreset.value === 'pending-overdue') {
    list = list.filter((item) => item.deadlineStatus === 'PENDING_OVERDUE')
  } else if (statusPreset.value === 'done-late') {
    list = list.filter((item) => item.deadlineStatus === 'DONE_LATE')
  }

  if (!searchQuery.value.trim()) return list
  const q = searchQuery.value.toLowerCase().trim()
  return list.filter((item) => {
    const soKyHieu = String(item.soKyHieu || '').toLowerCase()
    const subject = String(item.subject || '').toLowerCase()
    const dept = String(item.departmentName || '').toLowerCase()
    const assignee = String(item.assigneeName || '').toLowerCase()
    return soKyHieu.includes(q) || subject.includes(q) || dept.includes(q) || assignee.includes(q)
  })
})

const filteredDepartmentSummary = computed(() => {
  let list = payload.value.departmentSummary ?? []
  if (statusPreset.value === 'pending-overdue') {
    list = list.filter((row) => (row.pendingOverdue || 0) > 0)
  } else if (statusPreset.value === 'done-late') {
    list = list.filter((row) => (row.doneLate || 0) > 0)
  }

  if (!searchQuery.value.trim()) return list
  const q = searchQuery.value.toLowerCase().trim()
  return list.filter((row) => String(row.departmentName || '').toLowerCase().includes(q))
})

const filteredUserSummary = computed(() => {
  let list = payload.value.userSummary ?? []
  if (statusPreset.value === 'pending-overdue') {
    list = list.filter((row) => (row.pendingOverdue || 0) > 0)
  } else if (statusPreset.value === 'done-late') {
    list = list.filter((row) => (row.doneLate || 0) > 0)
  }

  if (!searchQuery.value.trim()) return list
  const q = searchQuery.value.toLowerCase().trim()
  return list.filter((row) => {
    const name = String(row.fullName || '').toLowerCase()
    const dept = String(row.departmentName || '').toLowerCase()
    return name.includes(q) || dept.includes(q)
  })
})

const summaryStats = computed(() => {
  const items = payload.value.items ?? []
  const pending = items.filter((item) => item.deadlineStatus === 'PENDING_OVERDUE')
  const late = items.filter((item) => item.deadlineStatus === 'DONE_LATE')
  const worst = items.reduce((max, item) => Math.max(max, item.overdueDays ?? 0), 0)
  return {
    total: items.length,
    pending: pending.length,
    late: late.length,
    worst,
  }
})

const fetchFilterOptions = async () => {
  try {
    const [departmentResponse, userResponse] = await Promise.all([
      http('/api/departments?limit=100'),
      http('/api/users?limit=100&status=ACTIVE'),
    ])
    departments.value = departmentResponse.data ?? []
    users.value = userResponse.data ?? []
  } catch {
    // The report still loads without dropdowns
  }
}

let pollTimer = null

const fetchReport = async (isBackground = false) => {
  if (!isBackground) {
    loading.value = true
  }
  error.value = ''
  try {
    const response = await ReportService.overdue(requestFilters.value)
    payload.value = response.data ?? { items: [], departmentSummary: [], userSummary: [] }
    meta.value = response.meta ?? { total: 0, generatedAt: null, truncated: false }
  } catch (requestError) {
    if (!isBackground) {
      error.value = requestError.message || 'Không thể tải báo cáo.'
    }
  } finally {
    if (!isBackground) {
      loading.value = false
    }
  }
}

const downloadExcel = async () => {
  downloading.value = true
  error.value = ''
  try {
    const { blob, filename } = await ReportService.downloadOverdueReport(requestFilters.value)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch (requestError) {
    error.value = requestError.message || 'Không thể xuất file Excel.'
  } finally {
    downloading.value = false
  }
}

const resetFilters = () => {
  if (!isDepartmentLocked.value) filters.departmentId = ''
  filters.userId = ''
  filters.dateFrom = ''
  filters.dateTo = ''
  searchQuery.value = ''
  statusPreset.value = 'all'
  fetchReport()
}

// Mở slide-over drawer xem chi tiết văn bản như trong office-documents
const openDetail = (item) => {
  if (!item) return
  selectedItem.value = item
  selectedDocumentId.value = item.id
  drawerOpen.value = true
}

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('vi-VN') : '—')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const statusLabel = (status) => DEADLINE_STATUS_LABEL[status] || status
const overdueDaysColor = (days) => (days >= 15 ? 'text-rose-700' : days >= 7 ? 'text-rose-600' : 'text-amber-600')

watch(
  () => filters.departmentId,
  (next, previous) => {
    if (next !== previous) filters.userId = ''
  }
)

onMounted(async () => {
  await fetchFilterOptions()
  await fetchReport()

  // Polling 10 RPM (mỗi 6 giây) tự động làm mới ngầm khi tab đang mở
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      fetchReport(true)
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
            <h1 class="text-xl md:text-2xl font-black tracking-tight text-zinc-900 truncate">
              Theo dõi hạn xử lý
            </h1>
            <span
              v-if="summaryStats.pending > 0"
              class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200/60 shrink-0"
            >
              {{ summaryStats.pending }} quá hạn
            </span>
          </div>
          <p class="text-xs font-medium text-zinc-500 mt-0.5 truncate">
            Thống kê văn bản quá hạn, xử lý trễ và sắp đến hạn theo phòng ban và cán bộ.
          </p>
        </div>

        <!-- Header Actions -->
        <div class="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          <Button
            class="h-9 px-4 rounded-full font-bold bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm transition-all flex items-center gap-2 text-xs"
            :disabled="downloading || !payload.items.length"
            @click="downloadExcel"
          >
            <Download class="w-3.5 h-3.5" :class="{ 'animate-pulse': downloading }" />
            <span>{{ downloading ? 'Đang xuất...' : 'Xuất Excel' }}</span>
          </Button>
        </div>
      </div>
    </header>

    <!-- Main Scrollable Content -->
    <main class="flex-1 overflow-y-auto px-4 py-5 sm:px-6 md:px-8 space-y-5 max-w-[1600px] mx-auto w-full">
      <!-- Error Message -->
      <div v-if="error" class="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-xs font-semibold text-rose-700 flex items-center gap-3 shadow-sm">
        <AlertTriangle class="w-4 h-4 shrink-0 text-rose-600" />
        <span>{{ error }}</span>
      </div>

      <!-- 1. SUMMARY STATS CARDS (3 CARDS) -->
      <section class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <!-- Card 1: Total Overdue & Worst -->
        <Card class="rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-sm hover:shadow-md transition-all">
          <div class="flex items-center justify-between gap-2">
            <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-zinc-100 text-zinc-700 border border-zinc-200">
              <FileText class="w-4 h-4" />
            </span>
            <strong class="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight leading-none">
              {{ summaryStats.total }}
            </strong>
          </div>
          <p class="mt-3 text-xs font-bold text-zinc-800">Tổng văn bản quá hạn</p>
          <p class="mt-0.5 text-[11px] font-semibold text-rose-600">
            Quá hạn lâu nhất: {{ summaryStats.worst }} ngày
          </p>
        </Card>

        <!-- Card 2: Pending Overdue -->
        <Card class="rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-sm hover:shadow-md transition-all">
          <div class="flex items-center justify-between gap-2">
            <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-rose-50 text-rose-600 border border-rose-100">
              <AlertTriangle class="w-4 h-4" />
            </span>
            <strong class="text-2xl sm:text-3xl font-black text-rose-600 tracking-tight leading-none">
              {{ summaryStats.pending }}
            </strong>
          </div>
          <p class="mt-3 text-xs font-bold text-zinc-800">Đang quá hạn</p>
          <p class="mt-0.5 text-[11px] font-medium text-zinc-400">Chưa xử lý xong, đã muộn hạn</p>
        </Card>

        <!-- Card 3: Done Late -->
        <Card class="rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-sm hover:shadow-md transition-all">
          <div class="flex items-center justify-between gap-2">
            <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-50 text-amber-600 border border-amber-100">
              <Clock3 class="w-4 h-4" />
            </span>
            <strong class="text-2xl sm:text-3xl font-black text-amber-600 tracking-tight leading-none">
              {{ summaryStats.late }}
            </strong>
          </div>
          <p class="mt-3 text-xs font-bold text-zinc-800">Đã xử lý trễ hạn</p>
          <p class="mt-0.5 text-[11px] font-medium text-zinc-400">Đã hoàn thành nhưng trễ hạn</p>
        </Card>
      </section>

      <!-- 2. STREAMLINED FILTER TOOLBAR -->
      <Card class="rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-sm space-y-3.5">
        <!-- Row 1: Status Filter Pills -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center flex-wrap gap-1.5">
            <span class="text-xs font-bold text-zinc-500 mr-1 select-none">Tình trạng:</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-3 rounded-full text-xs font-bold transition-all"
              :class="statusPreset === 'all' ? 'bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 hover:text-white' : 'text-zinc-600 hover:bg-zinc-100'"
              @click="setStatusPreset('all')"
            >
              Tất cả ({{ summaryStats.total }})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-3 rounded-full text-xs font-bold transition-all"
              :class="statusPreset === 'pending-overdue' ? 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 hover:text-white' : 'text-rose-700 hover:bg-rose-50'"
              @click="setStatusPreset('pending-overdue')"
            >
              Đang quá hạn ({{ summaryStats.pending }})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-3 rounded-full text-xs font-bold transition-all"
              :class="statusPreset === 'done-late' ? 'bg-amber-600 text-white shadow-sm hover:bg-amber-700 hover:text-white' : 'text-amber-700 hover:bg-amber-50'"
              @click="setStatusPreset('done-late')"
            >
              Đã xử lý trễ ({{ summaryStats.late }})
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2.5 rounded-full text-xs font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 flex items-center gap-1.5"
            @click="resetFilters"
          >
            <RotateCcw class="w-3 h-3" />
            <span>Đặt lại</span>
          </Button>
        </div>

        <!-- Row 2: Search, Department, User, Date Range -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 pt-2 border-t border-zinc-100 items-center">
          <!-- Keyword Search -->
          <div class="relative lg:col-span-3">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              <Search class="w-3.5 h-3.5" />
            </span>
            <Input
              v-model="searchQuery"
              placeholder="Tìm số ký hiệu, trích yếu, cán bộ..."
              class="pl-9 pr-3 h-9 rounded-full bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 text-xs font-medium w-full transition-all"
            />
          </div>

          <!-- Department Filter -->
          <div class="lg:col-span-3">
            <Select
              :model-value="filters.departmentId || '__all__'"
              :disabled="isDepartmentLocked"
              @update:model-value="(value) => { filters.departmentId = value === '__all__' ? '' : value; fetchReport() }"
            >
              <SelectTrigger class="h-9 w-full rounded-full border-zinc-200 bg-white text-xs font-semibold text-zinc-700">
                <SelectValue placeholder="Phòng ban" />
              </SelectTrigger>
              <SelectContent class="rounded-xl shadow-lg border-zinc-200">
                <SelectItem value="__all__">Tất cả phòng ban</SelectItem>
                <SelectItem v-for="dept in departments" :key="dept._id" :value="dept._id">
                  {{ dept.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Assignee Filter -->
          <div class="lg:col-span-2">
            <Select
              :model-value="filters.userId || '__all__'"
              @update:model-value="(value) => { filters.userId = value === '__all__' ? '' : value; fetchReport() }"
            >
              <SelectTrigger class="h-9 w-full rounded-full border-zinc-200 bg-white text-xs font-semibold text-zinc-700">
                <SelectValue placeholder="Người xử lý" />
              </SelectTrigger>
              <SelectContent class="rounded-xl shadow-lg border-zinc-200">
                <SelectItem value="__all__">Tất cả người xử lý</SelectItem>
                <SelectItem v-for="cand in filteredUsers" :key="cand._id" :value="cand._id">
                  {{ cand.fullName }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Date Range (From - To) -->
          <div class="lg:col-span-4 flex items-center gap-1.5">
            <!-- From Date Popover -->
            <Popover v-model:open="dateFromPickerOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  class="h-9 w-36 justify-between rounded-full border-zinc-200 bg-white px-3.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300"
                >
                  <span>{{ formatDateDisplay(filters.dateFrom, 'Từ ngày') }}</span>
                  <CalendarIcon class="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-auto p-0 rounded-2xl shadow-xl border-zinc-200">
                <Calendar v-model="dateFromCalendarDate" locale="vi-VN" :max-value="dateToCalendarDate" initial-focus />
              </PopoverContent>
            </Popover>

            <span class="text-xs font-bold text-zinc-400 shrink-0">→</span>

            <!-- To Date Popover -->
            <Popover v-model:open="dateToPickerOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  class="h-9 w-36 justify-between rounded-full border-zinc-200 bg-white px-3.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300"
                >
                  <span>{{ formatDateDisplay(filters.dateTo, 'Đến ngày') }}</span>
                  <CalendarIcon class="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="w-auto p-0 rounded-2xl shadow-xl border-zinc-200">
                <Calendar v-model="dateToCalendarDate" locale="vi-VN" :min-value="dateFromCalendarDate" initial-focus />
              </PopoverContent>
            </Popover>

            <Button
              v-if="filters.dateFrom || filters.dateTo"
              variant="ghost"
              size="sm"
              class="h-7 w-7 rounded-full p-0 text-zinc-400 hover:text-zinc-700 shrink-0"
              title="Xóa khoảng ngày"
              @click="filters.dateFrom = ''; filters.dateTo = ''; fetchReport()"
            >
              <X class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <!-- 3. REPORT DATA SECTION WITH TABS -->
      <Card class="rounded-2xl border border-zinc-200/70 bg-white shadow-sm overflow-hidden">
        <!-- View Switcher Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5 border-b border-zinc-100 bg-white">
          <SlidingTabs :tabs="VIEW_TABS" v-model="activeView" />
          <p class="text-xs font-medium text-zinc-400">
            Hiển thị:
            <strong class="text-zinc-700 font-bold">
              {{ activeView === 'items' ? `${filteredItems.length} văn bản` : activeView === 'department' ? `${filteredDepartmentSummary.length} phòng ban` : `${filteredUserSummary.length} cán bộ` }}
            </strong>
          </p>
        </div>

        <!-- Tab Body -->
        <div class="min-h-[400px]">
          <!-- Loading skeleton -->
          <div v-if="loading" class="space-y-3 p-6">
            <div v-for="index in 5" :key="index" class="h-11 animate-pulse rounded-xl bg-zinc-100" />
          </div>

          <!-- VIEW 1: ITEMS DETAIL -->
          <div v-else-if="activeView === 'items'" class="overflow-x-auto">
            <Table class="min-w-[960px]">
              <TableHeader class="bg-zinc-50/70 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                <TableRow class="border-b border-zinc-100 hover:bg-transparent">
                  <TableHead class="w-12 py-3 px-4 text-center font-bold text-zinc-500">STT</TableHead>
                  <TableHead class="py-3 px-4 font-bold text-zinc-500">Số ký hiệu & Trích yếu</TableHead>
                  <TableHead class="py-3 px-4 font-bold text-zinc-500 min-w-[200px]">Cán bộ & Phòng ban</TableHead>
                  <TableHead class="py-3 px-4 font-bold text-zinc-500 w-28">Hạn xử lý</TableHead>
                  <TableHead class="py-3 px-4 font-bold text-zinc-500 text-right w-36">Tình trạng hạn</TableHead>
                  <TableHead class="py-3 px-6 font-bold text-zinc-500 w-36">Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-zinc-100">
                <TableRow
                  v-for="(item, index) in filteredItems"
                  :key="item.id"
                  class="hover:bg-zinc-50/80 cursor-pointer transition-colors group"
                  @click="openDetail(item)"
                >
                  <TableCell class="py-3.5 px-4 text-center text-xs font-semibold text-zinc-400">
                    {{ index + 1 }}
                  </TableCell>
                  <TableCell class="py-3.5 px-4 max-w-[420px]">
                    <p class="font-bold text-xs text-zinc-900 group-hover:text-blue-600 transition-colors leading-tight flex items-center gap-1.5">
                      <span>{{ item.soKyHieu || '—' }}</span>
                      <ExternalLink class="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                    </p>
                    <p class="mt-1 line-clamp-2 text-xs font-medium text-zinc-500 leading-relaxed" :title="item.subject">
                      {{ item.subject || 'Không có trích yếu' }}
                    </p>
                  </TableCell>
                  <TableCell class="py-3.5 px-4">
                    <p class="font-bold text-xs text-zinc-800 leading-tight">
                      {{ item.assigneeName || 'Chưa phân công' }}
                    </p>
                    <p class="text-[11px] font-medium text-zinc-400 mt-0.5">
                      {{ item.departmentName || 'Chưa phân phòng' }}
                    </p>
                  </TableCell>
                  <TableCell class="py-3.5 px-4 whitespace-nowrap text-xs font-semibold text-zinc-700">
                    {{ formatDate(item.dueAt) }}
                  </TableCell>
                  <TableCell class="py-3.5 px-4 text-right whitespace-nowrap">
                    <span v-if="item.overdueDays > 0" class="text-xs font-bold" :class="overdueDaysColor(item.overdueDays)">
                      Quá {{ item.overdueDays }} ngày
                    </span>
                    <span v-else class="text-xs font-semibold text-zinc-400">—</span>
                  </TableCell>
                  <TableCell class="py-3.5 px-6 whitespace-nowrap text-xs font-medium text-zinc-600">
                    {{ statusLabel(item.deadlineStatus) }}
                  </TableCell>
                </TableRow>
                <TableRow v-if="!filteredItems.length">
                  <TableCell colspan="6" class="py-20 text-center text-zinc-400 text-xs font-medium">
                    Không có văn bản nào khớp với bộ lọc hiện tại.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <!-- VIEW 2: DEPARTMENT SUMMARY -->
          <div v-else-if="activeView === 'department'" class="overflow-x-auto">
            <Table class="min-w-[680px]">
              <TableHeader class="bg-zinc-50/70 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                <TableRow class="border-b border-zinc-100 hover:bg-transparent">
                  <TableHead class="py-3 px-6 font-bold text-zinc-500">Phòng ban</TableHead>
                  <TableHead class="py-3 px-4 text-right font-bold text-zinc-500 w-32">Tổng quá hạn</TableHead>
                  <TableHead class="py-3 px-4 text-right font-bold text-zinc-500 w-36">Đang quá hạn</TableHead>
                  <TableHead class="py-3 px-6 text-right font-bold text-zinc-500 w-36">Đã xử lý trễ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-zinc-100">
                <TableRow
                  v-for="row in filteredDepartmentSummary"
                  :key="row.departmentId || row.departmentName"
                  class="hover:bg-zinc-50/60 transition-colors"
                >
                  <TableCell class="py-3.5 px-6 font-bold text-xs text-zinc-900">
                    {{ row.departmentName }}
                  </TableCell>
                  <TableCell class="py-3.5 px-4 text-right text-xs font-bold text-zinc-800">
                    {{ row.total }}
                  </TableCell>
                  <TableCell class="py-3.5 px-4 text-right text-xs font-bold text-rose-600">
                    {{ row.pendingOverdue }}
                  </TableCell>
                  <TableCell class="py-3.5 px-6 text-right text-xs font-bold text-amber-600">
                    {{ row.doneLate }}
                  </TableCell>
                </TableRow>
                <TableRow v-if="!filteredDepartmentSummary.length">
                  <TableCell colspan="4" class="py-20 text-center text-zinc-400 text-xs font-medium">
                    Không có dữ liệu phòng ban nào phù hợp.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <!-- VIEW 3: USER SUMMARY -->
          <div v-else class="overflow-x-auto">
            <Table class="min-w-[760px]">
              <TableHeader class="bg-zinc-50/70 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                <TableRow class="border-b border-zinc-100 hover:bg-transparent">
                  <TableHead class="py-3 px-6 font-bold text-zinc-500">Cán bộ xử lý</TableHead>
                  <TableHead class="py-3 px-4 font-bold text-zinc-500">Phòng ban</TableHead>
                  <TableHead class="py-3 px-4 text-right font-bold text-zinc-500 w-28">Tổng quá hạn</TableHead>
                  <TableHead class="py-3 px-4 text-right font-bold text-zinc-500 w-32">Đang quá hạn</TableHead>
                  <TableHead class="py-3 px-6 text-right font-bold text-zinc-500 w-32">Đã xử lý trễ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-zinc-100">
                <TableRow
                  v-for="row in filteredUserSummary"
                  :key="row.userId || row.fullName"
                  class="hover:bg-zinc-50/60 transition-colors"
                >
                  <TableCell class="py-3.5 px-6 font-bold text-xs text-zinc-900">
                    {{ row.fullName }}
                  </TableCell>
                  <TableCell class="py-3.5 px-4 text-xs font-medium text-zinc-500">
                    {{ row.departmentName || 'Chưa phân phòng' }}
                  </TableCell>
                  <TableCell class="py-3.5 px-4 text-right text-xs font-bold text-zinc-800">
                    {{ row.total }}
                  </TableCell>
                  <TableCell class="py-3.5 px-4 text-right text-xs font-bold text-rose-600">
                    {{ row.pendingOverdue }}
                  </TableCell>
                  <TableCell class="py-3.5 px-6 text-right text-xs font-bold text-amber-600">
                    {{ row.doneLate }}
                  </TableCell>
                </TableRow>
                <TableRow v-if="!filteredUserSummary.length">
                  <TableCell colspan="5" class="py-20 text-center text-zinc-400 text-xs font-medium">
                    Không có dữ liệu cán bộ nào phù hợp.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </main>

    <!-- 4. DOCUMENT DETAIL DRAWER (Slide-over panel như trong office-documents) -->
    <OfficeDocumentDrawer
      v-model:open="drawerOpen"
      :document-id="selectedDocumentId"
      :initial-data="selectedItem"
    />
  </div>
</template>
