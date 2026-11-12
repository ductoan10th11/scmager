<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  RotateCcw,
  RefreshCw,
  Search,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card } from '@/components/ui/card'
import OfficeDocumentDrawer from '@/features/office-documents/components/OfficeDocumentDrawer.vue'
import SlidingTabs from '@/components/ui/sliding-tabs/SlidingTabs.vue'
import { http } from '@/shared/api/http'
import { useAuth } from '@/features/auth/composables/useAuth'
import { ReportService } from './services/report.service'

const { user } = useAuth()

const VIEW_TABS = [
  { id: 'items', label: 'Văn bản' },
  { id: 'department', label: 'Phòng ban' },
  { id: 'leader', label: 'Trưởng phòng' },
]

const FILTER_TYPES = [
  { value: 'ALL_LATE', label: 'Chậm >24h hoặc quá hạn' },
  { value: 'SLA_24', label: 'Chậm trên 24 giờ' },
  { value: 'SLA_48', label: 'Chậm trên 48 giờ' },
  { value: 'OVERDUE', label: 'Đã quá hạn xử lý' },
  { value: 'ALL_PENDING', label: 'Tất cả chưa giao' },
]

const EMPTY_PAYLOAD = () => ({
  items: [],
  summary: { totalLate: 0, overdueCount: 0, avgHoldingHours: 0, affectedDepartmentsCount: 0 },
  departmentSummary: [],
  leaderSummary: [],
})

const isDepartmentLocked = computed(() => user.value?.role?.code === 'DEPARTMENT_LEADER')
const lockedDepartmentId = () => (isDepartmentLocked.value ? (user.value?.department?._id ?? user.value?.department ?? '') : '')

const filters = reactive({
  departmentId: lockedDepartmentId(),
  filterType: 'ALL_LATE',
  slaHours: 24,
  search: '',
  // Theo thời gian đến: 'desc' = mới đến trước, 'asc' = đến lâu nhất trước.
  sortOrder: 'desc',
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
const payload = ref(EMPTY_PAYLOAD())
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
    payload.value = res?.data || EMPTY_PAYLOAD()
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

const toggleArrivalSort = () => {
  filters.sortOrder = filters.sortOrder === 'desc' ? 'asc' : 'desc'
  fetchReport()
}

const hasActiveFilters = computed(() =>
  Boolean(filters.search)
  || filters.filterType !== 'ALL_LATE'
  || filters.sortOrder !== 'desc'
  || (!isDepartmentLocked.value && Boolean(filters.departmentId)),
)

const resetFilters = () => {
  filters.departmentId = lockedDepartmentId()
  filters.filterType = 'ALL_LATE'
  filters.slaHours = 24
  filters.search = ''
  filters.sortOrder = 'desc'
  searchQuery.value = ''
  fetchReport()
}

const pad = (n) => String(n).padStart(2, '0')

const toDate = (val) => {
  if (!val) return null
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? null : d
}

const formatDate = (val) => {
  const d = toDate(val)
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '—'
}

const formatDateTime = (val) => {
  const d = toDate(val)
  return d ? `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—'
}

const formatHolding = (hours) => {
  if (hours == null) return '—'
  return hours >= 48 ? `${Math.floor(hours / 24)} ngày` : `${hours} giờ`
}

const holdingColor = (hours) => (hours >= 48 ? 'text-rose-600' : 'text-amber-600')

onMounted(() => {
  fetchDepartments()
  fetchReport()
})

watch(() => filters.departmentId, () => fetchReport())
watch(() => filters.filterType, () => fetchReport())
</script>

<template>
  <div class="flex-1 h-full flex flex-col bg-zinc-50/40 overflow-hidden relative">
    <!-- Header -->
    <header class="shrink-0 px-6 py-4 md:py-5 border-b border-zinc-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-20">
      <div class="mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
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
            Văn bản Trưởng phòng đang giữ, chưa phân công cho chuyên viên.
          </p>
        </div>

        <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <Button
            variant="ghost"
            size="icon"
            class="h-9 w-9 rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
            title="Làm mới"
            :disabled="loading"
            @click="fetchReport"
          >
            <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
          </Button>
          <Button
            class="h-9 px-4 rounded-full font-bold bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm transition-all flex items-center gap-2 text-xs"
            :disabled="downloading || !payload.items.length"
            @click="handleExport"
          >
            <Download class="w-3.5 h-3.5" :class="{ 'animate-pulse': downloading }" />
            <span>{{ downloading ? 'Đang xuất...' : 'Xuất Excel' }}</span>
          </Button>
        </div>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto px-4 py-5 sm:px-6 md:px-8 space-y-4 max-w-[1600px] mx-auto w-full">
      <!-- Error -->
      <div v-if="error" class="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs font-semibold text-rose-700 flex items-center gap-3">
        <AlertTriangle class="w-4 h-4 shrink-0 text-rose-600" />
        <span class="flex-1">{{ error }}</span>
        <Button variant="ghost" size="sm" class="h-7 rounded-full text-xs" @click="fetchReport">Thử lại</Button>
      </div>

      <Card class="rounded-2xl border border-zinc-200/70 bg-white shadow-sm overflow-hidden">
        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-100">
          <div class="relative w-full sm:w-64">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <Input
              v-model="searchQuery"
              placeholder="Tìm số ký hiệu, trích yếu..."
              class="pl-9 pr-3 h-9 rounded-full bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 text-xs font-medium w-full"
              @input="onSearchInput"
            />
          </div>

          <Select
            v-if="!isDepartmentLocked"
            :model-value="filters.departmentId || '__all__'"
            @update:model-value="(value) => { filters.departmentId = value === '__all__' ? '' : value }"
          >
            <SelectTrigger class="h-9 w-48 rounded-full border-zinc-200 bg-white text-xs font-semibold text-zinc-700">
              <SelectValue placeholder="Phòng ban" />
            </SelectTrigger>
            <SelectContent class="rounded-xl shadow-lg border-zinc-200">
              <SelectItem value="__all__">Tất cả phòng ban</SelectItem>
              <SelectItem v-for="dept in departments" :key="dept._id" :value="dept._id">
                {{ dept.name }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Select v-model="filters.filterType">
            <SelectTrigger class="h-9 w-52 rounded-full border-zinc-200 bg-white text-xs font-semibold text-zinc-700">
              <SelectValue placeholder="Mức độ chậm" />
            </SelectTrigger>
            <SelectContent class="rounded-xl shadow-lg border-zinc-200">
              <SelectItem v-for="option in FILTER_TYPES" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Button
            v-if="hasActiveFilters"
            variant="ghost"
            size="sm"
            class="h-8 px-2.5 rounded-full text-xs font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 flex items-center gap-1.5"
            @click="resetFilters"
          >
            <RotateCcw class="w-3 h-3" />
            <span>Đặt lại</span>
          </Button>
        </div>

        <!-- View switch + summary -->
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 border-b border-zinc-100">
          <SlidingTabs v-model="activeView" :tabs="VIEW_TABS" />
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-zinc-500">
            <span>Quá hạn xử lý: <strong class="font-bold text-rose-600">{{ payload.summary.overdueCount }}</strong></span>
            <span>Giữ trung bình: <strong class="font-bold text-zinc-800">{{ formatHolding(payload.summary.avgHoldingHours) }}</strong></span>
            <span>Phòng ban: <strong class="font-bold text-zinc-800">{{ payload.summary.affectedDepartmentsCount }}</strong></span>
          </div>
        </div>

        <div class="min-h-[320px]">
          <!-- Loading skeleton -->
          <div v-if="loading" class="space-y-2.5 p-4">
            <div v-for="index in 6" :key="index" class="h-10 animate-pulse rounded-xl bg-zinc-100" />
          </div>

          <!-- VIEW 1: documents -->
          <div v-else-if="activeView === 'items'" class="overflow-x-auto">
            <Table class="min-w-[720px]">
              <TableHeader class="bg-zinc-50/70 text-[10px] uppercase tracking-wider">
                <TableRow class="border-b border-zinc-100 hover:bg-transparent">
                  <TableHead class="w-10 py-2.5 px-3 text-center font-bold text-zinc-500">#</TableHead>
                  <TableHead class="py-2.5 px-3 font-bold text-zinc-500">Số ký hiệu & Trích yếu</TableHead>
                  <TableHead class="w-52 py-2.5 px-3 font-bold text-zinc-500">Trưởng phòng</TableHead>
                  <TableHead
                    class="w-36 py-2.5 px-3 font-bold text-zinc-500 cursor-pointer select-none hover:text-zinc-900"
                    :title="filters.sortOrder === 'desc' ? 'Đang xếp: mới đến trước' : 'Đang xếp: đến lâu nhất trước'"
                    @click="toggleArrivalSort"
                  >
                    <div class="flex items-center gap-1">
                      <span>Thời gian đến</span>
                      <ArrowDown v-if="filters.sortOrder === 'desc'" class="h-3 w-3 text-blue-600" />
                      <ArrowUp v-else class="h-3 w-3 text-blue-600" />
                    </div>
                  </TableHead>
                  <TableHead class="w-28 py-2.5 px-3 font-bold text-zinc-500">Hạn xử lý</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-zinc-100">
                <TableRow
                  v-for="(item, index) in payload.items"
                  :key="item.id"
                  class="hover:bg-zinc-50/80 cursor-pointer transition-colors group"
                  @click="openDocumentDrawer(item)"
                >
                  <TableCell class="py-2.5 px-3 text-center text-[11px] font-semibold text-zinc-400 tabular-nums">
                    {{ index + 1 }}
                  </TableCell>
                  <TableCell class="py-2.5 px-3 max-w-[520px]">
                    <p class="font-bold text-xs text-zinc-900 group-hover:text-blue-600 transition-colors leading-tight flex items-center gap-1.5">
                      <span class="truncate">{{ item.soKyHieu || item.externalDocumentId || '—' }}</span>
                      <ExternalLink class="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                    </p>
                    <p class="mt-0.5 line-clamp-2 text-xs text-zinc-500 leading-snug" :title="item.subject">
                      {{ item.subject || 'Không có trích yếu' }}
                    </p>
                  </TableCell>
                  <TableCell class="py-2.5 px-3 max-w-[208px]">
                    <p class="font-semibold text-xs text-zinc-800 leading-tight truncate">{{ item.leaderName }}</p>
                    <p class="mt-0.5 text-[11px] text-zinc-400 truncate" :title="item.departmentName">{{ item.departmentName }}</p>
                  </TableCell>
                  <TableCell class="py-2.5 px-3 whitespace-nowrap">
                    <p class="text-xs font-medium text-zinc-700 tabular-nums">{{ formatDateTime(item.receivedAt) }}</p>
                    <p class="mt-0.5 text-[11px] font-semibold" :class="holdingColor(item.holdingHours)">
                      Đã giữ {{ formatHolding(item.holdingHours) }}
                    </p>
                  </TableCell>
                  <TableCell class="py-2.5 px-3 whitespace-nowrap">
                    <template v-if="item.dueAt">
                      <p class="text-xs font-medium tabular-nums" :class="item.isOverdue ? 'text-rose-600' : 'text-zinc-700'">
                        {{ formatDate(item.dueAt) }}
                      </p>
                      <p v-if="item.isOverdue" class="mt-0.5 text-[11px] font-semibold text-rose-500">Quá hạn</p>
                    </template>
                    <span v-else class="text-[11px] text-zinc-400">Không có hạn</span>
                  </TableCell>
                </TableRow>
                <TableRow v-if="!payload.items.length">
                  <TableCell colspan="5" class="py-16 text-center text-zinc-400 text-xs font-medium">
                    Không có văn bản nào giao việc muộn theo tiêu chí đã chọn.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <!-- VIEW 2: by department / VIEW 3: by leader -->
          <div v-else class="overflow-x-auto">
            <Table class="min-w-[520px]">
              <TableHeader class="bg-zinc-50/70 text-[10px] uppercase tracking-wider">
                <TableRow class="border-b border-zinc-100 hover:bg-transparent">
                  <TableHead class="w-10 py-2.5 px-3 text-center font-bold text-zinc-500">#</TableHead>
                  <TableHead class="py-2.5 px-3 font-bold text-zinc-500">
                    {{ activeView === 'department' ? 'Phòng ban' : 'Trưởng phòng' }}
                  </TableHead>
                  <TableHead class="w-24 py-2.5 px-3 text-right font-bold text-zinc-500">Chậm giao</TableHead>
                  <TableHead class="w-24 py-2.5 px-3 text-right font-bold text-zinc-500">Quá hạn</TableHead>
                  <TableHead class="w-28 py-2.5 px-3 text-right font-bold text-zinc-500">Giữ TB</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-zinc-100">
                <TableRow
                  v-for="(row, index) in (activeView === 'department' ? payload.departmentSummary : payload.leaderSummary)"
                  :key="activeView === 'department' ? (row.departmentId || row.departmentName) : (row.leaderUserId || row.leaderName)"
                  class="hover:bg-zinc-50/60 transition-colors"
                >
                  <TableCell class="py-2.5 px-3 text-center text-[11px] font-semibold text-zinc-400 tabular-nums">{{ index + 1 }}</TableCell>
                  <TableCell class="py-2.5 px-3">
                    <p class="font-semibold text-xs text-zinc-900 leading-tight">
                      {{ activeView === 'department' ? row.departmentName : row.leaderName }}
                    </p>
                    <p class="mt-0.5 text-[11px] text-zinc-400">
                      {{ activeView === 'department' ? row.leaderName : row.departmentName }}
                    </p>
                  </TableCell>
                  <TableCell class="py-2.5 px-3 text-right text-xs font-bold text-zinc-800 tabular-nums">{{ row.total }}</TableCell>
                  <TableCell class="py-2.5 px-3 text-right text-xs font-bold tabular-nums" :class="row.overdueCount > 0 ? 'text-rose-600' : 'text-zinc-400'">
                    {{ row.overdueCount }}
                  </TableCell>
                  <TableCell class="py-2.5 px-3 text-right text-xs font-medium text-zinc-700 tabular-nums">{{ formatHolding(row.avgHoldingHours) }}</TableCell>
                </TableRow>
                <TableRow v-if="!(activeView === 'department' ? payload.departmentSummary : payload.leaderSummary).length">
                  <TableCell colspan="5" class="py-16 text-center text-zinc-400 text-xs font-medium">
                    Không có dữ liệu theo tiêu chí đã chọn.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </main>

    <OfficeDocumentDrawer
      v-model:open="drawerOpen"
      :document-id="selectedDocumentId"
      :initial-data="selectedItem"
      @updated="fetchReport"
    />
  </div>
</template>
