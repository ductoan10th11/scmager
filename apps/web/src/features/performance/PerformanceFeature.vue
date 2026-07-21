<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  Target,
  Trophy,
  Users,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { PerformanceService } from './services/performance.service'
import { useAuth } from '@/features/auth/composables/useAuth'

const router = useRouter()
const { user } = useAuth()

const loading = ref(false)
const error = ref(null)
const payload = ref(null)

const summary = computed(() => payload.value?.summary ?? {})
const urgency = computed(() => payload.value?.urgency ?? [])
const assignees = computed(() => payload.value?.assignees ?? [])
const documents = computed(() => payload.value?.documents ?? {})
const canSeeAssignees = computed(() => user.value?.role?.code !== 'SPECIALIST')

const metricCards = computed(() => [
  {
    label: 'Tổng điểm văn bản',
    value: summary.value.totalPoint ?? 0,
    note: `${formatNumber(summary.value.totalDocuments)} văn bản có hạn`,
    icon: Trophy,
    tone: 'bg-blue-50 text-blue-700',
  },
  {
    label: 'Điểm hoàn thành',
    value: summary.value.completedPoint ?? 0,
    note: `${formatNumber(summary.value.completionRate)}% KPI`,
    icon: CheckCircle2,
    tone: 'bg-emerald-50 text-emerald-700',
  },
  {
    label: 'Điểm đang xử lý',
    value: summary.value.pendingPoint ?? 0,
    note: `${formatNumber(summary.value.pendingDocuments)} văn bản`,
    icon: Clock3,
    tone: 'bg-amber-50 text-amber-700',
  },
  {
    label: 'Điểm quá hạn',
    value: summary.value.overduePoint ?? 0,
    note: `${formatNumber(summary.value.overdueDocuments)} văn bản quá hạn`,
    icon: AlertTriangle,
    tone: 'bg-rose-50 text-rose-700',
  },
])

const topAssignees = computed(() => assignees.value.slice(0, 16))

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value ?? 0))

const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const progressStyle = (value) => ({ width: `${Math.max(0, Math.min(100, Number(value ?? 0)))}%` })

const documentStatusClass = (doc) => doc.completed
  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
  : new Date(doc.deadline).getTime() < Date.now()
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : 'border-amber-200 bg-amber-50 text-amber-700'

const documentStatusLabel = (doc) => doc.completed
  ? 'Hoàn thành'
  : new Date(doc.deadline).getTime() < Date.now()
    ? 'Quá hạn'
    : 'Gần hạn'

const openDocument = (doc) => {
  if (!doc?.id) return
  router.push(`/documents/${doc.id}`)
}

const fetchData = async () => {
  loading.value = true
  error.value = null
  try {
    const result = await PerformanceService.overview()
    payload.value = result.data
  } catch (requestError) {
    error.value = requestError.message || 'Không tải được dữ liệu hiệu suất.'
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)
</script>

<template>
  <section class="h-full overflow-auto bg-zinc-50/60">
    <header class="border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
      <div class="mx-auto flex max-w-[1560px] items-center justify-between gap-4">
        <div class="min-w-0">
          <h1 class="flex items-center gap-2 truncate text-xl font-bold text-zinc-900">
            <BarChart3 class="h-5 w-5 text-blue-600" />
            Hiệu suất
          </h1>
          <p class="mt-1 truncate text-sm text-zinc-500">KPI văn bản theo điểm [p:n], hạn xử lý và trạng thái hoàn thành.</p>
        </div>
        <Button variant="outline" size="icon" class="h-9 w-9 rounded-full" title="Làm mới" :disabled="loading" @click="fetchData">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
        </Button>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1560px] space-y-5 px-4 py-5 sm:px-6">
      <div v-if="error" class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
        {{ error }}
      </div>

      <div v-if="loading && !payload" class="flex items-center justify-center py-24 text-sm text-zinc-400">
        <Loader2 class="mr-2 h-5 w-5 animate-spin" /> Đang tải dữ liệu hiệu suất...
      </div>

      <template v-else>
        <section class="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <article
            v-for="metric in metricCards"
            :key="metric.label"
            class="min-w-0 rounded-md border border-zinc-200 bg-white p-4 shadow-sm"
          >
            <div class="flex items-start justify-between gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" :class="metric.tone">
                <component :is="metric.icon" class="h-5 w-5" />
              </span>
              <strong class="text-2xl font-bold leading-none text-zinc-950">{{ formatNumber(metric.value) }}</strong>
            </div>
            <p class="mt-3 truncate text-sm font-bold text-zinc-800">{{ metric.label }}</p>
            <p class="mt-1 truncate text-xs font-medium text-zinc-500">{{ metric.note }}</p>
          </article>
        </section>

        <section class="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
            <div class="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <div>
                <h2 class="text-sm font-bold text-zinc-900">Cơ cấu điểm theo độ khẩn</h2>
                <p class="mt-0.5 text-xs text-zinc-500">Tổng điểm và tỷ lệ hoàn thành của từng nhóm văn bản</p>
              </div>
              <Target class="h-4 w-4 text-zinc-400" />
            </div>
            <div class="divide-y divide-zinc-100">
              <div v-for="row in urgency" :key="row.label" class="px-4 py-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-bold text-zinc-900">{{ row.label || 'Không rõ' }}</p>
                    <p class="mt-0.5 text-xs text-zinc-500">{{ formatNumber(row.total) }} văn bản · {{ formatNumber(row.overdue) }} quá hạn</p>
                  </div>
                  <strong class="shrink-0 text-lg font-bold text-zinc-950">{{ formatNumber(row.point) }}</strong>
                </div>
                <div class="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div class="h-full rounded-full bg-emerald-500" :style="progressStyle(row.total ? Math.round((row.completed / row.total) * 100) : 0)" />
                </div>
              </div>
              <div v-if="!urgency.length" class="py-12 text-center text-sm text-zinc-400">Chưa có dữ liệu độ khẩn.</div>
            </div>
          </div>

          <div class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
            <div class="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <div>
                <h2 class="text-sm font-bold text-zinc-900">Văn bản cần chú ý</h2>
                <p class="mt-0.5 text-xs text-zinc-500">Ưu tiên theo hạn xử lý và điểm KPI</p>
              </div>
              <CalendarClock class="h-4 w-4 text-zinc-400" />
            </div>
            <div class="max-h-[520px] overflow-y-auto">
              <button
                v-for="doc in [...(documents.overdue ?? []), ...(documents.dueSoon ?? [])].slice(0, 16)"
                :key="doc.id"
                type="button"
                class="flex w-full items-start gap-3 border-b border-zinc-100 px-4 py-3 text-left last:border-0 hover:bg-zinc-50"
                @click="openDocument(doc)"
              >
                <span class="mt-0.5 rounded-full border px-2 py-1 text-[11px] font-bold" :class="documentStatusClass(doc)">{{ documentStatusLabel(doc) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-bold text-zinc-900">{{ doc.soKyHieu || 'Văn bản đến' }}</span>
                  <span class="mt-0.5 line-clamp-2 block text-xs leading-5 text-zinc-500">{{ doc.trichYeu || doc.donViBanHanh || 'Không có trích yếu.' }}</span>
                  <span class="mt-1 block text-[11px] font-semibold text-zinc-400">Hạn {{ formatDateTime(doc.deadline) }} · {{ formatNumber(doc.point) }} điểm</span>
                </span>
                <ArrowUpRight class="mt-1 h-4 w-4 shrink-0 text-zinc-400" />
              </button>
              <div v-if="!documents.overdue?.length && !documents.dueSoon?.length" class="py-16 text-center text-sm text-zinc-400">
                Không có văn bản quá hạn hoặc gần hạn.
              </div>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div>
              <h2 class="text-sm font-bold text-zinc-900">{{ canSeeAssignees ? 'Hiệu suất nhân sự' : 'Hiệu suất của tôi' }}</h2>
              <p class="mt-0.5 text-xs text-zinc-500">Điểm hoàn thành, điểm tồn và điểm quá hạn theo người xử lý</p>
            </div>
            <Users class="h-4 w-4 text-zinc-400" />
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[980px] text-sm">
              <thead class="bg-zinc-50 text-left text-xs font-semibold text-zinc-500">
                <tr>
                  <th class="px-4 py-3">Nhân sự</th>
                  <th class="px-4 py-3">Phòng ban</th>
                  <th class="px-4 py-3 text-right">Tổng điểm</th>
                  <th class="px-4 py-3 text-right">Hoàn thành</th>
                  <th class="px-4 py-3 text-right">Đang xử lý</th>
                  <th class="px-4 py-3 text-right">Quá hạn</th>
                  <th class="px-4 py-3">Tỷ lệ</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr v-for="row in topAssignees" :key="row.user.id" class="hover:bg-zinc-50/70">
                  <td class="px-4 py-3">
                    <p class="font-bold text-zinc-900">{{ row.user.fullName }}</p>
                    <p class="mt-0.5 text-xs text-zinc-500">{{ row.user.position || row.user.role?.name || row.user.username }}</p>
                  </td>
                  <td class="px-4 py-3 text-zinc-500">{{ row.user.department?.name || '—' }}</td>
                  <td class="px-4 py-3 text-right font-bold text-zinc-900">{{ formatNumber(row.totalPoint) }}</td>
                  <td class="px-4 py-3 text-right font-semibold text-emerald-700">{{ formatNumber(row.completedPoint) }}</td>
                  <td class="px-4 py-3 text-right font-semibold text-amber-700">{{ formatNumber(row.pendingPoint) }}</td>
                  <td class="px-4 py-3 text-right font-semibold" :class="row.overduePoint ? 'text-rose-600' : 'text-zinc-400'">{{ formatNumber(row.overduePoint) }}</td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                      <div class="h-2 w-32 overflow-hidden rounded-full bg-zinc-100">
                        <div class="h-full rounded-full bg-blue-600" :style="progressStyle(row.completionRate)" />
                      </div>
                      <span class="w-10 text-right text-xs font-bold text-zinc-600">{{ row.completionRate }}%</span>
                    </div>
                  </td>
                </tr>
                <tr v-if="!topAssignees.length">
                  <td colspan="7" class="px-4 py-12 text-center text-zinc-400">Chưa có dữ liệu nhân sự.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div>
              <h2 class="text-sm font-bold text-zinc-900">Văn bản điểm cao</h2>
              <p class="mt-0.5 text-xs text-zinc-500">Các văn bản đóng góp nhiều điểm KPI nhất</p>
            </div>
            <FileText class="h-4 w-4 text-zinc-400" />
          </div>
          <div class="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
            <button
              v-for="doc in documents.highPoint ?? []"
              :key="doc.id"
              type="button"
              class="min-w-0 border-b border-zinc-100 px-4 py-3 text-left hover:bg-zinc-50 md:border-r xl:[&:nth-child(3n)]:border-r-0"
              @click="openDocument(doc)"
            >
              <div class="flex items-start justify-between gap-3">
                <p class="min-w-0 truncate text-sm font-bold text-zinc-900">{{ doc.soKyHieu || 'Văn bản đến' }}</p>
                <span class="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">{{ formatNumber(doc.point) }} điểm</span>
              </div>
              <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{{ doc.trichYeu || doc.donViBanHanh || 'Không có trích yếu.' }}</p>
              <p class="mt-2 text-[11px] font-semibold text-zinc-400">Hạn {{ formatDateTime(doc.deadline) }}</p>
            </button>
            <div v-if="!documents.highPoint?.length" class="col-span-full py-12 text-center text-sm text-zinc-400">Chưa có dữ liệu văn bản điểm cao.</div>
          </div>
        </section>
      </template>
    </main>
  </section>
</template>
