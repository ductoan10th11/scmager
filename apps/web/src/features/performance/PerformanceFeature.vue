<script setup>
import { computed, onMounted, ref } from 'vue'
import { CalendarDays, BarChart3, CheckCircle2, Clock3, Download, FileText, RefreshCw, TriangleAlert, Users, X } from 'lucide-vue-next'
import { CalendarDate } from '@internationalized/date'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PerformanceService } from './services/performance.service'
import { useAuth } from '@/features/auth/composables/useAuth'

const { user } = useAuth()
const loading = ref(false)
const error = ref(null)
const payload = ref(null)
const documentTab = ref('all')
const assigneeSort = ref('specialists-with-data')
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
const period = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
  .formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => part.value).join('-'))

const summary = computed(() => payload.value?.summary ?? {})
const assignees = computed(() => payload.value?.assignees ?? [])
const sortedAssignees = computed(() => [...assignees.value].sort((left, right) => {
  const byName = () => left.user.fullName.localeCompare(right.user.fullName, 'vi')
  if (assigneeSort.value === 'point') return right.projectedPoint - left.projectedPoint || byName()
  if (assigneeSort.value === 'documents') return right.documentCount - left.documentCount || right.projectedPoint - left.projectedPoint || byName()
  if (assigneeSort.value === 'active') return right.inProgressDocumentCount - left.inProgressDocumentCount || right.pendingPoint - left.pendingPoint || byName()
  if (assigneeSort.value === 'overdue') return right.overdueDocumentCount - left.overdueDocumentCount || right.inProgressDocumentCount - left.inProgressDocumentCount || byName()

  const priority = (row) => row.user.role?.code === 'SPECIALIST' && row.documentCount > 0
    ? 0
    : row.documentCount > 0
      ? 1
      : 2
  return priority(left) - priority(right)
    || right.projectedPoint - left.projectedPoint
    || right.inProgressDocumentCount - left.inProgressDocumentCount
    || byName()
}))
const documents = computed(() => payload.value?.documents ?? [])
const assigneeDocuments = computed(() => selectedAssignee.value
  ? documents.value.filter((document) => document.owner?.id === selectedAssignee.value.user.id)
  : [])
const detailLogs = computed(() => selectedDocument.value?.trackLogs ?? [])
const documentTabs = computed(() => [
  { value: 'all', documents: documents.value },
  { value: 'active', documents: documents.value.filter((document) => document.status !== 'COMPLETED') },
  { value: 'completed', documents: documents.value.filter((document) => document.status === 'COMPLETED') },
])
const canSeeAssignees = computed(() => user.value?.role?.code !== 'SPECIALIST')
const formatNumber = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value ?? 0))
const formatDate = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—'
const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}
const statusLabel = (status) => ({ COMPLETED: 'Đã xử lý', OVERDUE: 'Quá hạn', IN_PROGRESS: 'Đang xử lý' }[status] || 'Chưa xác định')
const statusClass = (status) => ({
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  OVERDUE: 'border-rose-200 bg-rose-50 text-rose-700',
  IN_PROGRESS: 'border-amber-200 bg-amber-50 text-amber-700',
}[status] || 'border-zinc-200 bg-zinc-50 text-zinc-600')

const metricCards = computed(() => [
  { label: 'Tổng nhiệm vụ', value: summary.value.totalDocuments, note: `Trong kỳ ${payload.value?.period || period.value}`, icon: FileText, tone: 'bg-blue-50 text-blue-700' },
  { label: 'Đã xử lý', value: summary.value.completedDocuments, note: 'Đã có phúc đáp văn thư', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700' },
  { label: 'Đang xử lý', value: summary.value.inProgressDocuments, note: 'Chưa hoàn thành', icon: Clock3, tone: 'bg-amber-50 text-amber-700' },
  { label: 'Quá hạn', value: summary.value.overdueDocuments, note: 'Chưa hoàn thành đúng hạn', icon: TriangleAlert, tone: 'bg-rose-50 text-rose-700' },
  { label: 'KPI đã chốt', value: summary.value.totalPoint, note: 'Từ văn bản đã hoàn thành', icon: BarChart3, tone: 'bg-violet-50 text-violet-700' },
  { label: 'Điểm đang giao', value: summary.value.pendingPoint, note: 'Điểm của văn bản chưa xong', icon: Users, tone: 'bg-cyan-50 text-cyan-700' },
])

const openDocument = (document) => {
  selectedAssignee.value = null
  selectedDocument.value = document
  // The overview response already contains the canonical extension track log.
  // Do not ask the legacy ingest endpoint for a context id.
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

const fetchData = async () => {
  loading.value = true
  error.value = null
  try {
    payload.value = (await PerformanceService.overview(period.value)).data
  } catch (requestError) {
    error.value = requestError.message || 'Không tải được dữ liệu KPI.'
  } finally {
    loading.value = false
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


onMounted(fetchData)
</script>

<template>
  <section class="h-full overflow-auto bg-zinc-50/60">
    <header class="border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
      <div class="mx-auto flex max-w-[1560px] items-center justify-between gap-4">
        <div class="min-w-0">
          <h1 class="flex items-center gap-2 truncate text-xl font-bold text-zinc-900"><BarChart3 class="h-5 w-5 text-blue-600" />Hiệu suất</h1>
          <p class="mt-1 truncate text-sm text-zinc-500">Đối chiếu trực tiếp từ văn bản đến, điểm tracklog và hạn xử lý.</p>
        </div>
        <div class="flex items-center gap-2">
          <Input v-model="period" type="month" class="h-9 w-[150px] rounded-md border-zinc-200 bg-white px-3 text-sm font-medium" @change="fetchData" />
          <Button variant="outline" size="icon" class="h-9 w-9 rounded-full" title="Làm mới" :disabled="loading" @click="fetchData"><RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" /></Button>
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1560px] space-y-5 px-4 py-5 sm:px-6">
      <div v-if="error" class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{{ error }}</div>
      <div v-if="loading && !payload" class="flex items-center justify-center py-24 text-sm text-zinc-400"><RefreshCw class="mr-2 h-5 w-5 animate-spin" />Đang tải văn bản và KPI...</div>

      <template v-else>
        <section class="grid grid-cols-2 gap-3 xl:grid-cols-6">
          <article v-for="metric in metricCards" :key="metric.label" class="min-w-0 rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <div class="flex items-start justify-between gap-3"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" :class="metric.tone"><component :is="metric.icon" class="h-5 w-5" /></span><strong class="text-2xl font-bold leading-none text-zinc-950">{{ formatNumber(metric.value) }}</strong></div>
            <p class="mt-3 truncate text-sm font-bold text-zinc-800">{{ metric.label }}</p><p class="mt-1 truncate text-xs font-medium text-zinc-500">{{ metric.note }}</p>
          </article>
        </section>

        <section class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3"><div><h2 class="text-sm font-bold text-zinc-900">{{ canSeeAssignees ? 'KPI theo nhân sự' : 'KPI của tôi' }}</h2><p class="mt-0.5 text-xs text-zinc-500">Tổng hợp trực tiếp từ các văn bản trong kỳ.</p></div><div class="flex items-center gap-2"><label class="text-xs font-semibold text-zinc-500">Sắp xếp</label><Select v-model="assigneeSort"><SelectTrigger class="h-8 w-[190px] border-zinc-200 bg-white text-xs font-semibold text-zinc-700"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="specialists-with-data">Chuyên viên có dữ liệu</SelectItem><SelectItem value="point">KPI dự kiến cao</SelectItem><SelectItem value="documents">Nhiều văn bản</SelectItem><SelectItem value="active">Đang xử lý nhiều</SelectItem><SelectItem value="overdue">Quá hạn nhiều</SelectItem></SelectContent></Select></div></div>
          <Table class="min-w-[760px]">
            <TableHeader class="bg-zinc-50 text-xs font-semibold text-zinc-500"><TableRow><TableHead>Nhân sự</TableHead><TableHead class="text-right">Văn bản</TableHead><TableHead class="text-right">Hoàn thành</TableHead><TableHead class="text-right">Đang xử lý</TableHead><TableHead class="text-right">KPI tháng</TableHead><TableHead class="text-center">Tải</TableHead></TableRow></TableHeader>
            <TableBody class="divide-y divide-zinc-100"><TableRow v-for="row in sortedAssignees" :key="row.user.id" tabindex="0" role="button" class="cursor-pointer hover:bg-zinc-50/70 focus:bg-blue-50 focus:outline-none" @click="openAssignee(row)" @keydown.enter="openAssignee(row)" @keydown.space.prevent="openAssignee(row)"><TableCell><p class="font-bold text-zinc-900">{{ row.user.fullName }}</p><p class="mt-0.5 truncate text-xs text-zinc-500">{{ row.user.position || row.user.role?.name || row.user.username }} · {{ row.user.department?.name || 'Chưa phân phòng ban' }}</p></TableCell><TableCell class="text-right font-semibold text-zinc-700">{{ formatNumber(row.documentCount) }}</TableCell><TableCell class="text-right font-semibold text-emerald-700">{{ formatNumber(row.completedDocumentCount) }}</TableCell><TableCell class="text-right font-semibold text-amber-700">{{ formatNumber(row.inProgressDocumentCount) }}</TableCell><TableCell class="text-right font-bold text-zinc-900">{{ formatNumber(row.monthlyKpi) }}</TableCell><TableCell class="text-center"><Button variant="ghost" size="icon" class="h-8 w-8 rounded-full" :title="`Tải bảng KPI của ${row.user.fullName}`" :disabled="downloadingUserId === row.user.id" @click.stop="openExportDialog(row)"><Download class="h-4 w-4" /></Button></TableCell></TableRow><TableRow v-if="!sortedAssignees.length"><TableCell colspan="6" class="py-12 text-center text-zinc-400">Chưa có nhân sự trong phạm vi xem.</TableCell></TableRow></TableBody>
          </Table>
        </section>

        <section class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <Tabs v-model="documentTab">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3"><div><h2 class="text-sm font-bold text-zinc-900">Nhiệm vụ trong kỳ</h2><p class="mt-0.5 text-xs text-zinc-500">Nhiệm vụ và công việc ngoài hệ thống được tính theo hạn xử lý.</p><p v-if="summary.unmappedDocuments" class="mt-1 text-xs font-semibold text-amber-700">{{ formatNumber(summary.unmappedDocuments) }} nhiệm vụ chưa map được sang tài khoản nội bộ, vẫn hiển thị đầy đủ bên dưới.</p></div><TabsList aria-label="Lọc nhiệm vụ trong kỳ"><TabsTrigger value="all" class="text-xs font-bold">Tất cả</TabsTrigger><TabsTrigger value="active" class="text-xs font-bold">Đang xử lý</TabsTrigger><TabsTrigger value="completed" class="text-xs font-bold">Đã xử lý</TabsTrigger></TabsList></div>
            <TabsContent v-for="tab in documentTabs" :key="tab.value" :value="tab.value" class="m-0 overflow-x-auto"><table class="w-full min-w-[1180px] text-sm"><thead class="bg-zinc-50 text-left text-xs font-semibold text-zinc-500"><tr><th class="px-4 py-3">Văn bản</th><th class="px-4 py-3">Người xử lý</th><th class="px-4 py-3">Trạng thái</th><th class="px-4 py-3 text-right">Điểm</th><th class="px-4 py-3">Hạn xử lý</th><th class="px-4 py-3">Nộp kết quả</th></tr></thead><tbody class="divide-y divide-zinc-100"><tr v-for="document in tab.documents" :key="document.id" tabindex="0" role="button" class="cursor-pointer hover:bg-zinc-50/70 focus:bg-blue-50 focus:outline-none" @click="openDocument(document)" @keydown.enter="openDocument(document)" @keydown.space.prevent="openDocument(document)"><td class="max-w-[430px] px-4 py-3"><div class="flex items-center gap-2"><span v-if="document.soDen" class="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-bold text-white">SĐ {{ document.soDen }}</span><span class="truncate font-bold text-zinc-900">{{ document.soKyHieu || document.documentId }}</span></div><p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">{{ document.trichYeu || 'Không có trích yếu.' }}</p></td><td class="px-4 py-3"><p class="font-semibold text-zinc-800">{{ document.owner?.fullName || 'Chưa map được người xử lý' }}</p><p class="mt-0.5 text-xs text-zinc-500">{{ document.owner?.position || document.owner?.username || '—' }}</p></td><td class="px-4 py-3"><span class="inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-bold" :class="statusClass(document.status)">{{ statusLabel(document.status) }}</span></td><td class="px-4 py-3 text-right"><p class="font-bold text-blue-700">{{ formatNumber(document.completed ? document.creditedPoint : document.point) }}</p><p v-if="document.completed && document.point !== document.creditedPoint" class="mt-0.5 text-xs text-rose-600">gốc {{ formatNumber(document.point) }}</p></td><td class="px-4 py-3"><p class="font-semibold text-zinc-800">{{ formatDate(document.deadline) }}</p><p v-if="document.lateWorkingDays" class="mt-0.5 text-xs font-medium text-rose-600">Trễ {{ document.lateWorkingDays }} ngày làm việc</p></td><td class="px-4 py-3 text-xs text-zinc-600"><p>{{ formatDateTime(document.submittedAt) }}</p><p v-if="document.completedAt" class="mt-1 text-zinc-400">Hoàn tất: {{ formatDateTime(document.completedAt) }}</p></td></tr><tr v-if="!tab.documents.length"><td colspan="6" class="px-4 py-12 text-center text-zinc-400">Không có văn bản phù hợp trong kỳ này.</td></tr></tbody></table></TabsContent>
          </Tabs>
        </section>
      </template>
    </main>

    <Dialog v-model:open="exportDialogOpen">
      <DialogContent class="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Tải bảng KPI</DialogTitle>
          <DialogDescription>{{ exportAssignee?.user.fullName }} · Chỉ lấy văn bản có hạn xử lý trong khoảng đã chọn.</DialogDescription>
        </DialogHeader>
        <div class="grid gap-4 py-2 sm:grid-cols-2">
          <div class="grid gap-2 text-sm font-semibold text-zinc-700"><span>Từ ngày</span><Popover v-model:open="exportStartPickerOpen"><PopoverTrigger as-child><Button variant="outline" class="h-10 justify-between rounded-md border-zinc-200 px-3 font-medium text-zinc-800"><span>{{ formatExportDate(exportRange.startDate) }}</span><CalendarDays class="h-4 w-4 text-zinc-500" /></Button></PopoverTrigger><PopoverContent align="start" class="w-auto p-0"><Calendar v-model="exportStartCalendarDate" locale="vi-VN" :max-value="exportEndCalendarDate" initial-focus /></PopoverContent></Popover></div>
          <div class="grid gap-2 text-sm font-semibold text-zinc-700"><span>Đến ngày</span><Popover v-model:open="exportEndPickerOpen"><PopoverTrigger as-child><Button variant="outline" class="h-10 justify-between rounded-md border-zinc-200 px-3 font-medium text-zinc-800"><span>{{ formatExportDate(exportRange.endDate) }}</span><CalendarDays class="h-4 w-4 text-zinc-500" /></Button></PopoverTrigger><PopoverContent align="end" class="w-auto p-0"><Calendar v-model="exportEndCalendarDate" locale="vi-VN" :min-value="exportStartCalendarDate" initial-focus /></PopoverContent></Popover></div>
        </div>
        <p v-if="exportRangeError" class="text-sm font-medium text-rose-600">{{ exportRangeError }}</p>
        <DialogFooter class="gap-2 sm:gap-2">
          <Button variant="outline" :disabled="Boolean(downloadingUserId)" @click="exportDialogOpen = false">Hủy</Button>
          <Button :disabled="Boolean(downloadingUserId)" @click="downloadKpi"><Download class="h-4 w-4" :class="{ 'animate-pulse': Boolean(downloadingUserId) }" />{{ downloadingUserId ? 'Đang tạo' : 'Tải file Excel' }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>


    <Teleport to="body">
      <Transition name="performance-drawer">
        <div v-if="selectedDocument || selectedAssignee" class="fixed inset-0 z-[80]">
          <button class="absolute inset-0 h-full w-full cursor-default bg-zinc-950/20 backdrop-blur-[1px]" type="button" aria-label="Đóng chi tiết" @click="closeDetail" />
          <aside class="absolute right-0 top-0 flex h-full w-full max-w-[580px] flex-col border-l border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20">
            <div class="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
              <div class="min-w-0"><h2 class="text-sm font-bold text-zinc-900">{{ selectedDocument ? 'Chi tiết văn bản' : 'Chi tiết hiệu suất' }}</h2><p class="mt-0.5 truncate text-xs text-zinc-500">{{ selectedDocument?.documentId || selectedAssignee?.user.fullName }}</p></div>
              <div class="flex items-center gap-2"><RefreshCw v-if="detailLoading" class="h-4 w-4 animate-spin text-zinc-400" /><Button variant="ghost" size="icon" class="h-8 w-8 rounded-full" title="Đóng" @click="closeDetail"><X class="h-4 w-4" /></Button></div>
            </div>

            <div v-if="selectedAssignee" class="min-h-0 flex-1 overflow-auto p-5">
              <section class="border-b border-zinc-100 pb-4"><h3 class="text-lg font-bold text-zinc-900">{{ selectedAssignee.user.fullName }}</h3><p class="mt-1 text-sm text-zinc-500">{{ selectedAssignee.user.position || selectedAssignee.user.role?.name || selectedAssignee.user.username }} · {{ selectedAssignee.user.department?.name || 'Chưa phân phòng ban' }}</p><dl class="mt-4 grid grid-cols-2 gap-3"><div class="rounded-md bg-blue-50 p-3"><dt class="text-xs font-semibold text-blue-600">KPI đã chốt</dt><dd class="mt-1 text-xl font-bold text-blue-800">{{ formatNumber(selectedAssignee.totalPoint) }}</dd></div><div class="rounded-md bg-amber-50 p-3"><dt class="text-xs font-semibold text-amber-600">Điểm đang giao</dt><dd class="mt-1 text-xl font-bold text-amber-800">{{ formatNumber(selectedAssignee.pendingPoint) }}</dd></div><div class="rounded-md bg-zinc-50 p-3"><dt class="text-xs font-semibold text-zinc-500">Văn bản / quá hạn</dt><dd class="mt-1 text-xl font-bold text-zinc-800">{{ selectedAssignee.documentCount }} / {{ selectedAssignee.overdueDocumentCount }}</dd></div><div class="rounded-md bg-rose-50 p-3"><dt class="text-xs font-semibold text-rose-600">Ngày trễ</dt><dd class="mt-1 text-xl font-bold text-rose-800">{{ selectedAssignee.lateWorkingDays }}</dd></div></dl></section>
              <section class="py-4"><div class="flex items-baseline justify-between gap-3"><h3 class="text-xs font-bold uppercase text-zinc-400">Nhiệm vụ trong kỳ</h3><span class="text-xs font-semibold text-zinc-500">{{ assigneeDocuments.length }} văn bản</span></div><Table class="mt-3 min-w-[600px] rounded-md border border-zinc-200"><TableHeader class="bg-zinc-50 text-[11px] font-bold text-zinc-500"><TableRow><TableHead>Nội dung nhiệm vụ</TableHead><TableHead class="text-right">Điểm</TableHead><TableHead class="text-right">Hoàn thành</TableHead><TableHead class="text-right">Ngày chậm</TableHead><TableHead class="text-right">Làm lại</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="document in assigneeDocuments" :key="document.id" tabindex="0" role="button" class="cursor-pointer hover:bg-blue-50/40 focus:bg-blue-50 focus:outline-none" @click="openDocument(document)" @keydown.enter="openDocument(document)"><TableCell class="max-w-[260px]"><p class="truncate font-bold text-zinc-900">{{ document.soKyHieu || document.documentId }}</p><p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{{ document.trichYeu || 'Không có trích yếu.' }}</p></TableCell><TableCell class="text-right font-bold text-blue-700">{{ formatNumber(document.point) }}</TableCell><TableCell class="text-right font-semibold" :class="document.completed ? 'text-emerald-700' : 'text-zinc-400'">{{ document.completed ? 1 : 0 }}</TableCell><TableCell class="text-right font-semibold" :class="document.lateWorkingDays ? 'text-rose-600' : 'text-zinc-400'">{{ formatNumber(document.lateWorkingDays) }}</TableCell><TableCell class="text-right font-semibold" :class="document.reworkCount ? 'text-amber-700' : 'text-zinc-400'">{{ formatNumber(document.reworkCount) }}</TableCell></TableRow><TableRow v-if="!assigneeDocuments.length"><TableCell colspan="5" class="py-10 text-center text-sm text-zinc-400">Chưa có văn bản map cho nhân sự này trong kỳ.</TableCell></TableRow></TableBody></Table></section>
            </div>

            <div v-else-if="selectedDocument" class="min-h-0 flex-1 overflow-auto p-5">
              <section class="border-b border-zinc-100 pb-4"><div class="flex flex-wrap items-center gap-2"><span v-if="selectedDocument.soDen" class="rounded bg-zinc-900 px-2 py-1 text-xs font-bold text-white">SĐ {{ selectedDocument.soDen }}</span><span class="rounded-full border border-zinc-200 px-2 py-1 text-xs font-bold text-zinc-700">{{ selectedDocument.soKyHieu || selectedDocument.documentId }}</span><span class="rounded-full border px-2 py-1 text-xs font-bold" :class="statusClass(selectedDocument.status || (selectedDocument.ingest?.completed ? 'COMPLETED' : 'IN_PROGRESS'))">{{ statusLabel(selectedDocument.status || (selectedDocument.ingest?.completed ? 'COMPLETED' : 'IN_PROGRESS')) }}</span></div><h3 class="mt-3 text-base font-bold leading-6 text-zinc-900">{{ selectedDocument.trichYeu || 'Không có trích yếu.' }}</h3><dl class="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt class="font-semibold text-zinc-400">Người xử lý</dt><dd class="mt-1 text-sm font-semibold text-zinc-800">{{ selectedDocument.processing?.currentAssignee?.fullName || selectedDocument.processing?.currentAssignee?.externalFullName || selectedDocument.owner?.fullName || 'Chưa map được' }}</dd></div><div><dt class="font-semibold text-zinc-400">Hạn xử lý</dt><dd class="mt-1 text-sm font-semibold text-zinc-800">{{ formatDate(selectedDocument.deadline) }}</dd></div><div><dt class="font-semibold text-zinc-400">Điểm</dt><dd class="mt-1 text-sm font-bold text-blue-700">{{ formatNumber(selectedDocument.point) }}</dd></div><div><dt class="font-semibold text-zinc-400">Ngày đến</dt><dd class="mt-1 text-sm text-zinc-800">{{ selectedDocument.ngayDen || '—' }}</dd></div></dl></section>
              <section class="border-b border-zinc-100 py-4"><h3 class="text-xs font-bold uppercase text-zinc-400">KPI và kết quả</h3><dl class="mt-3 space-y-2 text-sm"><div class="flex justify-between gap-4"><dt class="text-zinc-500">Người nhận điểm</dt><dd class="text-right font-semibold text-zinc-800">{{ selectedDocument.processing?.currentAssignee?.fullName || selectedDocument.processing?.currentAssignee?.externalFullName || 'Chưa map được' }}</dd></div><div class="flex justify-between gap-4"><dt class="text-zinc-500">Nộp kết quả</dt><dd class="text-right font-semibold text-zinc-800">{{ formatDateTime(selectedDocument.submittedAt) }}</dd></div><div class="flex justify-between gap-4"><dt class="text-zinc-500">Hoàn tất</dt><dd class="text-right font-semibold text-zinc-800">{{ formatDateTime(selectedDocument.completedAt) }}</dd></div></dl></section>
              <section class="py-4"><h3 class="text-xs font-bold uppercase text-zinc-400">Tracklog {{ detailLogs.length }}</h3><div v-if="detailLogs.length" class="mt-3 space-y-3"><article v-for="(log, index) in detailLogs" :key="log.id || index" class="rounded-md border border-zinc-200 p-3"><div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span class="font-bold text-zinc-900">{{ log.sender?.fullName || '—' }}</span><span v-if="log.receiver?.fullName" class="text-zinc-400">→</span><span v-if="log.receiver?.fullName" class="font-semibold text-zinc-700">{{ log.receiver.fullName }}</span></div><p v-if="log.action" class="mt-2 text-xs font-semibold text-blue-700">{{ log.action }}</p><p v-if="log.comment || log.content" class="mt-2 rounded bg-zinc-50 p-2 text-xs leading-5 text-zinc-700">{{ log.comment || log.content }}</p><p class="mt-2 text-[11px] text-zinc-500">{{ log.completedAt || log.processingAt || log.receivedAt || log.updatedAt || 'Không có thời điểm' }}</p></article></div><p v-else class="mt-3 rounded-md border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-400">Chưa có tracklog.</p></section>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.performance-drawer-enter-active,
.performance-drawer-leave-active { transition: opacity 180ms ease; }
.performance-drawer-enter-active > button,
.performance-drawer-leave-active > button { transition: opacity 180ms ease; }
.performance-drawer-enter-active > aside,
.performance-drawer-leave-active > aside { transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1); }
.performance-drawer-enter-from > button,
.performance-drawer-leave-to > button { opacity: 0; }
.performance-drawer-enter-from > aside,
.performance-drawer-leave-to > aside { transform: translateX(100%); }
</style>
