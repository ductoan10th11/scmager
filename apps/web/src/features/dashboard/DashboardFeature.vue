<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  ListTodo,
  Loader2,
  Search,
} from 'lucide-vue-next'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/composables/useAuth'
import { DashboardService } from '@/features/dashboard/services/dashboard.service'

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
  dueSoonDocuments: [],
  currentDocuments: [],
  slaUnassignedDocuments: [],
})

const priorityTab = ref('all')
const workloadSearch = ref('')

const tabContainerRef = ref(null)
const tabRefs = ref({})
const pillStyle = ref({ left: '0px', width: '0px', opacity: 0 })
let resizeObserver = null

const updatePillPosition = () => {
  const el = tabRefs.value[priorityTab.value]
  if (el && el.offsetWidth > 0) {
    pillStyle.value = {
      left: `${el.offsetLeft}px`,
      width: `${el.offsetWidth}px`,
      opacity: 1,
    }
  }
}

const setTabRef = (id, el) => {
  if (el) {
    tabRefs.value[id] = el
  }
}

watch(priorityTab, () => {
  nextTick(updatePillPosition)
})

const roleCode = computed(() => user.value?.role?.code ?? summary.value.role)
const roleTitle = computed(() => ({
  ADMIN: 'Điều hành toàn hệ thống',
  OFFICE_CHIEF: 'Điều hành văn thư',
  COMMUNE_LEADER: 'Tổng quan cơ quan',
  DEPARTMENT_LEADER: 'Điều hành phòng ban',
  SPECIALIST: 'Công việc của tôi',
}[roleCode.value] ?? 'Tổng quan công việc'))

const currentDateFormatted = computed(() => {
  const now = new Date()
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now)
})

const metrics = computed(() => {
  const tasks = summary.value.tasks ?? {}
  const documents = summary.value.documents ?? {}
  return [
    {
      label: 'Văn bản tháng này',
      value: documents.monthly ?? 0,
      icon: FileText,
      route: '/office-documents',
    },
    {
      label: 'Văn bản đang xử lý',
      value: documents.currentForScope ?? 0,
      icon: Clock3,
      route: '/office-documents',
    },
    {
      label: 'Văn bản quá hạn',
      value: documents.overdue ?? 0,
      icon: AlertTriangle,
      route: '/office-documents',
      isAlert: (documents.overdue ?? 0) > 0,
    },
    {
      label: 'Công việc hôm nay',
      value: tasks.today ?? 0,
      icon: ClipboardCheck,
      route: '/assignments',
    },
  ]
})

const priorityItems = computed(() => {
  const rows = []
  const addDocuments = (items, label, badgeClass) => {
    for (const item of items ?? []) rows.push({ ...item, kind: 'document', label, badgeClass })
  }

  addDocuments(deadlines.value.overdueDocuments, 'Quá hạn', 'bg-rose-50 text-rose-700 border-rose-200')
  addDocuments(deadlines.value.dueSoonDocuments, 'Đến hạn', 'bg-amber-50 text-amber-700 border-amber-200')
  return rows.slice(0, 15)
})

const filteredPriorityItems = computed(() => {
  if (priorityTab.value === 'overdue') return priorityItems.value.filter((i) => i.label === 'Quá hạn')
  if (priorityTab.value === 'dueSoon') return priorityItems.value.filter((i) => i.label === 'Đến hạn')
  return priorityItems.value
})

const workloadRows = computed(() => [...workload.value]
  .sort((a, b) => (b.documentsOverdue - a.documentsOverdue) || (b.documentsCurrent - a.documentsCurrent))
  .slice(0, 20))

const filteredWorkloadRows = computed(() => {
  let list = workloadRows.value
  if (workloadSearch.value.trim()) {
    const q = workloadSearch.value.trim().toLowerCase()
    list = list.filter((r) =>
      r.user?.fullName?.toLowerCase().includes(q) ||
      r.user?.department?.name?.toLowerCase().includes(q)
    )
  }
  return list
})

const formatDateTime = (value) => value
  ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  : 'Chưa đặt'

const openItem = (item) => {
  router.push(item.kind === 'document' ? '/office-documents' : '/assignments')
}

const getInitials = (name) => {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

let pollTimer = null

const fetchDashboard = async (isBackground = false) => {
  if (!isBackground) {
    loading.value = true
  }
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
    if (!isBackground) {
      error.value = e.message
    }
  } finally {
    if (!isBackground) {
      loading.value = false
    }
    nextTick(updatePillPosition)
  }
}

onMounted(() => {
  fetchDashboard().then(() => {
    nextTick(updatePillPosition)
  })

  // Polling 10 RPM (mỗi 6 giây) tự động làm mới ngầm khi tab đang mở
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      fetchDashboard(true)
    }
  }, 6000)

  if (tabContainerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updatePillPosition())
    resizeObserver.observe(tabContainerRef.value)
  }
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

<template>
  <div class="h-full w-full overflow-y-auto bg-zinc-50/50 pb-10">
    <!-- Header -->
    <header class="border-b border-zinc-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="text-xl font-bold text-zinc-900 truncate">
              {{ roleTitle }}
            </h1>
            <Badge variant="outline" class="rounded-full border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-semibold text-zinc-700">
              {{ user?.organization?.name ?? user?.department?.name ?? 'eWork' }}
            </Badge>
          </div>
          <p class="mt-0.5 text-xs text-zinc-500">
            {{ currentDateFormatted }}
          </p>
        </div>

        <div class="flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-zinc-100/70 p-1 shadow-xs backdrop-blur-xs">
          <Button
            variant="ghost"
            size="sm"
            class="group h-8 rounded-full border border-transparent bg-white px-3.5 text-xs font-semibold text-zinc-700 shadow-xs transition-all duration-200 hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-900 active:scale-95"
            @click="router.push('/assignments')"
          >
            <ListTodo class="mr-1.5 h-3.5 w-3.5 text-indigo-500 transition-transform duration-200 group-hover:scale-110" />
            <span>Nhiệm vụ</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="group h-8 rounded-full border border-transparent bg-white px-3.5 text-xs font-semibold text-zinc-700 shadow-xs transition-all duration-200 hover:border-sky-200 hover:bg-sky-50/60 hover:text-sky-900 active:scale-95"
            @click="router.push('/office-documents')"
          >
            <FileText class="mr-1.5 h-3.5 w-3.5 text-sky-500 transition-transform duration-200 group-hover:scale-110" />
            <span>Văn bản</span>
          </Button>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <!-- Error Alert -->
      <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 flex items-center gap-2">
        <AlertTriangle class="h-4 w-4 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <!-- Loading State -->
      <div v-if="loading && !summary.role" class="flex items-center justify-center py-20 text-xs text-zinc-500 gap-2">
        <Loader2 class="h-4 w-4 animate-spin text-zinc-600" /> Đang tải dữ liệu tổng quan...
      </div>

      <template v-else>
        <!-- 1. Simple Metric Cards -->
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            v-for="metric in metrics"
            :key="metric.label"
            type="button"
            class="min-w-0 rounded-xl border border-zinc-200/90 bg-white p-4 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50/50"
            @click="router.push(metric.route)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-zinc-500 truncate">{{ metric.label }}</span>
              <span class="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 shrink-0">
                <component :is="metric.icon" class="h-3.5 w-3.5" />
              </span>
            </div>
            <strong
              class="mt-2 block text-2xl font-bold tracking-tight"
              :class="metric.isAlert ? 'text-rose-600' : 'text-zinc-900'"
            >
              {{ metric.value }}
            </strong>
          </button>
        </section>

        <!-- 2. Main Grid Row -->
        <section class="grid gap-5 lg:grid-cols-12">
          <!-- Priority Items (8 cols) -->
          <Card class="lg:col-span-8 rounded-xl border border-zinc-200/90 bg-white shadow-2xs overflow-hidden">
            <CardHeader class="border-b border-zinc-100 px-4 py-3 bg-zinc-50/40">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle class="text-sm font-bold text-zinc-900">Ưu tiên xử lý</CardTitle>
                  <CardDescription class="text-xs text-zinc-500">
                    Văn bản đến quá hạn hoặc sắp đến hạn xử lý
                  </CardDescription>
                </div>

                <!-- Filters with smooth sliding indicator -->
                <div ref="tabContainerRef" class="relative flex items-center bg-zinc-100 p-0.5 rounded-full border border-zinc-200/80 text-xs">
                  <div
                    class="absolute top-0.5 bottom-0.5 rounded-full bg-white shadow-2xs transition-all duration-300 ease-out"
                    :style="pillStyle"
                  />
                  <button
                    v-for="tab in [
                      { id: 'all', label: `Tất cả (${priorityItems.length})` },
                      { id: 'overdue', label: 'Quá hạn' },
                      { id: 'dueSoon', label: 'Đến hạn' },
                    ]"
                    :key="tab.id"
                    :ref="el => setTabRef(tab.id, el)"
                    type="button"
                    class="relative z-10 rounded-full px-3 py-1 font-medium text-xs transition-colors duration-200 select-none"
                    :class="priorityTab === tab.id ? 'text-zinc-900 font-bold' : 'text-zinc-500 hover:text-zinc-900'"
                    @click="priorityTab = tab.id"
                  >
                    {{ tab.label }}
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent class="p-0">
              <div v-if="filteredPriorityItems.length" class="divide-y divide-zinc-100 max-h-[380px] overflow-y-auto">
                <button
                  v-for="item in filteredPriorityItems"
                  :key="`${item.kind}-${item._id}-${item.label}`"
                  type="button"
                  class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50/60 transition-colors"
                  @click="openItem(item)"
                >
                  <span
                    class="shrink-0 rounded px-2 py-0.5 text-[10px] font-bold border"
                    :class="item.badgeClass"
                  >
                    {{ item.label }}
                  </span>
                  
                  <div class="min-w-0 flex-1 space-y-0.5">
                    <p class="truncate text-xs font-semibold text-zinc-900">
                      {{ item.title ?? item.trichYeu ?? item.soKyHieu ?? 'Văn bản' }}
                    </p>
                    <p class="flex items-center gap-2 truncate text-[11px] text-zinc-500">
                      <span>{{ item.assignedTo?.fullName ?? item.currentAssignee?.fullName ?? item.currentDepartment?.name ?? 'Chưa phân công' }}</span>
                      <span class="text-zinc-300">•</span>
                      <span>{{ formatDateTime(item.dueAt ?? item.deadline ?? item.slaDueAt) }}</span>
                    </p>
                  </div>

                  <ArrowUpRight class="h-4 w-4 shrink-0 text-zinc-400" />
                </button>
              </div>

              <div v-else class="flex items-center justify-center py-12 text-xs text-zinc-400 gap-2">
                <CheckCircle2 class="h-4 w-4 text-emerald-500" />
                <span>Không có việc ưu tiên tồn đọng.</span>
              </div>
            </CardContent>
          </Card>

          <!-- Today Tasks (4 cols) -->
          <Card class="lg:col-span-4 rounded-xl border border-zinc-200/90 bg-white shadow-2xs overflow-hidden flex flex-col">
            <CardHeader class="border-b border-zinc-100 px-4 py-3 bg-zinc-50/40">
              <CardTitle class="text-sm font-bold text-zinc-900">Hôm nay</CardTitle>
              <CardDescription class="text-xs text-zinc-500">
                {{ deadlines.todayTasks?.length ?? 0 }} nhiệm vụ đến hạn
              </CardDescription>
            </CardHeader>

            <CardContent class="p-0 flex-1 flex flex-col justify-between">
              <div v-if="deadlines.todayTasks?.length" class="divide-y divide-zinc-100 max-h-[320px] overflow-y-auto">
                <button
                  v-for="task in deadlines.todayTasks"
                  :key="task._id"
                  type="button"
                  class="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-zinc-50/60 transition-colors"
                  @click="router.push('/assignments')"
                >
                  <CalendarDays class="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium text-zinc-800">
                      {{ task.title }}
                    </p>
                    <p class="text-[11px] text-zinc-400">
                      {{ formatDateTime(task.dueAt) }}
                    </p>
                  </div>
                  <ChevronRight class="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                </button>
              </div>

              <div v-else class="py-12 text-center text-xs text-zinc-400 my-auto">
                Không có việc đến hạn hôm nay.
              </div>

              <div class="p-2.5 border-t border-zinc-100 bg-zinc-50/30 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  class="w-full text-xs text-zinc-600 hover:text-zinc-900 rounded-full h-7 font-medium"
                  @click="router.push('/assignments')"
                >
                  Xem khai báo công việc →
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <!-- 3. Workload Table (Admins / Leaders) -->
        <Card v-if="roleCode !== 'SPECIALIST'" class="rounded-xl border border-zinc-200/90 bg-white shadow-2xs overflow-hidden">
          <CardHeader class="border-b border-zinc-100 px-4 py-3 bg-zinc-50/40">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle class="text-sm font-bold text-zinc-900">Tình trạng chuyên viên</CardTitle>
                <CardDescription class="text-xs text-zinc-500">
                  Thống kê văn bản đang làm, đã chuyển và quá hạn theo từng tài khoản
                </CardDescription>
              </div>

              <!-- Search Input -->
              <div class="relative min-w-[220px]">
                <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <Input
                  v-model="workloadSearch"
                  placeholder="Tìm chuyên viên..."
                  class="h-7 rounded-full pl-8 text-xs border-zinc-200 bg-white"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent class="p-0">
            <div class="overflow-x-auto">
              <Table class="w-full min-w-[850px] text-xs">
                <TableHeader class="bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <TableRow class="border-b border-zinc-200/80">
                    <TableHead class="px-4 py-2.5 font-bold text-zinc-600 whitespace-nowrap">Chuyên viên</TableHead>
                    <TableHead class="px-4 py-2.5 font-bold text-zinc-600 whitespace-nowrap">Phòng ban</TableHead>
                    <TableHead class="px-4 py-2.5 text-right font-bold text-zinc-600 whitespace-nowrap">VB đang làm</TableHead>
                    <TableHead class="px-4 py-2.5 text-right font-bold text-zinc-600 whitespace-nowrap">VB đã chuyển</TableHead>
                    <TableHead class="px-4 py-2.5 text-right font-bold text-zinc-600 whitespace-nowrap">VB quá hạn</TableHead>
                    <TableHead class="px-4 py-2.5 font-bold text-zinc-600 whitespace-nowrap">Đang xử lý gì</TableHead>
                    <TableHead class="px-4 py-2.5 text-right font-bold text-zinc-600 whitespace-nowrap">Chờ duyệt</TableHead>
                    <TableHead class="px-4 py-2.5 text-right font-bold text-zinc-600 whitespace-nowrap">Đã duyệt</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody class="divide-y divide-zinc-100">
                  <TableRow v-for="row in filteredWorkloadRows" :key="row.user._id" class="hover:bg-zinc-50/50 transition-colors">
                    <TableCell class="px-4 py-2.5 font-semibold text-zinc-800">
                      <div class="flex items-center gap-2">
                        <Avatar class="h-6 w-6 rounded-full border border-zinc-200 bg-zinc-100 shrink-0">
                          <AvatarFallback class="font-bold text-[10px] text-zinc-700 bg-transparent">
                            {{ getInitials(row.user.fullName) }}
                          </AvatarFallback>
                        </Avatar>
                        <span class="truncate">{{ row.user.fullName }}</span>
                      </div>
                    </TableCell>

                    <TableCell class="px-4 py-2.5 text-zinc-500">
                      {{ row.user.department?.name ?? '—' }}
                    </TableCell>

                    <TableCell class="px-4 py-2.5 text-right font-bold text-zinc-900">
                      {{ row.documentsCurrent }}
                    </TableCell>

                    <TableCell class="px-4 py-2.5 text-right text-emerald-700 font-semibold">
                      {{ row.documentsProcessed }}
                    </TableCell>

                    <TableCell class="px-4 py-2.5 text-right font-bold" :class="row.documentsOverdue ? 'text-rose-600' : 'text-zinc-400'">
                      {{ row.documentsOverdue }}
                    </TableCell>

                    <TableCell class="max-w-[260px] px-4 py-2.5">
                      <div v-if="row.currentDocuments?.length" class="space-y-0.5">
                        <p v-for="doc in row.currentDocuments" :key="doc.id" class="truncate text-[11px] text-zinc-600">
                          {{ doc.soKyHieu || 'VB đến' }} · {{ doc.trichYeu }}
                        </p>
                      </div>
                      <span v-else class="text-[11px] text-zinc-400">—</span>
                    </TableCell>

                    <TableCell class="px-4 py-2.5 text-right text-zinc-600">
                      {{ row.pendingReview }}
                    </TableCell>

                    <TableCell class="px-4 py-2.5 text-right text-emerald-700 font-medium">
                      {{ row.done }}
                    </TableCell>
                  </TableRow>

                  <TableRow v-if="!filteredWorkloadRows.length">
                    <TableCell colspan="8" class="px-4 py-8 text-center text-zinc-400">
                      Chưa có dữ liệu chuyên viên.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </template>
    </main>
  </div>
</template>
