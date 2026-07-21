<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Users,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { DashboardService } from '@/features/dashboard/services/dashboard.service'
import { useAuth } from '@/features/auth/composables/useAuth'

const router = useRouter()
const { user } = useAuth()

const loading = ref(false)
const error = ref(null)
const summary = ref({
  role: '',
  tasks: {},
  documents: {},
})
const workload = ref([])
const deadlines = ref({
  overdueTasks: [],
  dueSoonTasks: [],
  todayTasks: [],
  pendingReviewTasks: [],
  overdueDocuments: [],
  currentDocuments: [],
  slaUnassignedDocuments: [],
})

const roleCode = computed(() => user.value?.role?.code ?? summary.value.role)
const roleTitle = computed(() => ({
  ADMIN: 'Điều hành toàn hệ thống',
  OFFICE_CHIEF: 'Điều hành văn thư',
  COMMUNE_LEADER: 'Tổng quan cơ quan',
  DEPARTMENT_LEADER: 'Điều hành phòng ban',
  SPECIALIST: 'Công việc của tôi',
}[roleCode.value] ?? 'Tổng quan công việc'))

const metrics = computed(() => {
  const tasks = summary.value.tasks ?? {}
  const documents = summary.value.documents ?? {}
  if (['ADMIN', 'OFFICE_CHIEF'].includes(roleCode.value)) {
    return [
      { label: 'Văn bản đã ingest', value: documents.total ?? 0, icon: FileText, tone: 'text-blue-700 bg-blue-50', route: '/documents' },
      { label: 'Đang lấy chi tiết', value: documents.pending ?? 0, icon: Clock3, tone: 'text-violet-700 bg-violet-50', route: '/documents' },
      { label: 'Việc chờ duyệt', value: tasks.pendingReview ?? 0, icon: ClipboardCheck, tone: 'text-amber-700 bg-amber-50', route: '/assignments' },
      { label: 'Văn bản quá hạn', value: documents.overdue ?? 0, icon: AlertTriangle, tone: 'text-rose-700 bg-rose-50', route: '/documents' },
    ]
  }
  if (roleCode.value === 'DEPARTMENT_LEADER') {
    return [
      { label: 'Văn bản đang xử lý', value: documents.currentForScope ?? 0, icon: FileText, tone: 'text-blue-700 bg-blue-50', route: '/documents' },
      { label: 'Việc chờ duyệt', value: tasks.pendingReview ?? 0, icon: ClipboardCheck, tone: 'text-violet-700 bg-violet-50', route: '/assignments' },
      { label: 'Việc cần bổ sung', value: tasks.revisionRequested ?? 0, icon: RotateCcw, tone: 'text-orange-700 bg-orange-50', route: '/assignments' },
      { label: 'Việc đã duyệt', value: tasks.done ?? 0, icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50', route: '/assignments' },
    ]
  }
  if (roleCode.value === 'SPECIALIST') {
    return [
      { label: 'Văn bản chờ tôi xử lý', value: documents.currentForScope ?? 0, icon: FileText, tone: 'text-blue-700 bg-blue-50', route: '/documents' },
      { label: 'Văn bản đã chuyển', value: documents.processedByScope ?? 0, icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50', route: '/documents' },
      { label: 'Việc chờ duyệt', value: tasks.pendingReview ?? 0, icon: Clock3, tone: 'text-amber-700 bg-amber-50', route: '/assignments' },
      { label: 'Việc cần bổ sung', value: tasks.revisionRequested ?? 0, icon: RotateCcw, tone: 'text-orange-700 bg-orange-50', route: '/assignments' },
    ]
  }
  return [
    { label: 'Tổng văn bản', value: documents.total ?? 0, icon: FileText, tone: 'text-blue-700 bg-blue-50', route: '/documents' },
    { label: 'Văn bản quá hạn', value: documents.overdue ?? 0, icon: AlertTriangle, tone: 'text-rose-700 bg-rose-50', route: '/documents' },
    { label: 'Việc chờ duyệt', value: tasks.pendingReview ?? 0, icon: ClipboardCheck, tone: 'text-violet-700 bg-violet-50', route: '/assignments' },
    { label: 'Việc quá thời hạn', value: tasks.overdue ?? 0, icon: Clock3, tone: 'text-amber-700 bg-amber-50', route: '/assignments' },
  ]
})

const priorityItems = computed(() => {
  const rows = []
  const addTasks = (items, label, tone) => {
    for (const item of items ?? []) rows.push({ ...item, kind: 'task', label, tone })
  }
  const addDocuments = (items, label, tone) => {
    for (const item of items ?? []) rows.push({ ...item, kind: 'document', label, tone })
  }

  if (roleCode.value === 'SPECIALIST') {
    addDocuments(deadlines.value.currentDocuments, 'Đang xử lý', 'text-blue-700 bg-blue-50')
    addTasks(deadlines.value.overdueTasks, 'Quá hạn', 'text-rose-700 bg-rose-50')
    addTasks(deadlines.value.dueSoonTasks, 'Gần hạn', 'text-amber-700 bg-amber-50')
  } else if (roleCode.value === 'DEPARTMENT_LEADER') {
    addDocuments(deadlines.value.currentDocuments, 'Đang xử lý', 'text-blue-700 bg-blue-50')
    addTasks(deadlines.value.pendingReviewTasks, 'Chờ duyệt', 'text-violet-700 bg-violet-50')
    addTasks(deadlines.value.overdueTasks, 'Quá hạn', 'text-rose-700 bg-rose-50')
    addDocuments(deadlines.value.overdueDocuments, 'Văn bản quá hạn', 'text-amber-700 bg-amber-50')
  } else {
    addDocuments(deadlines.value.overdueDocuments, 'Quá hạn', 'text-rose-700 bg-rose-50')
    addTasks(deadlines.value.pendingReviewTasks, 'Chờ duyệt', 'text-violet-700 bg-violet-50')
    addTasks(deadlines.value.overdueTasks, 'Việc quá hạn', 'text-rose-700 bg-rose-50')
  }
  return rows.slice(0, 12)
})

const workloadRows = computed(() => [...workload.value]
  .sort((a, b) => (b.documentsOverdue - a.documentsOverdue) || (b.documentsCurrent - a.documentsCurrent))
  .slice(0, 12))

const formatDateTime = (value) => value
  ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  : 'Chưa đặt'

const openItem = (item) => {
  router.push(item.kind === 'document' ? `/documents/${item._id}` : '/assignments')
}

const fetchDashboard = async () => {
  loading.value = true
  error.value = null
  try {
    const [summaryRes, workloadRes, deadlineRes] = await Promise.all([
      DashboardService.getSummary(),
      DashboardService.getWorkload(),
      DashboardService.getDeadlines(),
    ])
    summary.value = summaryRes.data ?? summary.value
    workload.value = workloadRes.data ?? []
    deadlines.value = { ...deadlines.value, ...(deadlineRes.data ?? {}) }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchDashboard)
</script>

<template>
  <div class="h-full overflow-auto bg-zinc-50/50">
    <header class="border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div class="min-w-0">
          <h1 class="truncate text-xl font-bold text-zinc-900">{{ roleTitle }}</h1>
          <p class="mt-1 truncate text-sm text-zinc-500">{{ user?.organization?.name ?? user?.department?.name ?? 'eWork' }}</p>
        </div>
        <Button variant="outline" size="icon" class="h-9 w-9" title="Làm mới" :disabled="loading" @click="fetchDashboard">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
        </Button>
      </div>
    </header>

    <main class="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
      <div v-if="error" class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
        {{ error }}
      </div>

      <div v-if="loading && !summary.role" class="flex items-center justify-center py-24 text-sm text-zinc-400">
        <Loader2 class="mr-2 h-5 w-5 animate-spin" /> Đang tải dữ liệu điều hành...
      </div>

      <template v-else>
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            v-for="metric in metrics"
            :key="metric.label"
            type="button"
            class="min-w-0 rounded-md border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            @click="router.push(metric.route)"
          >
            <span class="flex h-9 w-9 items-center justify-center rounded-md" :class="metric.tone">
              <component :is="metric.icon" class="h-4 w-4" />
            </span>
            <strong class="mt-3 block text-2xl font-bold text-zinc-950">{{ metric.value }}</strong>
            <span class="mt-1 block truncate text-xs font-semibold text-zinc-500">{{ metric.label }}</span>
          </button>
        </section>

        <section class="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
            <div class="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <div>
                <h2 class="text-sm font-bold text-zinc-900">Ưu tiên xử lý</h2>
                <p class="mt-0.5 text-xs text-zinc-500">Các hồ sơ và nhiệm vụ cần chú ý trước</p>
              </div>
              <AlertTriangle class="h-4 w-4 text-amber-500" />
            </div>
            <div v-if="priorityItems.length" class="divide-y divide-zinc-100">
              <button
                v-for="item in priorityItems"
                :key="`${item.kind}-${item._id}-${item.label}`"
                type="button"
                class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50"
                @click="openItem(item)"
              >
                <span class="shrink-0 rounded px-2 py-1 text-[11px] font-bold" :class="item.tone">{{ item.label }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-zinc-800">{{ item.title ?? item.trichYeu ?? item.soKyHieu }}</span>
                  <span class="mt-0.5 block truncate text-xs text-zinc-500">
                    {{ item.assignedTo?.fullName ?? item.currentAssignee?.fullName ?? item.currentDepartment?.name ?? 'Chưa phân công' }} · {{ formatDateTime(item.dueAt ?? item.deadline ?? item.slaDueAt) }}
                  </span>
                </span>
                <ArrowUpRight class="h-4 w-4 shrink-0 text-zinc-400" />
              </button>
            </div>
            <div v-else class="flex items-center justify-center py-16 text-sm text-zinc-400">
              <CheckCircle2 class="mr-2 h-5 w-5 text-emerald-500" /> Không có việc ưu tiên tồn đọng.
            </div>
          </div>

          <div class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
            <div class="border-b border-zinc-100 px-4 py-3">
              <h2 class="text-sm font-bold text-zinc-900">Hôm nay</h2>
              <p class="mt-0.5 text-xs text-zinc-500">{{ deadlines.todayTasks?.length ?? 0 }} nhiệm vụ đến hạn</p>
            </div>
            <div v-if="deadlines.todayTasks?.length" class="divide-y divide-zinc-100">
              <button
                v-for="task in deadlines.todayTasks"
                :key="task._id"
                type="button"
                class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50"
                @click="router.push('/assignments')"
              >
                <CalendarDays class="h-4 w-4 shrink-0 text-blue-600" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-zinc-800">{{ task.title }}</span>
                  <span class="block text-xs text-zinc-500">{{ formatDateTime(task.dueAt) }}</span>
                </span>
              </button>
            </div>
            <div v-else class="py-12 text-center text-sm text-zinc-400">Không có việc đến hạn hôm nay.</div>
          </div>
        </section>

        <section v-if="roleCode !== 'SPECIALIST'" class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div>
              <h2 class="text-sm font-bold text-zinc-900">Tình trạng chuyên viên</h2>
              <p class="mt-0.5 text-xs text-zinc-500">Văn bản có hạn xử lý và khai báo công việc theo từng tài khoản</p>
            </div>
            <Building2 class="h-4 w-4 text-zinc-400" />
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[980px] text-sm">
              <thead class="bg-zinc-50 text-left text-xs font-semibold text-zinc-500">
                <tr>
                  <th class="px-4 py-3">Chuyên viên</th>
                  <th class="px-4 py-3">Phòng ban</th>
                  <th class="px-4 py-3 text-right">VB đang xử lý</th>
                  <th class="px-4 py-3 text-right">VB đã chuyển</th>
                  <th class="px-4 py-3 text-right">VB quá hạn</th>
                  <th class="px-4 py-3">Đang xử lý gì</th>
                  <th class="px-4 py-3 text-right">Việc chờ duyệt</th>
                  <th class="px-4 py-3 text-right">Việc đã duyệt</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr v-for="row in workloadRows" :key="row.user._id">
                  <td class="px-4 py-3 font-semibold text-zinc-800">{{ row.user.fullName }}</td>
                  <td class="px-4 py-3 text-zinc-500">{{ row.user.department?.name ?? 'Chưa có' }}</td>
                  <td class="px-4 py-3 text-right font-semibold text-blue-700">{{ row.documentsCurrent }}</td>
                  <td class="px-4 py-3 text-right text-emerald-700">{{ row.documentsProcessed }}</td>
                  <td class="px-4 py-3 text-right font-semibold" :class="row.documentsOverdue ? 'text-rose-600' : 'text-zinc-400'">{{ row.documentsOverdue }}</td>
                  <td class="max-w-[320px] px-4 py-3"><p v-for="document in row.currentDocuments" :key="document.id" class="truncate text-xs text-zinc-600">{{ document.soKyHieu || 'Văn bản đến' }} · {{ document.trichYeu }}</p><span v-if="!row.currentDocuments?.length" class="text-xs text-zinc-400">Không có</span></td>
                  <td class="px-4 py-3 text-right text-zinc-600">{{ row.pendingReview }}</td>
                  <td class="px-4 py-3 text-right text-emerald-700">{{ row.done }}</td>
                </tr>
                <tr v-if="!workloadRows.length">
                  <td colspan="8" class="px-4 py-12 text-center text-zinc-400">Chưa có dữ liệu chuyên viên.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
