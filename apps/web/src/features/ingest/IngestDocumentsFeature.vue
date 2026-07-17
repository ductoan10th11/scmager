<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Database,
  Eye,
  FilePlus2,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { http } from '@/shared/api/http'
import { useAuth } from '@/features/auth/composables/useAuth'

const { user } = useAuth()
const route = useRoute()
const router = useRouter()
const props = defineProps({
  context: { type: String, default: 'documents' },
})

const pageTitle = computed(() => props.context === 'ingest' ? 'Giám sát Ingest' : 'Văn bản')
const pageDescription = computed(() => props.context === 'ingest'
  ? 'Kiểm tra dữ liệu văn bản được đồng bộ từ Langson eOffice.'
  : 'Theo dõi văn bản có hạn xử lý trong phạm vi của bạn.')

const loading = ref(false)
const detailLoading = ref(false)
const processingSaving = ref(false)
const error = ref(null)
const items = ref([])
const selected = ref(null)
const pagination = ref({ page: 1, limit: 25, total: 0, totalPages: 1 })
const filters = ref({
  search: '',
  completed: 'ALL',
  doKhan: 'ALL',
  scope: 'ALL',
  sort: 'newest',
})

let searchTimer = null

const cleanedFilters = computed(() => Object.fromEntries(
  Object.entries(filters.value).filter(([, value]) => value && value !== 'ALL'),
))

const queryString = (page = 1) => {
  const params = new URLSearchParams({
    ...cleanedFilters.value,
    page: String(page),
    limit: String(pagination.value.limit),
  })
  return params.toString()
}

const trackLogTimestamp = (log) => {
  const raw = log?.completedAt || log?.processingAt || log?.receivedAt
  const match = raw?.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/)
  if (!match) return Number.NaN

  const [, day, month, year, hour, minute] = match
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime()
}

const latestTrackLog = (doc) => {
  const logs = doc?.trackLogs ?? []
  if (!logs.length) return null

  return [...logs].sort((a, b) => {
    const bTime = trackLogTimestamp(b)
    const aTime = trackLogTimestamp(a)
    if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) return bTime - aTime

    const bId = Number(b?.id)
    const aId = Number(a?.id)
    if (Number.isFinite(bId) && Number.isFinite(aId) && bId !== aId) return bId - aId

    return logs.indexOf(a) - logs.indexOf(b)
  })[0]
}

const fetchDocuments = async (page = 1, keepSelection = false) => {
  loading.value = true
  error.value = null
  try {
    const res = await http(`/api/ingest-documents?${queryString(page)}`)
    items.value = res.data ?? []
    pagination.value = res.pagination ?? pagination.value

    if (!keepSelection) {
      selected.value = null
    }
  } catch (e) {
    error.value = e.message
    items.value = []
    selected.value = null
  } finally {
    loading.value = false
  }
}

const openDocument = async (doc) => {
  selected.value = doc
  if (props.context === 'documents' && route.params.documentId !== doc._id) {
    router.push(`/documents/${doc._id}`)
  }
  detailLoading.value = true
  try {
    const res = await http(`/api/ingest-documents/${doc._id}`)
    selected.value = res.data ?? doc
  } catch {
    selected.value = doc
  } finally {
    detailLoading.value = false
  }
}

const closeDocument = () => {
  selected.value = null
  if (route.params.documentId) router.replace('/documents')
}

const openDocumentById = async (id) => {
  if (!id) return
  detailLoading.value = true
  try {
    const res = await http(`/api/ingest-documents/${id}`)
    selected.value = res.data
  } catch (requestError) {
    error.value = requestError.message || 'Không thể tải chi tiết văn bản.'
    router.replace('/documents')
  } finally {
    detailLoading.value = false
  }
}

const resetFilters = () => {
  filters.value = {
    search: '',
    completed: 'ALL',
    doKhan: 'ALL',
    scope: 'ALL',
    sort: 'newest',
  }
  fetchDocuments(1)
}

const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN')
}

const formatDateOnly = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('vi-VN')
}

const statusLabel = (doc) => doc?.ingest?.completed ? 'Hoàn thành' : 'Đang theo dõi'

const processingMeta = (doc) => ({
  IN_PROGRESS: { label: 'Đang xử lý', class: 'border-blue-200 bg-blue-50 text-blue-700' },
  MANUALLY_PROCESSED: { label: 'Đã xử lý thủ công', class: 'border-violet-200 bg-violet-50 text-violet-700' },
  COMPLETED: { label: 'Đã hoàn tất', class: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  UNASSIGNED: { label: 'Chưa xác định', class: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
}[doc?.processing?.status] ?? { label: 'Chưa xác định', class: 'border-zinc-200 bg-zinc-50 text-zinc-500' })

const assigneeLabel = (doc) => doc?.processing?.currentAssignee?.fullName
  || doc?.processing?.currentAssignee?.externalFullName
  || '—'

const completionClass = (doc) => doc?.ingest?.completed
  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
  : 'border-amber-200 bg-amber-50 text-amber-700'

const trackLogText = computed(() => {
  const logs = selected.value?.trackLogs ?? []
  return logs.length ? logs : []
})

const canMarkProcessed = computed(() => {
  if (!selected.value || ['COMPLETED', 'MANUALLY_PROCESSED'].includes(selected.value.processing?.status)) return false
  if (['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER'].includes(user.value?.role?.code)) return true
  return selected.value.processing?.assignees?.some((assignee) => String(assignee.userId) === String(user.value?._id))
})

const markProcessed = async () => {
  if (!selected.value || processingSaving.value) return
  processingSaving.value = true
  error.value = null
  try {
    const result = await http(`/api/ingest-documents/${selected.value._id}/processing`, {
      method: 'PATCH',
      body: { action: 'complete' },
    })
    selected.value = result.data
    const index = items.value.findIndex((item) => item._id === selected.value._id)
    if (index >= 0) items.value[index] = selected.value
  } catch (requestError) {
    error.value = requestError.message || 'Không thể cập nhật trạng thái xử lý.'
  } finally {
    processingSaving.value = false
  }
}

const createWorkFromDocument = () => {
  if (!selected.value) return
  router.push({ path: '/assignments', query: { sourceDocument: selected.value._id } })
}

watch(() => filters.value.search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchDocuments(1), 350)
})

watch(() => [filters.value.completed, filters.value.doKhan, filters.value.scope, filters.value.sort], () => {
  fetchDocuments(1)
})

watch(() => route.params.documentId, (id) => openDocumentById(id), { immediate: true })

onMounted(() => {
  if (user.value?.role?.code === 'SPECIALIST') filters.value.scope = 'mine'
  fetchDocuments(1, Boolean(route.params.documentId))
})
</script>

<template>
  <section class="h-full overflow-auto bg-zinc-50/60">
    <header class="border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
      <div class="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-xl font-bold text-zinc-900">
            <Database v-if="props.context === 'ingest'" class="h-5 w-5 text-sky-600" />
            <FileText v-else class="h-5 w-5 text-sky-600" />
            {{ pageTitle }}
          </h1>
          <p class="mt-1 text-sm text-zinc-500">{{ pageDescription }}</p>
        </div>
        <Button class="bg-zinc-900 text-white hover:bg-zinc-700" :disabled="loading" @click="fetchDocuments(pagination.page, true)">
          <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
          <RefreshCw v-else class="mr-2 h-4 w-4" /> Tải lại
        </Button>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-6">
      <div class="space-y-4 min-w-0">
        <section class="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <div class="grid gap-3 md:grid-cols-[minmax(240px,1fr)_190px_170px_170px_150px_auto]">
            <div class="relative">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input v-model="filters.search" class="pl-9" placeholder="Tìm số đến, ký hiệu, trích yếu, đơn vị..." />
            </div>
            <Select v-model="filters.completed">
              <SelectTrigger><SelectValue placeholder="Hoàn thành" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
                <SelectItem value="true">Đã hoàn thành</SelectItem>
                <SelectItem value="false">Chưa hoàn thành</SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="filters.doKhan">
              <SelectTrigger><SelectValue placeholder="Độ khẩn" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả độ khẩn</SelectItem>
                <SelectItem value="Hoả tốc">Hoả tốc</SelectItem>
                <SelectItem value="Khẩn">Khẩn</SelectItem>
                <SelectItem value="Thường">Thường</SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="filters.scope">
              <SelectTrigger><SelectValue placeholder="Phạm vi" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả văn bản</SelectItem>
                <SelectItem value="mine">Tôi đã nhận</SelectItem>
                <SelectItem value="current">Đang chờ tôi xử lý</SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="filters.sort">
              <SelectTrigger><SelectValue placeholder="Sắp xếp" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Mới cập nhật</SelectItem>
                <SelectItem value="oldest">Cũ trước</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" :disabled="loading" @click="resetFilters">Xóa lọc</Button>
          </div>
        </section>

        <div v-if="error" class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{{ error }}</div>

        <section class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <div v-if="loading" class="space-y-3 p-5"><div v-for="index in 7" :key="index" class="h-12 animate-pulse rounded-md bg-zinc-100" /></div>
          <div v-else-if="items.length" class="overflow-x-auto">
            <table class="w-full min-w-[1440px] text-sm">
              <thead class="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-semibold text-zinc-500">
                <tr>
                  <th class="px-4 py-3">Văn bản</th>
                  <th class="px-4 py-3">Đơn vị ban hành</th>
                  <th class="px-4 py-3">Ngày đến</th>
                  <th class="px-4 py-3">Hạn xử lý</th>
                  <th class="px-4 py-3">Điểm</th>
                  <th class="px-4 py-3">Độ khẩn/mật</th>
                  <th class="px-4 py-3">Ingest</th>
                  <th class="px-4 py-3">Xử lý</th>
                  <th class="px-4 py-3">Tracklog cuối</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr
                  v-for="doc in items"
                  :key="doc._id"
                  class="cursor-pointer hover:bg-zinc-50"
                  :class="selected?._id === doc._id ? 'bg-sky-50/70' : ''"
                  @click="openDocument(doc)"
                >
                  <td class="max-w-[420px] px-4 py-3">
                    <div class="flex items-start gap-2">
                      <FileText class="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="font-bold text-zinc-900">SĐ {{ doc.soDen || '—' }}</span>
                          <span class="text-xs font-semibold text-zinc-500">{{ doc.soKyHieu || doc.documentId }}</span>
                        </div>
                        <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">{{ doc.trichYeu || '—' }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="max-w-[220px] px-4 py-3 text-zinc-600">
                    <span class="line-clamp-2">{{ doc.donViBanHanh || '—' }}</span>
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-zinc-600">{{ doc.ngayDen || '—' }}</td>
                  <td class="px-4 py-3 whitespace-nowrap">
                    <span
                      class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold"
                      :class="doc.deadline ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-zinc-200 bg-zinc-50 text-zinc-400'"
                    >
                      <CalendarClock class="h-3.5 w-3.5" />
                      {{ formatDateOnly(doc.deadline) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span v-if="doc.point !== null && doc.point !== undefined" class="inline-flex whitespace-nowrap rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{{ doc.point }} điểm</span>
                    <span v-else class="text-xs text-zinc-400">—</span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex flex-col gap-1 text-xs font-semibold">
                      <span class="w-fit whitespace-nowrap rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700">{{ doc.doKhan || '—' }}</span>
                      <span class="w-fit whitespace-nowrap rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-600">{{ doc.doMat || '—' }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-bold" :class="completionClass(doc)">
                      <CheckCircle2 v-if="doc.ingest?.completed" class="h-3.5 w-3.5" />
                      <Circle v-else class="h-3.5 w-3.5" />
                      {{ statusLabel(doc) }}
                    </span>
                    <p class="mt-1 text-[11px] text-zinc-400">{{ formatDateTime(doc.ingest?.trackLogFetchedAt || doc.updatedAt) }}</p>
                  </td>
                  <td class="max-w-[210px] px-4 py-3">
                    <span class="inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-bold" :class="processingMeta(doc).class">{{ processingMeta(doc).label }}</span>
                    <p v-if="doc.processing?.currentAssignee" class="mt-1 line-clamp-2 text-xs text-zinc-600">{{ assigneeLabel(doc) }}</p>
                  </td>
                  <td class="max-w-[260px] px-4 py-3 text-xs text-zinc-600">
                    <template v-if="latestTrackLog(doc)">
                      <p class="font-semibold text-zinc-800">{{ latestTrackLog(doc).action || '—' }}</p>
                      <p class="mt-1 line-clamp-2">{{ latestTrackLog(doc).sender?.fullName || '—' }}</p>
                    </template>
                    <span v-else class="text-zinc-400">Chưa có tracklog</span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <Button variant="ghost" size="icon" class="h-8 w-8" title="Xem chi tiết" @click.stop="openDocument(doc)">
                      <Eye class="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="py-16 text-center text-sm font-medium text-zinc-400">Chưa có dữ liệu ingest phù hợp.</div>

          <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3">
            <span class="text-xs font-medium text-zinc-500">{{ pagination.total }} văn bản · trang {{ pagination.page }}/{{ Math.max(pagination.totalPages, 1) }}</span>
            <div class="flex gap-2">
              <Button variant="outline" size="icon" class="h-8 w-8" title="Trang trước" :disabled="loading || pagination.page <= 1" @click="fetchDocuments(pagination.page - 1)">
                <ChevronLeft class="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" class="h-8 w-8" title="Trang sau" :disabled="loading || pagination.page >= pagination.totalPages" @click="fetchDocuments(pagination.page + 1)">
                <ChevronRight class="h-4 w-4" />
              </Button>
            </div>
          </footer>
        </section>
      </div>

    </main>

    <Teleport to="body">
      <Transition name="ingest-drawer">
        <div v-if="selected" class="fixed inset-0 z-[80]">
          <button
            class="absolute inset-0 h-full w-full cursor-default bg-zinc-950/20 backdrop-blur-[1px]"
            type="button"
            aria-label="Đóng chi tiết"
            @click="closeDocument"
          />

          <aside class="absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col border-l border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20">
            <div class="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <div class="min-w-0">
                <h2 class="text-sm font-bold text-zinc-900">Chi tiết văn bản</h2>
                <p class="truncate text-xs text-zinc-500">{{ selected.documentId }}</p>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="outline" class="h-8 rounded-full px-3 text-xs" @click="createWorkFromDocument">
                  <FilePlus2 class="mr-1.5 h-3.5 w-3.5" /> Khai báo việc
                </Button>
                <Button v-if="canMarkProcessed" class="h-8 rounded-full bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700" :disabled="processingSaving" @click="markProcessed">
                  <Loader2 v-if="processingSaving" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  <CheckCircle2 v-else class="mr-1.5 h-3.5 w-3.5" /> Đã xử lý
                </Button>
                <Loader2 v-if="detailLoading" class="h-4 w-4 animate-spin text-zinc-400" />
                <Button variant="ghost" size="icon" class="h-8 w-8 rounded-full" title="Đóng" @click="closeDocument">
                  <X class="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-5">
              <section class="border-b border-zinc-100 pb-4">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="whitespace-nowrap rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-bold text-white">SĐ {{ selected.soDen || '—' }}</span>
                  <span class="whitespace-nowrap rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600">{{ selected.soKyHieu || 'Không có ký hiệu' }}</span>
                </div>
                <h3 class="mt-3 text-base font-bold leading-6 text-zinc-900">{{ selected.trichYeu || '—' }}</h3>
                <dl class="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt class="font-semibold text-zinc-400">Đơn vị ban hành</dt>
                    <dd class="mt-1 text-zinc-800">{{ selected.donViBanHanh || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Hình thức</dt>
                    <dd class="mt-1 text-zinc-800">{{ selected.hinhThuc || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Ngày văn bản</dt>
                    <dd class="mt-1 text-zinc-800">{{ selected.ngayVanBan || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Ngày đến</dt>
                    <dd class="mt-1 text-zinc-800">{{ selected.ngayDen || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Hạn xử lý</dt>
                    <dd class="mt-1">
                      <span
                        class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold"
                        :class="selected.deadline ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-zinc-200 bg-zinc-50 text-zinc-400'"
                      >
                        <CalendarClock class="h-3.5 w-3.5" />
                        {{ formatDateOnly(selected.deadline) }}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Điểm</dt>
                    <dd class="mt-1 text-zinc-800">{{ selected.point !== null && selected.point !== undefined ? `${selected.point} điểm` : '—' }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Người đang xử lý</dt>
                    <dd class="mt-1 text-zinc-800">{{ assigneeLabel(selected) }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Trạng thái xử lý</dt>
                    <dd class="mt-1"><span class="inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-bold" :class="processingMeta(selected).class">{{ processingMeta(selected).label }}</span></dd>
                  </div>
                  <div v-if="selected.processing?.manual?.processedAt" class="col-span-2 rounded-lg bg-violet-50 p-3">
                    <dt class="font-semibold text-violet-500">Xử lý thủ công</dt>
                    <dd class="mt-1 text-violet-800">{{ selected.processing.manual.fullName }} · {{ formatDateTime(selected.processing.manual.processedAt) }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Người soạn</dt>
                    <dd class="mt-1 text-zinc-800">{{ selected.nguoiSoan || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="font-semibold text-zinc-400">Người ký</dt>
                    <dd class="mt-1 text-zinc-800">{{ selected.nguoiKy || '—' }}</dd>
                  </div>
                </dl>
              </section>

              <section class="border-b border-zinc-100 py-4">
                <h3 class="text-xs font-bold uppercase text-zinc-400">Người đã nhận xử lý</h3>
                <div v-if="selected.processing?.assignees?.length" class="mt-3 space-y-2">
                  <div v-for="person in selected.processing.assignees" :key="person.externalUsername || person.externalFullName" class="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2">
                    <div class="min-w-0"><p class="truncate text-sm font-semibold text-zinc-800">{{ person.fullName || person.externalFullName }}</p><p class="truncate text-xs text-zinc-500">{{ person.externalUsername || 'Không có tài khoản Langson' }}</p></div>
                    <span class="shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold" :class="person.status === 'PENDING' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'">{{ person.status === 'PENDING' ? 'Chờ xử lý' : 'Đã chuyển/xử lý' }}</span>
                  </div>
                </div>
                <p v-else class="mt-3 text-sm text-zinc-400">Chưa map được người xử lý từ tracklog.</p>
              </section>

              <section class="border-b border-zinc-100 py-4">
                <h3 class="text-xs font-bold uppercase text-zinc-400">Ingest metadata</h3>
                <dl class="mt-3 space-y-2 text-xs">
                  <div class="flex justify-between gap-3">
                    <dt class="font-semibold text-zinc-500">completed</dt>
                    <dd class="font-bold" :class="selected.ingest?.completed ? 'text-emerald-700' : 'text-amber-700'">{{ String(Boolean(selected.ingest?.completed)) }}</dd>
                  </div>
                  <div class="flex justify-between gap-3">
                    <dt class="font-semibold text-zinc-500">completedRule</dt>
                    <dd class="max-w-[260px] text-right text-zinc-700">{{ selected.ingest?.completedRule || '—' }}</dd>
                  </div>
                  <div class="flex justify-between gap-3">
                    <dt class="font-semibold text-zinc-500">attempts</dt>
                    <dd class="text-zinc-700">{{ selected.ingest?.attempts ?? 0 }}</dd>
                  </div>
                  <div class="flex justify-between gap-3">
                    <dt class="font-semibold text-zinc-500">trackLogFetchedAt</dt>
                    <dd class="text-right text-zinc-700">{{ formatDateTime(selected.ingest?.trackLogFetchedAt) }}</dd>
                  </div>
                  <div v-if="selected.ingest?.lastError" class="rounded border border-rose-200 bg-rose-50 p-2 text-rose-700">
                    {{ selected.ingest.lastError }}
                  </div>
                </dl>
              </section>

              <section class="py-4">
                <h3 class="text-xs font-bold uppercase text-zinc-400">Tracklog {{ trackLogText.length }}</h3>
                <div v-if="trackLogText.length" class="mt-3 space-y-3">
                  <article v-for="log in trackLogText" :key="log.id" class="rounded-md border border-zinc-200 p-3">
                    <div class="flex items-start justify-between gap-3">
                      <p class="text-sm font-bold text-zinc-900">{{ log.action || '—' }}</p>
                      <span class="whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-500">#{{ log.id }}</span>
                    </div>
                    <p class="mt-2 text-xs text-zinc-600">
                      <span class="font-semibold text-zinc-900">{{ log.sender?.fullName || '—' }}</span>
                      <span class="text-zinc-400"> → </span>
                      <span class="font-semibold text-zinc-900">{{ log.receiver?.fullName || '—' }}</span>
                    </p>
                    <p v-if="log.comment" class="mt-2 rounded bg-zinc-50 p-2 text-xs leading-5 text-zinc-700">{{ log.comment }}</p>
                    <div class="mt-2 grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
                      <span>Nhận: {{ log.receivedAt || '—' }}</span>
                      <span>Xử lý: {{ log.processingAt || '—' }}</span>
                      <span>Xong: {{ log.completedAt || '—' }}</span>
                    </div>
                  </article>
                </div>
                <div v-else class="mt-4 rounded-md border border-dashed border-zinc-200 py-8 text-center text-sm font-medium text-zinc-400">
                  Chưa có tracklog.
                </div>
              </section>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.ingest-drawer-enter-active,
.ingest-drawer-leave-active {
  transition: opacity 180ms ease;
}

.ingest-drawer-enter-active > button,
.ingest-drawer-leave-active > button {
  transition: opacity 180ms ease;
}

.ingest-drawer-enter-active > aside,
.ingest-drawer-leave-active > aside {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ingest-drawer-enter-from > button,
.ingest-drawer-leave-to > button {
  opacity: 0;
}

.ingest-drawer-enter-from > aside,
.ingest-drawer-leave-to > aside {
  transform: translateX(100%);
}
</style>
