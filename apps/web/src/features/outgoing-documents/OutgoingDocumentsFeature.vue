<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, FileText, Loader2, RefreshCw, Search, Send, UserRound, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { http } from '@/shared/api/http'

const router = useRouter()
const loading = ref(false)
const detailLoading = ref(false)
const error = ref(null)
const items = ref([])
const selected = ref(null)
const pagination = ref({ page: 1, limit: 25, total: 0, totalPages: 1 })
const currentMonth = () => new Date().toISOString().slice(0, 7)
const filters = ref({ search: '', sort: 'newest', month: currentMonth() })
let searchTimer = null

const queryString = (page = 1) => new URLSearchParams({
  ...(filters.value.search ? { search: filters.value.search } : {}),
  sort: filters.value.sort,
  month: filters.value.month,
  page: String(page),
  limit: String(pagination.value.limit),
}).toString()

const fetchDocuments = async (page = 1) => {
  loading.value = true
  error.value = null
  try {
    const response = await http(`/api/ingest-documents/outgoing?${queryString(page)}`)
    items.value = response.data ?? []
    pagination.value = response.pagination ?? pagination.value
  } catch (requestError) {
    error.value = requestError.message || 'Không thể tải văn bản đi.'
    items.value = []
  } finally {
    loading.value = false
  }
}

const openDocument = async (document) => {
  selected.value = document
  detailLoading.value = true
  try {
    const response = await http(`/api/ingest-documents/outgoing/${document._id}`)
    selected.value = response.data ?? document
  } catch (requestError) {
    error.value = requestError.message || 'Không thể tải chi tiết văn bản đi.'
  } finally {
    detailLoading.value = false
  }
}

const sourceDocuments = computed(() => selected.value?.sourceDocuments ?? [])
const sourceLabel = (source) => source?.soKyHieu || source?.documentId || '—'
const resetFilters = () => { filters.value = { search: '', sort: 'newest', month: currentMonth() } }
const openSourceDocument = (source) => { if (source?._id) router.push(`/documents/${source._id}`) }

watch(() => filters.value.search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchDocuments(1), 350)
})
watch(() => [filters.value.sort, filters.value.month], () => fetchDocuments(1))
onMounted(() => fetchDocuments())
</script>

<template>
  <section class="h-full overflow-auto bg-zinc-50/60">
    <header class="border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
      <div class="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
        <div><h1 class="flex items-center gap-2 text-xl font-bold text-zinc-900"><Send class="h-5 w-5 text-sky-600" /> Văn bản đi</h1><p class="mt-1 text-sm text-zinc-500">Chỉ hiển thị văn bản liên quan có tracklog.</p></div>
        <Button class="bg-zinc-900 text-white hover:bg-zinc-700" :disabled="loading" @click="fetchDocuments(pagination.page)"><Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" /><RefreshCw v-else class="mr-2 h-4 w-4" /> Tải lại</Button>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6">
      <div class="space-y-4">
        <section class="rounded-md border border-zinc-200 bg-white p-4 shadow-sm"><div class="grid gap-3 md:grid-cols-[minmax(260px,1fr)_170px_160px_auto]"><div class="relative"><Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input v-model="filters.search" class="pl-9" placeholder="Tìm số ký hiệu, trích yếu, người soạn/ký..." /></div><Select v-model="filters.sort"><SelectTrigger><SelectValue placeholder="Sắp xếp" /></SelectTrigger><SelectContent><SelectItem value="newest">Mới đồng bộ</SelectItem><SelectItem value="oldest">Cũ trước</SelectItem></SelectContent></Select><Input v-model="filters.month" type="month" aria-label="Tháng ban hành" /><Button variant="outline" :disabled="loading" @click="resetFilters">Xóa lọc</Button></div></section>
        <div v-if="error" class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{{ error }}</div>
        <section class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <div v-if="loading" class="space-y-3 p-5"><div v-for="index in 6" :key="index" class="h-14 animate-pulse rounded-md bg-zinc-100" /></div>
          <div v-else-if="items.length" class="overflow-x-auto"><table class="w-full min-w-[940px] text-sm"><thead class="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-semibold text-zinc-500"><tr><th class="px-4 py-3">Văn bản đi</th><th class="px-4 py-3">Ngày ban hành</th><th class="px-4 py-3">Độ khẩn</th><th class="px-4 py-3">Người soạn</th><th class="px-4 py-3">Người ký</th><th class="px-4 py-3">Tracklog</th></tr></thead><tbody class="divide-y divide-zinc-100"><tr v-for="document in items" :key="document._id" class="cursor-pointer hover:bg-sky-50/40" @click="openDocument(document)"><td class="max-w-[420px] px-4 py-3"><div class="flex items-start gap-2"><FileText class="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /><div class="min-w-0"><strong class="block text-zinc-900">{{ document.soKyHieu || document.documentId }}</strong><p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">{{ document.trichYeu || 'Không có trích yếu.' }}</p></div></div></td><td class="whitespace-nowrap px-4 py-3 text-zinc-600">{{ document.ngayBanHanh || '—' }}</td><td class="px-4 py-3 text-zinc-600">{{ document.doKhan || '—' }}</td><td class="px-4 py-3 text-zinc-600">{{ document.nguoiSoan || '—' }}</td><td class="px-4 py-3 text-zinc-600">{{ document.nguoiKy || '—' }}</td><td class="px-4 py-3 text-xs text-zinc-500">{{ document.trackLogs?.length || 0 }} dòng</td></tr></tbody></table></div>
          <div v-else class="py-16 text-center text-sm font-medium text-zinc-400">Chưa có văn bản đi có tracklog.</div>
          <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3"><span class="text-xs font-medium text-zinc-500">{{ pagination.total }} văn bản đi · trang {{ pagination.page }}/{{ Math.max(pagination.totalPages, 1) }}</span><div class="flex gap-2"><Button variant="outline" size="icon" class="h-8 w-8" title="Trang trước" :disabled="loading || pagination.page <= 1" @click="fetchDocuments(pagination.page - 1)"><ChevronLeft class="h-4 w-4" /></Button><Button variant="outline" size="icon" class="h-8 w-8" title="Trang sau" :disabled="loading || pagination.page >= pagination.totalPages" @click="fetchDocuments(pagination.page + 1)"><ChevronRight class="h-4 w-4" /></Button></div></footer>
        </section>
      </div>
    </main>

    <Teleport to="body"><Transition name="outgoing-drawer"><div v-if="selected" class="fixed inset-0 z-50"><button class="absolute inset-0 bg-zinc-950/30" aria-label="Đóng" @click="selected = null" /><aside class="absolute right-0 top-0 flex h-full w-full max-w-[620px] flex-col bg-white shadow-2xl"><header class="flex items-start justify-between border-b border-zinc-200 px-5 py-4"><div><p class="text-base font-bold text-zinc-900">Chi tiết văn bản đi</p><p class="mt-0.5 text-sm text-zinc-500">{{ selected.documentId }}</p></div><Button variant="ghost" size="icon" class="h-8 w-8" title="Đóng" @click="selected = null"><X class="h-4 w-4" /></Button></header><div class="flex-1 overflow-y-auto px-5 py-5"><div v-if="detailLoading" class="space-y-3"><div v-for="index in 5" :key="index" class="h-12 animate-pulse rounded bg-zinc-100" /></div><template v-else><section class="border-b border-zinc-100 pb-5"><span class="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-bold text-zinc-700">{{ selected.soKyHieu || 'Không có ký hiệu' }}</span><h2 class="mt-4 text-lg font-bold leading-7 text-zinc-900">{{ selected.trichYeu || 'Không có trích yếu.' }}</h2></section><section class="border-b border-zinc-100 py-5"><dl class="grid grid-cols-2 gap-x-5 gap-y-4 text-sm"><div><dt class="font-semibold text-zinc-400">Ngày ban hành</dt><dd class="mt-1 text-zinc-800">{{ selected.ngayBanHanh || '—' }}</dd></div><div><dt class="font-semibold text-zinc-400">Độ khẩn</dt><dd class="mt-1 text-zinc-800">{{ selected.doKhan || '—' }}</dd></div><div><dt class="font-semibold text-zinc-400">Người soạn</dt><dd class="mt-1 text-zinc-800">{{ selected.nguoiSoan || '—' }}</dd></div><div><dt class="font-semibold text-zinc-400">Người ký</dt><dd class="mt-1 text-zinc-800">{{ selected.nguoiKy || '—' }}</dd></div></dl></section><section class="border-b border-zinc-100 py-5"><h3 class="text-xs font-bold uppercase text-zinc-400">Văn bản đến liên kết</h3><div class="mt-3 space-y-2"><button v-for="source in sourceDocuments" :key="source._id" type="button" class="w-full rounded-md border border-zinc-200 p-3 text-left hover:border-sky-300 hover:bg-sky-50" @click="openSourceDocument(source)"><p class="text-sm font-bold text-zinc-800">{{ sourceLabel(source) }}</p><p class="mt-1 line-clamp-2 text-xs text-zinc-500">{{ source.trichYeu || '—' }}</p></button></div></section><section class="py-5"><h3 class="text-xs font-bold uppercase text-zinc-400">Tracklog {{ selected.trackLogs?.length || 0 }}</h3><div class="mt-3 space-y-3"><article v-for="(log, index) in selected.trackLogs" :key="index" class="rounded-md border border-zinc-200 p-3"><p class="text-sm font-bold text-zinc-900">{{ log.sender?.fullName || '—' }}</p><p class="mt-2 rounded bg-zinc-50 p-2 text-xs leading-5 text-zinc-700">{{ log.content || '—' }}</p><div class="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-500"><span>Nhận: {{ log.receivedAt || '—' }}</span><span>Xử lý: {{ log.processingAt || '—' }}</span><span>Hoàn tất: {{ log.completedAt || '—' }}</span><span>Cập nhật: {{ log.updatedAt || '—' }}</span></div></article></div><p v-if="!selected.trackLogs?.length" class="mt-3 text-sm text-zinc-400">Chưa có tracklog.</p></section></template></div></aside></div></Transition></Teleport>
  </section>
</template>

<style scoped>
.outgoing-drawer-enter-active, .outgoing-drawer-leave-active { transition: opacity 180ms ease; }
.outgoing-drawer-enter-active > aside, .outgoing-drawer-leave-active > aside { transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1); }
.outgoing-drawer-enter-from, .outgoing-drawer-leave-to { opacity: 0; }
.outgoing-drawer-enter-from > aside, .outgoing-drawer-leave-to > aside { transform: translateX(100%); }
</style>
