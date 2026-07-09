<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { http } from '@/shared/api/http'
import { Clock, Plus, Send, CheckCircle, XCircle, Trash2, Loader2, X, BarChart3 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/composables/useAuth'

const API = '/api'
const { user } = useAuth()
const roleCode = computed(() => user.value?.role?.code)
const canViewMy = computed(() => roleCode.value === 'SPECIALIST')
const canViewDept = computed(() => roleCode.value === 'DEPARTMENT_LEADER')

// ── State ─────────────────────────────────────────────────────────────────────
const mode = ref('my')   // 'my' | 'dept'
const today = new Date().toISOString().slice(0, 10)
const selectedDate = ref(today)

const myTs = ref(null)        // current user's timesheet
const deptList = ref([])      // dept leader view
const pagination = ref({ page: 1, totalPages: 1, total: 0 })
const loading = ref(false)
const error = ref(null)

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMy = async () => {
  loading.value = true; error.value = null
  try {
    const res = await http(`${API}/timesheets/my?date=${selectedDate.value}`)
    myTs.value = res.data
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}

const fetchDept = async (page = 1) => {
  loading.value = true; error.value = null
  try {
    const res = await http(`${API}/timesheets/department?date=${selectedDate.value}&page=${page}&limit=20`)
    deptList.value = res.data
    pagination.value = res.pagination
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}

const fetch = () => {
  if (!roleCode.value) return
  if (mode.value === 'my') {
    if (!canViewMy.value) return
    return fetchMy()
  }
  if (!canViewDept.value) return
  return fetchDept()
}
const syncModeToRole = () => {
  if (canViewDept.value && !canViewMy.value) mode.value = 'dept'
  else if (canViewMy.value) mode.value = 'my'
}

onMounted(() => {
  syncModeToRole()
  fetch()
})

watch(roleCode, () => {
  syncModeToRole()
  fetch()
})

// ── Create / open today sheet ──────────────────────────────────────────────────
const creating = ref(false)
const openSheet = async () => {
  creating.value = true
  try {
    const res = await http(`${API}/timesheets`, { method: 'POST', body: { date: selectedDate.value } })
    myTs.value = res.data
  } catch (e) { error.value = e.message }
  finally { creating.value = false }
}

// ── Status meta ───────────────────────────────────────────────────────────────
const statusMeta = {
  DRAFT:     { label: 'Nháp',        class: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  SUBMITTED: { label: 'Đã nộp',      class: 'bg-blue-50 text-blue-700 border-blue-200' },
  APPROVED:  { label: 'Đã duyệt',    class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  RETURNED:  { label: 'Trả lại',     class: 'bg-orange-50 text-orange-700 border-orange-200' },
}

// ── Progress bar ──────────────────────────────────────────────────────────────
const capacityPct = computed(() => {
  if (!myTs.value) return 0
  return Math.min(Math.round((myTs.value.totalEstimatedMinutes / myTs.value.capacityMinutes) * 100), 100)
})

const fmtMinutes = (m) => {
  const h = Math.floor(m / 60), min = m % 60
  return min ? `${h}g${min}p` : `${h}g`
}

// ── Add entry modal ────────────────────────────────────────────────────────────
const showAdd = ref(false)
const addForm = ref({ title: '', note: '', estimatedMinutes: 60, taskId: '' })
const myTasks = ref([])
const adding = ref(false)
const remainingMinutes = computed(() => (myTs.value?.capacityMinutes ?? 480) - (myTs.value?.totalEstimatedMinutes ?? 0))
const entryMinutesError = computed(() => {
  const minutes = Number(addForm.value.estimatedMinutes)
  if (!Number.isInteger(minutes) || minutes < 15) return 'Thời gian mỗi mục tối thiểu 15 phút.'
  if (minutes > remainingMinutes.value) return 'Tổng thời gian trong ngày không được vượt quá 8 giờ.'
  return ''
})

const openAdd = async () => {
  showAdd.value = true
  addForm.value = { title: '', note: '', estimatedMinutes: 60, taskId: '' }
  if (!myTasks.value.length) {
    try {
      const r = await http(`${API}/tasks?assignedToMe=true&status=IN_PROGRESS&limit=50`)
      myTasks.value = r.data
    } catch {}
  }
}

const onTaskChange = (taskId) => {
  const task = myTasks.value.find(t => t._id === taskId)
  if (task && !addForm.value.title) addForm.value.title = task.title
}

const submitAdd = async () => {
  if (!addForm.value.title || !addForm.value.estimatedMinutes) return
  if (entryMinutesError.value) return
  adding.value = true
  try {
    const payload = { ...addForm.value }
    if (!payload.taskId) delete payload.taskId
    if (!payload.note) delete payload.note
    const res = await http(`${API}/timesheets/${myTs.value._id}/entries`, { method: 'POST', body: payload })
    myTs.value = res.data
    showAdd.value = false
  } catch (e) { error.value = e.message }
  finally { adding.value = false }
}

// ── Delete entry ───────────────────────────────────────────────────────────────
const deleteEntry = async (entryId) => {
  if (!myTs.value) return
  try {
    const res = await http(`${API}/timesheets/${myTs.value._id}/entries/${entryId}`, { method: 'DELETE' })
    myTs.value = res.data
  } catch (e) { error.value = e.message }
}

// ── Submit ────────────────────────────────────────────────────────────────────
const submitting = ref(false)
const submitSheet = async () => {
  if (!myTs.value) return
  submitting.value = true
  try {
    const res = await http(`${API}/timesheets/${myTs.value._id}/submit`, { method: 'POST' })
    myTs.value = res.data
  } catch (e) { error.value = e.message }
  finally { submitting.value = false }
}

// ── Review modal (dept leader) ────────────────────────────────────────────────
const showReview = ref(false)
const reviewTarget = ref(null)
const reviewForm = ref({ result: 'APPROVED', note: '' })
const reviewing = ref(false)

const openReview = (ts) => { reviewTarget.value = ts; reviewForm.value = { result: 'APPROVED', note: '' }; showReview.value = true }

const submitReview = async () => {
  if (!reviewTarget.value) return
  reviewing.value = true
  try {
    const payload = { ...reviewForm.value }
    if (!payload.note) delete payload.note
    await http(`${API}/timesheets/${reviewTarget.value._id}/review`, { method: 'POST', body: payload })
    showReview.value = false
    fetchDept()
  } catch (e) { error.value = e.message }
  finally { reviewing.value = false }
}
</script>

<template>
  <div class="h-full flex flex-col bg-zinc-50/40">

    <!-- Header -->
    <header class="px-6 pt-6 pb-4 border-b border-zinc-200/60 bg-white flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-xl font-bold text-zinc-900 flex items-center gap-2">
          <Clock class="w-5 h-5 text-indigo-600" /> Chấm công
        </h1>
        <p class="text-sm text-zinc-500 mt-0.5">Theo dõi thời gian làm việc theo ngày</p>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <div v-if="canViewMy || canViewDept" class="flex rounded-full border border-zinc-200 bg-white p-1 gap-1">
          <button v-for="m in [{ val: 'my', label: 'Của tôi', show: canViewMy }, { val: 'dept', label: 'Phòng ban', show: canViewDept }].filter(item => item.show)" :key="m.val"
                  @click="mode = m.val; fetch()"
                  :class="['px-4 py-1.5 rounded-full text-xs font-bold transition-all', mode === m.val ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900']">
            {{ m.label }}
          </button>
        </div>
        <Input type="date" v-model="selectedDate" @change="fetch()" class="h-9 w-40 rounded-full text-sm border-zinc-200" />
      </div>
    </header>

    <!-- Error -->
    <div v-if="error" class="mx-6 mt-3 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 font-medium flex items-center justify-between">
      {{ error }}<button @click="error = null"><X class="w-4 h-4" /></button>
    </div>

    <!-- ── MY VIEW ─────────────────────────────────────────────────── -->
    <div v-if="mode === 'my'" class="flex-1 overflow-auto px-6 py-4 space-y-4">

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-16 gap-2 text-zinc-400">
        <Loader2 class="w-5 h-5 animate-spin" /> Đang tải...
      </div>

      <!-- No sheet yet -->
      <div v-else-if="!myTs" class="flex flex-col items-center justify-center py-16 gap-4 text-zinc-400">
        <Clock class="w-14 h-14 text-zinc-200" />
        <p class="text-sm font-medium">Chưa có chấm công ngày {{ selectedDate }}</p>
        <Button @click="openSheet" :disabled="creating" class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
          <Loader2 v-if="creating" class="w-4 h-4 animate-spin" />
          <Plus v-else class="w-4 h-4" /> Tạo chấm công
        </Button>
      </div>

      <template v-else>
        <!-- Sheet summary card -->
        <div class="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5">
          <div class="flex items-center justify-between gap-4 flex-wrap">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <BarChart3 class="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p class="text-xs font-bold text-zinc-400 uppercase tracking-wide">Tổng thời gian</p>
                <p class="text-2xl font-extrabold text-zinc-900">{{ fmtMinutes(myTs.totalEstimatedMinutes) }}
                  <span class="text-sm font-semibold text-zinc-400">/ {{ fmtMinutes(myTs.capacityMinutes) }}</span>
                </p>
              </div>
            </div>
            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                  :class="statusMeta[myTs.status]?.class">
              {{ statusMeta[myTs.status]?.label }}
            </span>
          </div>

          <!-- Progress bar -->
          <div class="mt-4">
            <div class="h-2.5 w-full bg-zinc-100 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500"
                   :class="capacityPct >= 100 ? 'bg-rose-500' : capacityPct >= 80 ? 'bg-amber-500' : 'bg-indigo-500'"
                   :style="{ width: `${capacityPct}%` }"></div>
            </div>
            <p class="text-xs text-zinc-400 mt-1.5 font-medium">{{ capacityPct }}% công suất ngày</p>
          </div>

          <!-- Actions -->
          <div v-if="myTs.status === 'DRAFT'" class="mt-4 flex items-center gap-2">
            <Button @click="openAdd" class="rounded-full h-9 text-sm bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
              <Plus class="w-4 h-4" /> Thêm công việc
            </Button>
            <Button v-if="myTs.entries?.length" @click="submitSheet" :disabled="submitting"
                    class="rounded-full h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
              <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
              <Send v-else class="w-4 h-4" /> Nộp chấm công
            </Button>
          </div>
          <div v-else-if="myTs.status === 'RETURNED'" class="mt-4">
            <p class="text-sm text-orange-700 bg-orange-50 rounded-xl px-4 py-2.5 font-medium">
              ↩️ Trả lại: {{ myTs.reviewNote ?? 'Cần chỉnh sửa lại.' }}
            </p>
          </div>
        </div>

        <!-- Entries list -->
        <div class="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
            <p class="text-sm font-bold text-zinc-900">Danh sách công việc</p>
            <span class="text-xs font-bold text-zinc-400">{{ myTs.entries?.length ?? 0 }} mục</span>
          </div>
          <div v-if="!myTs.entries?.length" class="py-12 flex items-center justify-center text-sm text-zinc-400">
            Chưa có công việc nào
          </div>
          <ul v-else class="divide-y divide-zinc-50">
            <li v-for="entry in myTs.entries" :key="entry._id"
                class="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-50/50 transition-colors group">
              <div class="w-2.5 h-2.5 rounded-full shrink-0"
                   :class="entry.status === 'DONE' ? 'bg-emerald-400' : 'bg-indigo-300'"></div>
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-zinc-900 text-sm truncate">{{ entry.title }}</p>
                <p v-if="entry.note" class="text-xs text-zinc-400 mt-0.5 truncate">{{ entry.note }}</p>
                <p v-if="entry.task" class="text-xs text-indigo-500 font-medium mt-0.5">
                  Task: {{ entry.task.title }}
                </p>
              </div>
              <span class="text-xs font-bold text-zinc-500 shrink-0 tabular-nums">
                {{ fmtMinutes(entry.estimatedMinutes) }}
              </span>
              <button v-if="myTs.status === 'DRAFT'"
                      @click="deleteEntry(entry._id)"
                      class="text-zinc-300 transition-colors hover:text-rose-500">
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <!-- ── DEPT VIEW ──────────────────────────────────────────────────── -->
    <div v-else class="flex-1 overflow-auto px-6 py-4">
      <div class="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
        <div v-if="loading" class="flex items-center justify-center py-16 gap-2 text-zinc-400">
          <Loader2 class="w-5 h-5 animate-spin" /> Đang tải...
        </div>
        <div v-else-if="!deptList.length" class="flex flex-col items-center justify-center py-14 text-zinc-400 gap-3">
          <Clock class="w-12 h-12 text-zinc-200" />
          <p class="text-sm font-medium">Chưa có chấm công ngày này</p>
        </div>
        <table v-else class="w-full text-sm">
          <thead class="bg-zinc-50/60 border-b border-zinc-100">
            <tr>
              <th class="text-left px-5 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Nhân viên</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden md:table-cell">Ngày</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Thời gian</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Trạng thái</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-50">
            <tr v-for="ts in deptList" :key="ts._id" class="hover:bg-zinc-50/50 transition-colors group">
              <td class="px-5 py-3.5">
                <p class="font-semibold text-zinc-900">{{ ts.user?.fullName ?? '—' }}</p>
                <p class="text-xs text-zinc-400 mt-0.5">{{ ts.user?.email }}</p>
              </td>
              <td class="px-4 py-3.5 hidden md:table-cell text-xs text-zinc-500 font-medium">{{ ts.date }}</td>
              <td class="px-4 py-3.5">
                <div>
                  <p class="text-sm font-bold text-zinc-900">{{ fmtMinutes(ts.totalEstimatedMinutes) }}</p>
                  <div class="h-1.5 w-24 bg-zinc-100 rounded-full mt-1 overflow-hidden">
                    <div class="h-full rounded-full bg-indigo-400"
                         :style="{ width: `${Math.min(Math.round(ts.totalEstimatedMinutes / ts.capacityMinutes * 100), 100)}%` }"></div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3.5">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                      :class="statusMeta[ts.status]?.class">
                  {{ statusMeta[ts.status]?.label ?? ts.status }}
                </span>
              </td>
              <td class="px-4 py-3.5">
                <Button v-if="ts.status === 'SUBMITTED'" @click="openReview(ts)" size="sm"
                        class="h-7 rounded-full text-[11px] font-bold px-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-0 gap-1">
                  <CheckCircle class="w-3 h-3" /> Duyệt
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="pagination.totalPages > 1" class="px-5 py-3 border-t border-zinc-100 flex items-center justify-between text-sm text-zinc-500">
          <span>{{ pagination.total }} bản ghi</span>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="h-8 rounded-full" :disabled="pagination.page <= 1" @click="fetchDept(pagination.page - 1)">Trước</Button>
            <span class="text-xs font-semibold">{{ pagination.page }} / {{ pagination.totalPages }}</span>
            <Button variant="outline" size="sm" class="h-8 rounded-full" :disabled="pagination.page >= pagination.totalPages" @click="fetchDept(pagination.page + 1)">Sau</Button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Add Entry Modal ──────────────────────────────────────────── -->
    <Dialog v-model:open="showAdd">
      <DialogContent class="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><Plus class="w-5 h-5 text-indigo-600" /> Thêm công việc</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Nhiệm vụ liên kết</span>
            <Select v-model="addForm.taskId" @update:modelValue="onTaskChange">
              <SelectTrigger class="rounded-xl"><SelectValue placeholder="Chọn task (tuỳ chọn)" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="t in myTasks" :key="t._id" :value="t._id">{{ t.title }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Tên công việc *</span>
            <Input v-model="addForm.title" placeholder="Mô tả công việc..." class="rounded-xl" />
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Thời gian (phút) *</span>
            <Input v-model.number="addForm.estimatedMinutes" type="number" min="15" step="15" placeholder="60" class="rounded-xl" />
            <p class="text-xs text-zinc-400">Tối thiểu 15 phút. Còn lại: {{ fmtMinutes(remainingMinutes) }}</p>
            <p v-if="entryMinutesError" class="text-xs text-rose-600 font-semibold">{{ entryMinutesError }}</p>
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Ghi chú</span>
            <Textarea v-model="addForm.note" placeholder="Ghi chú..." class="resize-none h-16 rounded-xl" />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showAdd = false" class="rounded-full">Hủy</Button>
          <Button @click="submitAdd" :disabled="!addForm.title || !addForm.estimatedMinutes || !!entryMinutesError || adding"
                  class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
            <Loader2 v-if="adding" class="w-4 h-4 animate-spin" />
            Thêm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ── Review Modal ─────────────────────────────────────────────── -->
    <Dialog v-model:open="showReview">
      <DialogContent class="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><CheckCircle class="w-5 h-5 text-emerald-600" /> Duyệt chấm công</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <p class="text-sm bg-zinc-50 rounded-xl px-4 py-2.5 font-medium text-zinc-700">
            {{ reviewTarget?.user?.fullName }} — {{ reviewTarget?.date }} — {{ fmtMinutes(reviewTarget?.totalEstimatedMinutes ?? 0) }}
          </p>
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
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Nhận xét</span>
            <Textarea v-model="reviewForm.note" placeholder="Nhận xét (tuỳ chọn)..." class="resize-none h-16 rounded-xl" />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showReview = false" class="rounded-full">Hủy</Button>
          <Button @click="submitReview" :disabled="reviewing"
                  :class="['rounded-full gap-2 text-white', reviewForm.result === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-500 hover:bg-orange-600']">
            <Loader2 v-if="reviewing" class="w-4 h-4 animate-spin" />
            {{ reviewForm.result === 'APPROVED' ? 'Chấp thuận' : 'Trả lại' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>
</template>
