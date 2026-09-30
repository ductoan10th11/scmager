<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  Clock3,
  FileText,
  Download,
  Search,
  RotateCcw,
  Building2,
  User,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Clock,
  Layers,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import OfficeDocumentDrawer from '@/features/office-documents/components/OfficeDocumentDrawer.vue'
import SlidingTabs from '@/components/ui/sliding-tabs/SlidingTabs.vue'
import { http } from '@/shared/api/http'
import { useAuth } from '@/features/auth/composables/useAuth'
import { ReportService } from './services/report.service'

const { user } = useAuth()

const VIEW_TABS = [
  { id: 'items', label: 'Chi tiết văn bản' },
  { id: 'department', label: 'Theo phòng ban' },
  { id: 'leader', label: 'Theo Trưởng phòng' },
]

const isDepartmentLocked = computed(() => user.value?.role?.code === 'DEPARTMENT_LEADER')

const filters = reactive({
  departmentId: isDepartmentLocked.value ? (user.value?.department?._id ?? user.value?.department ?? '') : '',
  filterType: 'ALL_LATE',
  slaHours: 24,
  search: '',
})

const searchQuery = ref('')
let searchDebounceTimer = null

const onSearchInput = () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    filters.search = searchQuery.value
    fetchReport()
  }, 350)
}

// State xem chi tiết văn bản (Drawer)
const drawerOpen = ref(false)
const selectedDocumentId = ref('')
const selectedItem = ref(null)

const openDocumentDrawer = (item) => {
  selectedDocumentId.value = item.id
  selectedItem.value = item
  drawerOpen.value = true
}

const departments = ref([])
const loading = ref(false)
const downloading = ref(false)
const error = ref('')
const payload = ref({
  items: [],
  summary: { totalLate: 0, overdueCount: 0, avgHoldingHours: 0, affectedDepartmentsCount: 0 },
  departmentSummary: [],
  leaderSummary: [],
})
const meta = ref({ total: 0, generatedAt: null })
const activeView = ref('items')

const fetchDepartments = async () => {
  try {
    const res = await http('/api/departments?limit=100&isActive=true')
    departments.value = res?.data || []
  } catch {
    departments.value = []
  }
}

const fetchReport = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await ReportService.lateAssignments(filters)
    payload.value = res?.data || {
      items: [],
      summary: { totalLate: 0, overdueCount: 0, avgHoldingHours: 0, affectedDepartmentsCount: 0 },
      departmentSummary: [],
      leaderSummary: [],
    }
    meta.value = res?.meta || { total: 0, generatedAt: null }
  } catch (err) {
    error.value = err?.message || 'Không thể tải báo cáo giao việc muộn.'
  } finally {
    loading.value = false
  }
}

const handleExport = async () => {
  downloading.value = true
  try {
    const file = await ReportService.downloadLateAssignmentsReport(filters)
    const url = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    alert(err?.message || 'Lỗi khi xuất tệp Excel.')
  } finally {
    downloading.value = false
  }
}

const resetFilters = () => {
  filters.departmentId = isDepartmentLocked.value ? (user.value?.department?._id ?? user.value?.department ?? '') : ''
  filters.filterType = 'ALL_LATE'
  filters.slaHours = 24
  filters.search = ''
  searchQuery.value = ''
  fetchReport()
}

const formatDateTime = (val) => {
  if (!val) return '—'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return String(val)
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const formatHoldingTime = (hours, days) => {
  if (hours == null) return '—'
  if (hours >= 48) {
    return `${days} ngày (${hours}h)`
  }
  return `${hours} giờ`
}

onMounted(() => {
  fetchDepartments()
  fetchReport()
})

watch(
  () => filters.departmentId,
  () => fetchReport(),
)

watch(
  () => filters.filterType,
  () => fetchReport(),
)
</script>

<template>
  <div class="flex-1 h-full flex flex-col bg-slate-50/60 overflow-hidden relative">
    <!-- Header (Sticky Flush Top) -->
    <header class="shrink-0 px-6 py-4 md:py-5 border-b border-zinc-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-20">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
              <Clock3 class="h-5 w-5" />
            </div>
            <div>
              <div class="flex items-center gap-2.5">
                <h1 class="text-xl md:text-2xl font-black tracking-tight text-zinc-900 truncate">
                  Văn bản giao việc muộn
                </h1>
                <span
                  v-if="payload.summary.totalLate > 0"
                  class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200/60 shrink-0"
                >
                  {{ payload.summary.totalLate }} chậm giao
                </span>
              </div>
              <p class="text-xs font-medium text-zinc-500 mt-0.5 truncate">
                Theo dõi và phát hiện các văn bản bị Trưởng phòng chậm phân công cho chuyên viên
              </p>
            </div>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="rounded-xl border-slate-200 hover:bg-slate-100"
            :disabled="loading"
            @click="fetchReport"
          >
            <RotateCcw class="h-4 w-4 mr-1.5" :class="{ 'animate-spin': loading }" />
            Làm mới
          </Button>
          <Button
            variant="default"
            size="sm"
            class="rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            :disabled="downloading || payload.items.length === 0"
            @click="handleExport"
          >
            <Download class="h-4 w-4 mr-1.5" />
            {{ downloading ? 'Đang xuất...' : 'Xuất Excel' }}
          </Button>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
      <!-- KPI Metric Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total late -->
      <Card class="p-4 rounded-2xl border-slate-200/80 shadow-xs bg-white flex flex-col justify-between">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-slate-500">Tổng văn bản chậm giao</span>
          <div class="h-8 w-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle class="h-4 w-4" />
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-2xl font-bold text-slate-900">{{ payload.summary.totalLate }}</span>
          <span class="text-xs text-slate-500">văn bản</span>
        </div>
        <div class="mt-2 text-[11px] text-amber-600 font-medium flex items-center gap-1">
          Chưa giao cho chuyên viên
        </div>
      </Card>

      <!-- Overdue count -->
      <Card class="p-4 rounded-2xl border-slate-200/80 shadow-xs bg-white flex flex-col justify-between">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-slate-500">Đã quá hạn xử lý</span>
          <div class="h-8 w-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertCircle class="h-4 w-4" />
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-2xl font-bold text-rose-600">{{ payload.summary.overdueCount }}</span>
          <span class="text-xs text-slate-500">văn bản</span>
        </div>
        <div class="mt-2 text-[11px] text-rose-600 font-medium flex items-center gap-1">
          Chưa giao & đã trễ hạn
        </div>
      </Card>

      <!-- Avg hours -->
      <Card class="p-4 rounded-2xl border-slate-200/80 shadow-xs bg-white flex flex-col justify-between">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-slate-500">Thời gian ngâm trung bình</span>
          <div class="h-8 w-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Clock class="h-4 w-4" />
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-2xl font-bold text-slate-900">{{ payload.summary.avgHoldingHours }}</span>
          <span class="text-xs text-slate-500">giờ</span>
        </div>
        <div class="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
          ~ {{ (payload.summary.avgHoldingHours / 24).toFixed(1) }} ngày giữ việc
        </div>
      </Card>

      <!-- Affected departments -->
      <Card class="p-4 rounded-2xl border-slate-200/80 shadow-xs bg-white flex flex-col justify-between">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-slate-500">Phòng ban phát sinh</span>
          <div class="h-8 w-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Building2 class="h-4 w-4" />
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-2xl font-bold text-slate-900">{{ payload.summary.affectedDepartmentsCount }}</span>
          <span class="text-xs text-slate-500">phòng</span>
        </div>
        <div class="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
          Đang có văn bản nghẽn
        </div>
      </Card>
    </div>

    <!-- Filters & Search Toolbar -->
    <Card class="p-4 rounded-2xl border-slate-200/80 shadow-xs bg-white">
      <div class="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <!-- Search -->
          <div class="relative min-w-[240px] max-w-sm flex-1">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              v-model="searchQuery"
              placeholder="Tìm số ký hiệu, trích yếu, người phụ trách..."
              class="pl-9 rounded-xl border-slate-200 h-9 text-xs"
              @input="onSearchInput"
            />
          </div>

          <!-- Department Filter -->
          <div class="w-[200px]" v-if="!isDepartmentLocked">
            <Select
              :model-value="filters.departmentId || '__all__'"
              @update:model-value="(value) => { filters.departmentId = value === '__all__' ? '' : value; fetchReport() }"
            >
              <SelectTrigger class="rounded-xl border-slate-200 h-9 text-xs">
                <SelectValue placeholder="Tất cả phòng ban" />
              </SelectTrigger>
              <SelectContent class="rounded-xl">
                <SelectItem value="__all__">Tất cả phòng ban</SelectItem>
                <SelectItem
                  v-for="dept in departments"
                  :key="dept._id"
                  :value="dept._id"
                >
                  {{ dept.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- SLA Criteria Filter -->
          <div class="w-[210px]">
            <Select v-model="filters.filterType">
              <SelectTrigger class="rounded-xl border-slate-200 h-9 text-xs">
                <SelectValue placeholder="Mức độ chậm giao" />
              </SelectTrigger>
              <SelectContent class="rounded-xl">
                <SelectItem value="ALL_LATE">Tất cả chậm (>24h hoặc quá hạn)</SelectItem>
                <SelectItem value="SLA_24">Chậm trên 24 giờ</SelectItem>
                <SelectItem value="SLA_48">Chậm trên 48 giờ</SelectItem>
                <SelectItem value="OVERDUE">Chỉ văn bản đã quá hạn</SelectItem>
                <SelectItem value="ALL_PENDING">Toàn bộ chưa giao chuyên viên</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Reset button -->
          <Button
            variant="ghost"
            size="sm"
            class="rounded-xl text-slate-500 hover:text-slate-800 h-9 px-2 text-xs"
            @click="resetFilters"
          >
            <RotateCcw class="h-3.5 w-3.5 mr-1" />
            Xóa bộ lọc
          </Button>
        </div>

        <!-- View Tabs -->
        <div>
          <SlidingTabs
            v-model="activeView"
            :tabs="VIEW_TABS"
            class="w-full md:w-auto"
          />
        </div>
      </div>
    </Card>

    <!-- Error State -->
    <div
      v-if="error"
      class="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between"
    >
      <span>{{ error }}</span>
      <Button variant="ghost" size="sm" class="rounded-lg h-7 text-xs" @click="fetchReport">Thử lại</Button>
    </div>

    <!-- Main Content Area -->
    <div class="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      <!-- 1. TAB: Chi tiết văn bản chậm giao -->
      <div v-if="activeView === 'items'">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader class="bg-slate-50/75">
              <TableRow>
                <TableHead class="w-12 text-center text-xs font-semibold text-slate-600">STT</TableHead>
                <TableHead class="w-36 text-xs font-semibold text-slate-600">Số ký hiệu</TableHead>
                <TableHead class="min-w-[280px] text-xs font-semibold text-slate-600">Trích yếu nội dung</TableHead>
                <TableHead class="w-44 text-xs font-semibold text-slate-600">Phòng ban phụ trách</TableHead>
                <TableHead class="w-44 text-xs font-semibold text-slate-600">Trưởng phòng</TableHead>
                <TableHead class="w-32 text-xs font-semibold text-slate-600">Thời gian chậm</TableHead>
                <TableHead class="w-32 text-xs font-semibold text-slate-600">Hạn xử lý</TableHead>
                <TableHead class="w-20 text-center text-xs font-semibold text-slate-600">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading">
                <TableCell colspan="8" class="h-32 text-center text-slate-500 text-sm">
                  Đang tải danh sách văn bản giao việc muộn...
                </TableCell>
              </TableRow>
              <TableRow v-else-if="payload.items.length === 0">
                <TableCell colspan="8" class="h-32 text-center text-slate-400 text-sm">
                  Không có văn bản nào bị giao việc muộn trong tiêu chí đã chọn.
                </TableCell>
              </TableRow>
              <TableRow
                v-for="(item, index) in payload.items"
                v-else
                :key="item.id"
                class="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                @click="openDocumentDrawer(item)"
              >
                <!-- STT -->
                <TableCell class="text-center text-xs text-slate-500 font-mono">
                  {{ index + 1 }}
                </TableCell>

                <!-- Số ký hiệu -->
                <TableCell class="font-medium text-xs text-slate-900 font-mono">
                  {{ item.soKyHieu || item.externalDocumentId || '—' }}
                </TableCell>

                <!-- Trích yếu -->
                <TableCell>
                  <div class="text-xs text-slate-800 line-clamp-2 leading-relaxed">
                    {{ item.subject || 'Không có trích yếu' }}
                  </div>
                  <div class="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                    <span>{{ item.documentForm }}</span>
                    <span>•</span>
                    <span v-if="item.receivedAt">Nhận: {{ formatDateTime(item.receivedAt) }}</span>
                  </div>
                </TableCell>

                <!-- Phòng ban -->
                <TableCell class="text-xs text-slate-700">
                  <div class="flex items-center gap-1.5 font-medium">
                    <Building2 class="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span class="truncate">{{ item.departmentName }}</span>
                  </div>
                </TableCell>

                <!-- Trưởng phòng -->
                <TableCell class="text-xs text-slate-700">
                  <div class="flex items-center gap-1.5">
                    <User class="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span class="truncate font-medium">{{ item.leaderName }}</span>
                  </div>
                </TableCell>

                <!-- Thời gian chậm giao -->
                <TableCell>
                  <Badge
                    class="rounded-lg text-[11px] font-semibold border-0 py-0.5 px-2"
                    :class="item.holdingHours >= 48 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'"
                  >
                    Chậm {{ formatHoldingTime(item.holdingHours, item.holdingDays) }}
                  </Badge>
                </TableCell>

                <!-- Hạn xử lý -->
                <TableCell class="text-xs">
                  <div v-if="item.dueAt" class="flex flex-col">
                    <span :class="item.isOverdue ? 'text-rose-600 font-semibold' : 'text-slate-700'">
                      {{ formatDateTime(item.dueAt) }}
                    </span>
                    <span v-if="item.isOverdue" class="text-[10px] text-rose-500 font-medium">
                      Quá hạn xử lý
                    </span>
                  </div>
                  <span v-else class="text-slate-400 text-xs">Không có hạn</span>
                </TableCell>

                <!-- Thao tác -->
                <TableCell class="text-center" @click.stop>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                    title="Xem chi tiết"
                    @click="openDocumentDrawer(item)"
                  >
                    <ChevronRight class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <!-- 2. TAB: Theo phòng ban -->
      <div v-else-if="activeView === 'department'">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader class="bg-slate-50/75">
              <TableRow>
                <TableHead class="w-12 text-center text-xs font-semibold text-slate-600">STT</TableHead>
                <TableHead class="text-xs font-semibold text-slate-600">Phòng ban</TableHead>
                <TableHead class="text-xs font-semibold text-slate-600">Trưởng phòng</TableHead>
                <TableHead class="w-36 text-center text-xs font-semibold text-slate-600">Số lượng chậm giao</TableHead>
                <TableHead class="w-36 text-center text-xs font-semibold text-slate-600">Quá hạn chưa giao</TableHead>
                <TableHead class="w-40 text-center text-xs font-semibold text-slate-600">Thời gian ngâm TB</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading">
                <TableCell colspan="6" class="h-32 text-center text-slate-500 text-sm">
                  Đang tải thống kê theo phòng ban...
                </TableCell>
              </TableRow>
              <TableRow v-else-if="payload.departmentSummary.length === 0">
                <TableCell colspan="6" class="h-32 text-center text-slate-400 text-sm">
                  Không có phòng ban nào phát sinh chậm giao việc.
                </TableCell>
              </TableRow>
              <TableRow
                v-for="(dept, index) in payload.departmentSummary"
                v-else
                :key="dept.departmentId"
                class="hover:bg-slate-50/70 transition-colors"
              >
                <TableCell class="text-center text-xs text-slate-500 font-mono">{{ index + 1 }}</TableCell>
                <TableCell class="text-xs font-medium text-slate-900">
                  <div class="flex items-center gap-2">
                    <Building2 class="h-4 w-4 text-slate-400" />
                    <span>{{ dept.departmentName }}</span>
                  </div>
                </TableCell>
                <TableCell class="text-xs text-slate-700">
                  {{ dept.leaderName }}
                </TableCell>
                <TableCell class="text-center">
                  <Badge class="rounded-lg bg-amber-100 text-amber-800 border-0 font-bold px-2 py-0.5">
                    {{ dept.total }}
                  </Badge>
                </TableCell>
                <TableCell class="text-center">
                  <Badge
                    class="rounded-lg border-0 font-bold px-2 py-0.5"
                    :class="dept.overdueCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'"
                  >
                    {{ dept.overdueCount }}
                  </Badge>
                </TableCell>
                <TableCell class="text-center text-xs text-slate-700 font-mono">
                  {{ dept.avgHoldingHours }} giờ (~ {{ (dept.avgHoldingHours / 24).toFixed(1) }} ngày)
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <!-- 3. TAB: Theo Trưởng phòng -->
      <div v-else-if="activeView === 'leader'">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader class="bg-slate-50/75">
              <TableRow>
                <TableHead class="w-12 text-center text-xs font-semibold text-slate-600">STT</TableHead>
                <TableHead class="text-xs font-semibold text-slate-600">Trưởng phòng</TableHead>
                <TableHead class="text-xs font-semibold text-slate-600">Phòng ban</TableHead>
                <TableHead class="w-36 text-center text-xs font-semibold text-slate-600">Số lượng chậm giao</TableHead>
                <TableHead class="w-36 text-center text-xs font-semibold text-slate-600">Quá hạn chưa giao</TableHead>
                <TableHead class="w-40 text-center text-xs font-semibold text-slate-600">Thời gian ngâm TB</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading">
                <TableCell colspan="6" class="h-32 text-center text-slate-500 text-sm">
                  Đang tải thống kê theo Trưởng phòng...
                </TableCell>
              </TableRow>
              <TableRow v-else-if="payload.leaderSummary.length === 0">
                <TableCell colspan="6" class="h-32 text-center text-slate-400 text-sm">
                  Không có Trưởng phòng nào phát sinh chậm giao việc.
                </TableCell>
              </TableRow>
              <TableRow
                v-for="(leader, index) in payload.leaderSummary"
                v-else
                :key="leader.leaderName"
                class="hover:bg-slate-50/70 transition-colors"
              >
                <TableCell class="text-center text-xs text-slate-500 font-mono">{{ index + 1 }}</TableCell>
                <TableCell class="text-xs font-medium text-slate-900">
                  <div class="flex items-center gap-2">
                    <User class="h-4 w-4 text-slate-400" />
                    <span>{{ leader.leaderName }}</span>
                  </div>
                </TableCell>
                <TableCell class="text-xs text-slate-700">
                  {{ leader.departmentName }}
                </TableCell>
                <TableCell class="text-center">
                  <Badge class="rounded-lg bg-amber-100 text-amber-800 border-0 font-bold px-2 py-0.5">
                    {{ leader.total }}
                  </Badge>
                </TableCell>
                <TableCell class="text-center">
                  <Badge
                    class="rounded-lg border-0 font-bold px-2 py-0.5"
                    :class="leader.overdueCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'"
                  >
                    {{ leader.overdueCount }}
                  </Badge>
                </TableCell>
                <TableCell class="text-center text-xs text-slate-700 font-mono">
                  {{ leader.avgHoldingHours }} giờ (~ {{ (leader.avgHoldingHours / 24).toFixed(1) }} ngày)
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  </div>

  <!-- Office Document Slide-over Drawer -->
  <OfficeDocumentDrawer
    v-model:open="drawerOpen"
    :document-id="selectedDocumentId"
    :initial-data="selectedItem"
    @updated="fetchReport"
  />
</div>
</template>
