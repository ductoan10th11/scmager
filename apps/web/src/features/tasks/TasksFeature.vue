<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/shared/api/http'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Eye,
  ListTodo,
  Loader2,
  Play,
  Plus,
  Search,
  SendHorizontal,
  X,
  XCircle,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/composables/useAuth'

const API = '/api'
const { user } = useAuth()
const router = useRouter()
const roleCode = computed(() => user.value?.role?.code)
const roleLevel = computed(() => Number(user.value?.role?.level ?? 99))
const isSpecialist = computed(() => roleCode.value === 'SPECIALIST')
const isDeptLeader = computed(() => roleCode.value === 'DEPARTMENT_LEADER')
const canCreateTask = computed(() => roleLevel.value <= 3)
const canReviewTask = computed(() => roleLevel.value <= 3)
const canUseSpecialistActions = computed(() => isSpecialist.value)
const canCancelTask = (task) => {
  if (roleLevel.value > 3) return false
  if (isDeptLeader.value) return String(task.assignedBy?._id ?? task.assignedBy) === String(user.value?._id)
  return true
}

// ── State ─────────────────────────────────────────────────────────────────────
const tasks = ref([])
const pagination = ref({ page: 1, limit: 20, total: 0, totalPages: 1 })
const summary = ref({ total: 0, todo: 0, inProgress: 0, pendingReview: 0, done: 0, overdue: 0 })
const loading = ref(false)
const error = ref(null)

const filterStatus = ref('ALL')
const filterType = ref('ALL')
const filterSearch = ref('')
const filterOverdue = ref(false)

// ── Meta ──────────────────────────────────────────────────────────────────────
const statusMeta = {
  DRAFT:              { label: 'Nháp',            class: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  TODO:               { label: 'Chờ xử lý',       class: 'bg-blue-50 text-blue-700 border-blue-200' },
  IN_PROGRESS:        { label: 'Đang làm',         class: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_REVIEW:     { label: 'Chờ duyệt',        class: 'bg-violet-50 text-violet-700 border-violet-200' },
  REVISION_REQUESTED: { label: 'Cần sửa',          class: 'bg-orange-50 text-orange-700 border-orange-200' },
  DONE:               { label: 'Hoàn thành',        class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED:          { label: 'Đã hủy',            class: 'bg-zinc-50 text-zinc-400 border-zinc-200' },
}

const priorityMeta = {
  LOW:    { label: 'Thấp',      class: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
  MEDIUM: { label: 'Trung bình', class: 'bg-blue-50 text-blue-600 border-blue-200' },
  HIGH:   { label: 'Cao',        class: 'bg-amber-50 text-amber-700 border-amber-200' },
  URGENT: { label: 'Khẩn cấp',  class: 'bg-rose-50 text-rose-700 border-rose-200' },
}

const typeMeta = {
  INVITATION: 'Cuộc họp',
  DEADLINE:   'Deadline',
  DAILY:      'Hàng ngày',
}
const filterableStatusMeta = computed(() =>
  Object.fromEntries(Object.entries(statusMeta).filter(([status]) => status !== 'CANCELLED'))
)
const pageTitle = computed(() => {
  if (isDeptLeader.value) return 'Theo dõi tiến độ'
  if (isSpecialist.value) return 'Nhiệm vụ của tôi'
  return 'Nhiệm vụ'
})
const pageSubtitle = computed(() =>
  isDeptLeader.value
    ? 'Theo dõi các nhiệm vụ hợp lệ của chuyên viên trong phòng'
    : isSpecialist.value
      ? 'Thực hiện công việc được giao và gửi trưởng phòng duyệt'
      : 'Theo dõi vòng đời công việc và deadline'
)
const searchPlaceholder = computed(() => isDeptLeader.value ? 'Tìm tiến độ...' : 'Tìm nhiệm vụ...')
const completionRate = computed(() => (
  summary.value.total > 0
    ? Math.round((summary.value.done / summary.value.total) * 100)
    : 0
))
const progressCards = computed(() => [
  {
    key: 'total',
    label: 'Tổng nhiệm vụ',
    value: summary.value.total,
    detail: 'Nhiệm vụ hợp lệ',
    icon: CheckSquare,
    iconClass: 'bg-zinc-100 text-zinc-700',
  },
  {
    key: 'todo',
    label: 'Chờ xử lý',
    value: summary.value.todo,
    detail: 'Chưa bắt đầu',
    icon: ListTodo,
    iconClass: 'bg-blue-50 text-blue-700',
  },
  {
    key: 'inProgress',
    label: 'Đang xử lý',
    value: summary.value.inProgress,
    detail: 'Đang thực hiện',
    icon: Activity,
    iconClass: 'bg-amber-50 text-amber-700',
  },
  {
    key: 'pendingReview',
    label: 'Chờ duyệt',
    value: summary.value.pendingReview,
    detail: 'Cần trưởng phòng duyệt',
    icon: ClipboardCheck,
    iconClass: 'bg-violet-50 text-violet-700',
  },
  {
    key: 'done',
    label: 'Hoàn thành',
    value: summary.value.done,
    detail: `${completionRate.value}% tổng nhiệm vụ`,
    icon: CheckCircle,
    iconClass: 'bg-emerald-50 text-emerald-700',
  },
  {
    key: 'overdue',
    label: 'Quá hạn',
    value: summary.value.overdue,
    detail: 'Cần ưu tiên xử lý',
    icon: AlertTriangle,
    iconClass: 'bg-rose-50 text-rose-700',
  },
])

const isProgressCardActive = (key) => {
  if (key === 'overdue') return filterOverdue.value
  if (key === 'total') return filterStatus.value === 'ALL' && !filterOverdue.value
  const statusByKey = {
    todo: 'TODO',
    inProgress: 'IN_PROGRESS',
    pendingReview: 'PENDING_REVIEW',
    done: 'DONE',
  }
  return !filterOverdue.value && filterStatus.value === statusByKey[key]
}

const applyProgressFilter = (key) => {
  const statusByKey = {
    todo: 'TODO',
    inProgress: 'IN_PROGRESS',
    pendingReview: 'PENDING_REVIEW',
    done: 'DONE',
  }
  filterOverdue.value = key === 'overdue'
  filterStatus.value = statusByKey[key] ?? 'ALL'
  fetchTasks(1)
}

const toggleOverdueFilter = () => {
  filterOverdue.value = !filterOverdue.value
  if (filterOverdue.value) filterStatus.value = 'ALL'
  fetchTasks(1)
}

const applyStatusFilter = () => {
  filterOverdue.value = false
  fetchTasks(1)
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchTasks = async (page = 1) => {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page, limit: 20 })
    if (filterStatus.value !== 'ALL') params.set('status', filterStatus.value)
    if (filterType.value !== 'ALL')   params.set('type', filterType.value)
    if (filterSearch.value)           params.set('search', filterSearch.value)
    if (filterOverdue.value)          params.set('overdue', 'true')

    const res = await http(`${API}/tasks?${params}`)
    tasks.value = res.data
    pagination.value = res.pagination
    summary.value = {
      total: 0,
      todo: 0,
      inProgress: 0,
      pendingReview: 0,
      done: 0,
      overdue: 0,
      ...(res.summary ?? {}),
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => fetchTasks())

// ── Overdue helper ────────────────────────────────────────────────────────────
const isOverdue = (t) => t.dueAt && new Date(t.dueAt) < new Date() && !['DONE', 'CANCELLED'].includes(t.status)
const formatDate = (d) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'

// ── Create modal ──────────────────────────────────────────────────────────────
const showCreate = ref(false)
const creating = ref(false)
const departments = ref([])
const users = ref([])
const createForm = ref({ title: '', description: '', type: 'DEADLINE', priority: 'MEDIUM', departmentId: '', assignedToUserId: '', dueAt: '', estimatedMinutes: '' })

const openCreate = async () => {
  showCreate.value = true
  if (!departments.value.length) {
    try { const r = await http(`${API}/departments`); departments.value = r.data } catch {}
  }
}

const onDeptChange = async (deptId) => {
  createForm.value.assignedToUserId = ''
  if (!deptId || deptId === 'ALL') { users.value = []; return }
  try { const r = await http(`${API}/users?departmentId=${deptId}&role=SPECIALIST&limit=100`); users.value = r.data } catch {}
}

const submitCreate = async () => {
  if (!createForm.value.title || !createForm.value.type) return
  creating.value = true
  try {
    const payload = { ...createForm.value }
    if (!payload.departmentId || payload.departmentId === 'ALL') delete payload.departmentId
    if (!payload.assignedToUserId) delete payload.assignedToUserId
    if (!payload.dueAt) delete payload.dueAt
    if (!payload.estimatedMinutes) delete payload.estimatedMinutes
    await http(`${API}/tasks`, { method: 'POST', body: payload })
    showCreate.value = false
    createForm.value = { title: '', description: '', type: 'DEADLINE', priority: 'MEDIUM', departmentId: '', assignedToUserId: '', dueAt: '', estimatedMinutes: '' }
    fetchTasks()
  } catch (e) { error.value = e.message }
  finally { creating.value = false }
}

// ── Action handlers ───────────────────────────────────────────────────────────
const actionLoading = ref(null)

const doAction = async (taskId, endpoint, body = {}) => {
  actionLoading.value = `${taskId}-${endpoint}`
  try {
    await http(`${API}/tasks/${taskId}/${endpoint}`, { method: 'POST', body })
    fetchTasks()
  } catch (e) { error.value = e.message }
  finally { actionLoading.value = null }
}

const showSubmit = ref(false)
const submitTarget = ref(null)
const submitNote = ref('')

const openSubmit = (task) => {
  submitTarget.value = task
  submitNote.value = ''
  showSubmit.value = true
}

const submitForReview = async () => {
  if (!submitTarget.value) return
  actionLoading.value = `${submitTarget.value._id}-submit-review`
  try {
    await http(`${API}/tasks/${submitTarget.value._id}/submit-review`, {
      method: 'POST',
      body: { note: submitNote.value.trim() },
    })
    showSubmit.value = false
    fetchTasks()
  } catch (e) {
    error.value = e.message
  } finally {
    actionLoading.value = null
  }
}

// ── Review modal ──────────────────────────────────────────────────────────────
const showReview = ref(false)
const reviewTarget = ref(null)
const reviewForm = ref({ result: 'APPROVED', note: '', score: '' })

const openReview = (task) => {
  reviewTarget.value = task
  reviewForm.value = { result: 'APPROVED', note: '', score: '' }
  showReview.value = true
}

const submitReview = async () => {
  if (!reviewTarget.value) return
  actionLoading.value = `${reviewTarget.value._id}-review`
  try {
    const payload = { ...reviewForm.value }
    if (!payload.score) delete payload.score
    await http(`${API}/tasks/${reviewTarget.value._id}/review`, { method: 'POST', body: payload })
    showReview.value = false
    fetchTasks()
  } catch (e) { error.value = e.message }
  finally { actionLoading.value = null }
}

const showTimeEdit = ref(false)
const timeEditTarget = ref(null)
const timeEditForm = ref({ dueAt: '' })
const canEditOwnTaskTime = (task) => (
  isSpecialist.value
  && ['TODO', 'IN_PROGRESS', 'REVISION_REQUESTED'].includes(task.status)
  && !isOverdue(task)
)

const openTimeEdit = (task) => {
  timeEditTarget.value = task
  timeEditForm.value = { dueAt: task.dueAt ? String(task.dueAt).slice(0, 10) : '' }
  showTimeEdit.value = true
}

const submitTimeEdit = async () => {
  if (!timeEditTarget.value || !timeEditForm.value.dueAt) return
  actionLoading.value = `${timeEditTarget.value._id}-time`
  try {
    await http(`${API}/tasks/${timeEditTarget.value._id}`, {
      method: 'PATCH',
      body: { dueAt: timeEditForm.value.dueAt },
    })
    showTimeEdit.value = false
    fetchTasks()
  } catch (e) { error.value = e.message }
  finally { actionLoading.value = null }
}

const openTaskDetail = (task) => {
  if (!task?._id) return
  router.push(`/tasks/${task._id}`)
}
</script>

<template>
  <div class="h-full flex flex-col bg-zinc-50/40">

    <!-- Header -->
    <header class="px-6 pt-6 pb-4 flex items-center justify-between gap-4 flex-wrap border-b border-zinc-200/60 bg-white">
      <div>
        <h1 class="text-xl font-bold text-zinc-900 flex items-center gap-2">
          <CheckSquare class="w-5 h-5 text-indigo-600" /> {{ pageTitle }}
        </h1>
        <p class="text-sm text-zinc-500 mt-0.5">{{ pageSubtitle }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="toggleOverdueFilter"
                :class="['flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-bold border transition-colors',
                  filterOverdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300']">
          <AlertTriangle class="w-3.5 h-3.5" /> Quá hạn
        </button>
        <Button v-if="canCreateTask" @click="openCreate" class="rounded-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus class="w-4 h-4" /> Tạo nhiệm vụ
        </Button>
      </div>
    </header>

    <!-- Department progress summary -->
    <section v-if="isDeptLeader || isSpecialist" class="px-6 py-4 bg-zinc-50/70 border-b border-zinc-200/60">
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <button
          v-for="card in progressCards"
          :key="card.key"
          type="button"
          class="min-w-0 h-[104px] rounded-lg border bg-white px-3.5 py-3 text-left transition-colors hover:border-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          :class="isProgressCardActive(card.key) ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-zinc-200'"
          @click="applyProgressFilter(card.key)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-2xl font-bold text-zinc-900 tabular-nums">{{ card.value }}</p>
              <p class="mt-0.5 truncate text-xs font-bold text-zinc-700">{{ card.label }}</p>
            </div>
            <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-md', card.iconClass]">
              <component :is="card.icon" class="h-4 w-4" />
            </span>
          </div>
          <p class="mt-2 truncate text-[11px] text-zinc-400">{{ card.detail }}</p>
        </button>
      </div>
    </section>

    <!-- Filters -->
    <div class="px-6 py-3 flex items-center gap-3 flex-wrap bg-white border-b border-zinc-100">
      <div class="relative flex-1 min-w-[180px]">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
        <Input v-model="filterSearch" @input="fetchTasks()" :placeholder="searchPlaceholder" class="pl-9 h-9 rounded-full bg-zinc-50 border-zinc-200" />
      </div>
      <Select v-model="filterStatus" @update:modelValue="applyStatusFilter">
        <SelectTrigger class="w-44 h-9 rounded-full border-zinc-200 text-sm"><SelectValue placeholder="Trạng thái" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Tất cả</SelectItem>
          <SelectItem v-for="(m, k) in filterableStatusMeta" :key="k" :value="k">{{ m.label }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="filterType" @update:modelValue="fetchTasks()">
        <SelectTrigger class="w-36 h-9 rounded-full border-zinc-200 text-sm"><SelectValue placeholder="Loại" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Tất cả</SelectItem>
          <SelectItem v-for="(label, k) in typeMeta" :key="k" :value="k">{{ label }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Error -->
    <div v-if="error" class="mx-6 mt-3 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 font-medium flex items-center justify-between">
      {{ error }}
      <button @click="error = null"><X class="w-4 h-4" /></button>
    </div>

    <!-- Table -->
    <div class="flex-1 overflow-auto px-6 py-4">
      <div class="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">

        <div v-if="loading" class="flex items-center justify-center py-16 gap-2 text-zinc-400">
          <Loader2 class="w-5 h-5 animate-spin" /> Đang tải...
        </div>

        <div v-else-if="!tasks.length" class="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
          <CheckSquare class="w-12 h-12 text-zinc-200" />
          <p class="text-sm font-medium">Chưa có nhiệm vụ nào</p>
        </div>

        <table v-else class="w-full text-sm">
          <thead class="bg-zinc-50/60 border-b border-zinc-100">
            <tr>
              <th class="text-left px-5 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Tiêu đề</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden md:table-cell">Loại</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden lg:table-cell">Người nhận</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden lg:table-cell">Ưu tiên</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Trạng thái</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden lg:table-cell">Hạn</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-50">
            <tr v-for="task in tasks" :key="task._id"
                class="hover:bg-zinc-50/50 transition-colors group cursor-pointer"
                :class="{ 'bg-rose-50/30': isOverdue(task) }">

              <td class="px-5 py-3.5 max-w-[260px]" @click="openTaskDetail(task)">
                <p class="font-semibold text-zinc-900 truncate">{{ task.title }}</p>
                <p v-if="task.sourceDocument" class="text-[11px] text-zinc-400 mt-0.5 truncate">
                  VB: {{ task.sourceDocument.documentNumber }}
                </p>
              </td>

              <td class="px-4 py-3.5 hidden md:table-cell" @click="openTaskDetail(task)">
                <span class="text-xs font-semibold text-zinc-500">{{ typeMeta[task.type] ?? task.type }}</span>
              </td>

              <td class="px-4 py-3.5 hidden lg:table-cell text-xs text-zinc-600 font-medium" @click="openTaskDetail(task)">
                {{ task.assignedTo?.fullName ?? '—' }}
              </td>

              <td class="px-4 py-3.5 hidden lg:table-cell" @click="openTaskDetail(task)">
                <span v-if="task.priority" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
                      :class="priorityMeta[task.priority]?.class">
                  {{ priorityMeta[task.priority]?.label }}
                </span>
              </td>

              <td class="px-4 py-3.5" @click="openTaskDetail(task)">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                      :class="statusMeta[task.status]?.class">
                  {{ statusMeta[task.status]?.label ?? task.status }}
                </span>
                <span v-if="isOverdue(task)" class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                  QUÁ HẠN
                </span>
              </td>

              <td class="px-4 py-3.5 hidden lg:table-cell text-xs whitespace-nowrap"
                  @click="openTaskDetail(task)"
                  :class="isOverdue(task) ? 'text-rose-600 font-semibold' : 'text-zinc-500'">
                <span class="flex items-center gap-1">
                  <Clock v-if="task.dueAt" class="w-3 h-3" />
                  {{ formatDate(task.dueAt) }}
                </span>
              </td>

              <!-- Actions -->
              <td class="px-4 py-3.5 whitespace-nowrap">
                <div class="flex items-center gap-1">
                  <Button
                    @click.stop="openTaskDetail(task)"
                    size="sm"
                    variant="ghost"
                    class="h-7 rounded-full text-[11px] font-bold px-3 text-zinc-600 hover:bg-zinc-100 gap-1">
                    <Eye class="w-3 h-3" /> Chi tiết
                  </Button>

                  <!-- Start (SPECIALIST, TODO) -->
                  <Button v-if="canUseSpecialistActions && task.status === 'TODO'"
                          @click.stop="doAction(task._id, 'start')" size="sm"
                          :disabled="actionLoading === `${task._id}-start`"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-amber-50 text-amber-700 hover:bg-amber-100 border-0 gap-1">
                    <Loader2 v-if="actionLoading === `${task._id}-start`" class="w-3 h-3 animate-spin" />
                    <Play v-else class="w-3 h-3" /> Bắt đầu
                  </Button>

                  <Button v-if="canUseSpecialistActions && task.status === 'REVISION_REQUESTED'"
                          @click.stop="doAction(task._id, 'start')" size="sm"
                          :disabled="actionLoading === `${task._id}-start`"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-orange-50 text-orange-700 hover:bg-orange-100 border-0 gap-1">
                    <Loader2 v-if="actionLoading === `${task._id}-start`" class="w-3 h-3 animate-spin" />
                    <Play v-else class="w-3 h-3" /> Tiếp tục sửa
                  </Button>

                  <Button v-if="canEditOwnTaskTime(task)"
                          @click.stop="openTimeEdit(task)" size="sm"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 border-0 gap-1">
                    <Clock class="w-3 h-3" /> Đổi hạn
                  </Button>

                  <!-- Submit review (SPECIALIST, IN_PROGRESS) -->
                  <Button v-if="canUseSpecialistActions && task.status === 'IN_PROGRESS'"
                          @click.stop="openSubmit(task)" size="sm"
                          :disabled="!!actionLoading"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-violet-50 text-violet-700 hover:bg-violet-100 border-0 gap-1">
                    <Loader2 v-if="actionLoading === `${task._id}-submit-review`" class="w-3 h-3 animate-spin" />
                    <SendHorizontal v-else class="w-3 h-3" /> Nộp duyệt
                  </Button>

                  <!-- Review (LEADER, PENDING_REVIEW) -->
                  <Button v-if="canReviewTask && task.status === 'PENDING_REVIEW'"
                          @click.stop="openReview(task)" size="sm"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-0 gap-1">
                    <CheckCircle class="w-3 h-3" /> Duyệt
                  </Button>

                  <!-- Cancel -->
                  <Button v-if="canCancelTask(task) && !['DONE', 'CANCELLED'].includes(task.status)"
                          @click.stop="doAction(task._id, 'cancel')" size="sm" variant="ghost"
                          :disabled="!!actionLoading"
                          class="h-7 w-7 rounded-full p-0 text-zinc-400 hover:text-rose-600">
                    <Loader2 v-if="actionLoading === `${task._id}-cancel`" class="w-3 h-3 animate-spin" />
                    <XCircle v-else class="w-3.5 h-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Pagination -->
        <div v-if="pagination.totalPages > 1" class="px-5 py-3 border-t border-zinc-100 flex items-center justify-between text-sm text-zinc-500">
          <span>{{ pagination.total }} nhiệm vụ</span>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="h-8 rounded-full" :disabled="pagination.page <= 1" @click="fetchTasks(pagination.page - 1)">Trước</Button>
            <span class="text-xs font-semibold">{{ pagination.page }} / {{ pagination.totalPages }}</span>
            <Button variant="outline" size="sm" class="h-8 rounded-full" :disabled="pagination.page >= pagination.totalPages" @click="fetchTasks(pagination.page + 1)">Sau</Button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Create Task Modal ──────────────────────────────────────────── -->
    <Dialog v-model:open="showCreate">
      <DialogContent class="rounded-3xl max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><CheckSquare class="w-5 h-5 text-indigo-600" /> Tạo nhiệm vụ mới</DialogTitle>
        </DialogHeader>
        <div class="grid gap-4 py-2">
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Tiêu đề *</span>
            <Input v-model="createForm.title" placeholder="Tên nhiệm vụ..." class="rounded-xl" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Loại *</span>
              <Select v-model="createForm.type">
                <SelectTrigger class="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="(label, k) in typeMeta" :key="k" :value="k">{{ label }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Ưu tiên</span>
              <Select v-model="createForm.priority">
                <SelectTrigger class="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="(m, k) in priorityMeta" :key="k" :value="k">{{ m.label }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Phòng ban</span>
              <Select v-model="createForm.departmentId" @update:modelValue="onDeptChange">
                <SelectTrigger class="rounded-xl"><SelectValue placeholder="Chọn phòng..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="d in departments" :key="d._id" :value="d._id">{{ d.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Người nhận</span>
              <Select v-model="createForm.assignedToUserId" :disabled="!users.length">
                <SelectTrigger class="rounded-xl"><SelectValue placeholder="Chọn người..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="u in users" :key="u._id" :value="u._id">{{ u.fullName }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Hạn xử lý</span>
              <Input v-model="createForm.dueAt" type="date" class="rounded-xl" />
            </div>
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Thời gian (phút)</span>
              <Input v-model="createForm.estimatedMinutes" type="number" placeholder="480" class="rounded-xl" />
            </div>
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Mô tả</span>
            <Textarea v-model="createForm.description" placeholder="Mô tả chi tiết..." class="resize-none h-20 rounded-xl" />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showCreate = false" class="rounded-full">Hủy</Button>
          <Button @click="submitCreate" :disabled="!createForm.title || creating"
                  class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
            <Loader2 v-if="creating" class="w-4 h-4 animate-spin" />
            Tạo nhiệm vụ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ── Specialist Time Edit Modal ────────────────────────────────── -->
    <Dialog v-model:open="showTimeEdit">
      <DialogContent class="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><Clock class="w-5 h-5 text-zinc-600" /> Đổi hạn hoàn thành</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <p class="text-sm text-zinc-500 bg-zinc-50 rounded-xl px-4 py-2.5 font-medium">{{ timeEditTarget?.title }}</p>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Deadline mới *</span>
            <Input v-model="timeEditForm.dueAt" type="date" class="rounded-xl" />
            <p class="text-xs text-zinc-400">Deadline mới phải trước hoặc bằng deadline hiện tại.</p>
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showTimeEdit = false" class="rounded-full">Hủy</Button>
          <Button @click="submitTimeEdit" :disabled="!timeEditForm.dueAt || !!actionLoading"
                  class="rounded-full bg-zinc-900 hover:bg-zinc-700 text-white gap-2">
            <Loader2 v-if="actionLoading === `${timeEditTarget?._id}-time`" class="w-4 h-4 animate-spin" />
            Lưu deadline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ── Specialist Submit Review Modal ─────────────────────────────── -->
    <Dialog v-model:open="showSubmit">
      <DialogContent class="rounded-2xl max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <SendHorizontal class="w-5 h-5 text-violet-600" /> Nộp kết quả xử lý
          </DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <p class="rounded-lg bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-600">
            {{ submitTarget?.title }}
          </p>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Ghi chú kết quả</span>
            <Textarea
              v-model="submitNote"
              placeholder="Mô tả nội dung đã hoàn thành..."
              class="resize-none h-24 rounded-lg"
            />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" class="rounded-full" @click="showSubmit = false">Hủy</Button>
          <Button
            class="rounded-full bg-violet-600 hover:bg-violet-700 text-white gap-2"
            :disabled="Boolean(actionLoading)"
            @click="submitForReview"
          >
            <Loader2 v-if="actionLoading === `${submitTarget?._id}-submit-review`" class="w-4 h-4 animate-spin" />
            Gửi trưởng phòng duyệt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ── Review Modal ───────────────────────────────────────────────── -->
    <Dialog v-model:open="showReview">
      <DialogContent class="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><CheckCircle class="w-5 h-5 text-emerald-600" /> Duyệt nhiệm vụ</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <p class="text-sm text-zinc-500 bg-zinc-50 rounded-xl px-4 py-2.5 font-medium">{{ reviewTarget?.title }}</p>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Kết quả *</span>
            <Select v-model="reviewForm.result">
              <SelectTrigger class="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">✅ Chấp thuận</SelectItem>
                <SelectItem value="RETURNED">↩️ Trả lại</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="reviewForm.result === 'APPROVED'" class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Điểm (0–100)</span>
            <Input v-model="reviewForm.score" type="number" min="0" max="100" placeholder="90" class="rounded-xl" />
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Nhận xét</span>
            <Textarea v-model="reviewForm.note" placeholder="Nhận xét..." class="resize-none h-20 rounded-xl" />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showReview = false" class="rounded-full">Hủy</Button>
          <Button @click="submitReview" :disabled="!!actionLoading"
                  :class="['rounded-full gap-2', reviewForm.result === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-500 hover:bg-orange-600', 'text-white']">
            <Loader2 v-if="actionLoading" class="w-4 h-4 animate-spin" />
            {{ reviewForm.result === 'APPROVED' ? 'Chấp thuận' : 'Trả lại' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>
</template>
