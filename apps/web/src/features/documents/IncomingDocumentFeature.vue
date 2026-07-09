<script setup>
import { ref, computed, onMounted } from 'vue'
import { http } from '@/shared/api/http'
import { FileText, Plus, Search, X, UserCheck, Building2, CheckCircle, Loader2, Paperclip, Upload, Trash2, FileIcon, RefreshCw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarDate, parseDate, getLocalTimeZone, today as rekaToday } from '@internationalized/date'
import { CalendarIcon } from 'lucide-vue-next'
import SlidingTabs from '@/components/ui/sliding-tabs/SlidingTabs.vue'
import { useAuth } from '@/features/auth/composables/useAuth'

const API = '/api'
const today = new Date().toISOString().slice(0, 10)
const UNASSIGNED_FILE_OWNER = '__UNASSIGNED__'

const { user } = useAuth()
const roleCode = computed(() => user.value?.role?.code)
const isOfficeChief = computed(() => roleCode.value === 'OFFICE_CHIEF' || roleCode.value === 'ADMIN')
const isDeptLeader = computed(() => roleCode.value === 'DEPARTMENT_LEADER')
const isSpecialist = computed(() => roleCode.value === 'SPECIALIST')
const canCreateDocument = computed(() => isOfficeChief.value)
const canAssignDepartment = computed(() => isOfficeChief.value)
const canAssignUser = computed(() => isDeptLeader.value)
const canCompleteDocument = computed(() => isOfficeChief.value || isDeptLeader.value)
const canManageAttachments = computed(() => isOfficeChief.value || isSpecialist.value)

// ── State ────────────────────────────────────────────────────────────────────
const documents = ref([])
const pagination = ref({ page: 1, limit: 20, total: 0, totalPages: 1 })
const loading = ref(false)
const error = ref(null)

const filterStatus = ref('ALL')
const filterPriority = ref('ALL')
const filterSearch = ref('')

// ── Status / Priority meta ────────────────────────────────────────────────────
const statusMeta = {
  DRAFT:                  { label: 'Nháp',             class: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  RECEIVED:               { label: 'Đã nhận',          class: 'bg-blue-50 text-blue-700 border-blue-200' },
  ASSIGNED_TO_DEPARTMENT: { label: 'Giao phòng ban',   class: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ASSIGNED_TO_USER:       { label: 'Giao chuyên viên', class: 'bg-violet-50 text-violet-700 border-violet-200' },
  IN_PROGRESS:            { label: 'Đang xử lý',       class: 'bg-amber-50 text-amber-700 border-amber-200' },
  COMPLETED:              { label: 'Hoàn thành',        class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ARCHIVED:               { label: 'Lưu trữ',           class: 'bg-zinc-50 text-zinc-400 border-zinc-200' },
}

const priorityMeta = {
  LOW:    { label: 'Thấp',      class: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
  MEDIUM: { label: 'Trung bình', class: 'bg-blue-50 text-blue-600 border-blue-200' },
  HIGH:   { label: 'Cao',        class: 'bg-amber-50 text-amber-700 border-amber-200' },
  URGENT: { label: 'Khẩn cấp',  class: 'bg-rose-50 text-rose-700 border-rose-200' },
}

// ── Fetch list ────────────────────────────────────────────────────────────────
const fetchDocuments = async (page = 1) => {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page, limit: 20 })
    if (filterStatus.value && filterStatus.value !== 'ALL')   params.set('status', filterStatus.value)
    if (filterPriority.value && filterPriority.value !== 'ALL') params.set('priority', filterPriority.value)
    if (filterSearch.value)   params.set('search', filterSearch.value)

    const res = await http(`${API}/incoming-documents?${params}`)
    documents.value = res.data
    pagination.value = res.pagination
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchDocuments)

// ── Create modal ──────────────────────────────────────────────────────────────
const showCreate = ref(false)
const creating = ref(false)
const createForm = ref({ documentNumber: '', title: '', summary: '', sender: '', category: '', priority: 'MEDIUM', dueAt: today })

// Calendar date value (DateValue object for shadcn Calendar)
const calendarValue = computed({
  get: () => createForm.value.dueAt ? parseDate(createForm.value.dueAt) : rekaToday(getLocalTimeZone()),
  set: (val) => { if (val) createForm.value.dueAt = val.toString() },
})
const calendarOpen = ref(false)
const onCalendarSelect = (val) => {
  if (val) { createForm.value.dueAt = val.toString(); calendarOpen.value = false }
}

const assignUserCalendarValue = computed({
  get: () => assignUserForm.value.dueAt ? parseDate(assignUserForm.value.dueAt) : rekaToday(getLocalTimeZone()),
  set: (val) => { if (val) assignUserForm.value.dueAt = val.toString() },
})
const assignUserCalendarOpen = ref(false)
const onAssignUserCalendarSelect = (val) => {
  if (val) { assignUserForm.value.dueAt = val.toString(); assignUserCalendarOpen.value = false }
}

const submitCreate = async () => {
  if (!createForm.value.documentNumber || !createForm.value.title) return
  creating.value = true
  try {
    await http(`${API}/incoming-documents`, { method: 'POST', body: createForm.value })
    showCreate.value = false
    createForm.value = { documentNumber: '', title: '', summary: '', sender: '', category: '', priority: 'MEDIUM', dueAt: today }
    fetchDocuments()
  } catch (e) { error.value = e.message }
  finally { creating.value = false }
}

// ── Assign Department modal ───────────────────────────────────────────────────
const showAssignDept = ref(false)
const assignDeptTarget = ref(null)
const assignDeptForm = ref({ departmentId: '', note: '' })
const assigning = ref(false)
const departments = ref([])

const openAssignDept = async (doc) => {
  assignDeptTarget.value = doc
  // Pre-fill department hiện tại nếu đang đổi phòng
  const currentDeptId = doc.currentDepartment?._id ?? doc.currentDepartment ?? ''
  assignDeptForm.value = { departmentId: currentDeptId, note: '' }
  showAssignDept.value = true
  if (!departments.value.length) {
    try {
      const res = await http(`${API}/departments`)
      departments.value = res.data
    } catch {}
  }
}

const submitAssignDept = async () => {
  if (!assignDeptForm.value.departmentId) return
  assigning.value = true
  try {
    await http(`${API}/incoming-documents/${assignDeptTarget.value._id}/assign-department`, {
      method: 'POST', body: assignDeptForm.value,
    })
    showAssignDept.value = false
    fetchDocuments()
  } catch (e) { error.value = e.message }
  finally { assigning.value = false }
}

// ── Assign User modal ─────────────────────────────────────────────────────────
const showAssignUser = ref(false)
const assignUserTarget = ref(null)
const assignUserForm = ref({ userIds: [], fileOwners: {}, estimatedMinutes: 60, dueAt: '', note: '' })
const users = ref([])

const categoryOf = (attachment) => attachment?.metadata?.category ?? attachment?.category ?? 'DECISION'
const idOf = (value) => value?._id ?? value
const workAttachmentsForAssign = computed(() =>
  (assignUserTarget.value?.attachments ?? []).filter((attachment) => categoryOf(attachment) === 'WORK')
)
const selectedAssignUsers = computed(() => {
  const selected = new Set(assignUserForm.value.userIds)
  return users.value.filter((u) => selected.has(u._id))
})
const assignedWorkFileCount = computed(() =>
  Object.values(assignUserForm.value.fileOwners ?? {}).filter((ownerId) => ownerId && ownerId !== UNASSIGNED_FILE_OWNER).length
)

const openAssignUser = async (doc) => {
  assignUserTarget.value = doc
  const activeTasks = (doc.relatedTasks ?? []).filter((task) => task.status !== 'CANCELLED')
  const fileOwners = {}
  for (const task of activeTasks) {
    const ownerId = idOf(task.assignedTo)
    if (!ownerId) continue
    for (const attachment of task.attachments ?? []) {
      const attachmentId = idOf(attachment)
      if (attachmentId) fileOwners[attachmentId] = ownerId
    }
  }
  assignUserForm.value = {
    userIds: (doc.currentAssignees ?? []).map((assignee) => assignee._id ?? assignee),
    fileOwners,
    estimatedMinutes: activeTasks[0]?.estimatedMinutes || 60,
    dueAt: activeTasks[0]?.dueAt ? String(activeTasks[0].dueAt).slice(0, 10) : (doc.dueAt ? String(doc.dueAt).slice(0, 10) : ''),
    note: '',
  }
  showAssignUser.value = true
  try {
    const deptId = doc.currentDepartment?._id ?? doc.currentDepartment
    const res = await http(`${API}/users?departmentId=${deptId}&role=SPECIALIST&limit=100`)
    users.value = res.data
  } catch {}
}

const toggleAssignUser = (userId, checked) => {
  const set = new Set(assignUserForm.value.userIds)
  if (checked) {
    set.add(userId)
  } else {
    set.delete(userId)
    for (const [attachmentId, ownerId] of Object.entries(assignUserForm.value.fileOwners ?? {})) {
      if (ownerId === userId) delete assignUserForm.value.fileOwners[attachmentId]
    }
  }
  assignUserForm.value.userIds = [...set]
}

const submitAssignUser = async () => {
  if (!assignUserForm.value.userIds.length) return
  assigning.value = true
  try {
    const assignments = assignUserForm.value.userIds.map((userId) => ({
      userId,
      attachmentIds: workAttachmentsForAssign.value
        .filter((attachment) => assignUserForm.value.fileOwners?.[attachment._id] === userId)
        .map((attachment) => attachment._id),
    }))
    await http(`${API}/incoming-documents/${assignUserTarget.value._id}/assign-user`, {
      method: 'POST',
      body: {
        assignments,
        estimatedMinutes: assignUserForm.value.estimatedMinutes,
        dueAt: assignUserForm.value.dueAt,
        note: assignUserForm.value.note,
      },
    })
    showAssignUser.value = false
    fetchDocuments()
  } catch (e) { error.value = e.message }
  finally { assigning.value = false }
}

// ── Complete ──────────────────────────────────────────────────────────────────
const completeDoc = async (doc) => {
  try {
    await http(`${API}/incoming-documents/${doc._id}/complete`, { method: 'POST' })
    fetchDocuments()
  } catch (e) { error.value = e.message }
}

// ── Attachment modal ──────────────────────────────────────────────────────────
const showAttachments = ref(false)
const attachTarget    = ref(null)
const uploadCategory  = ref('DECISION')
const decisionFileInput = ref(null)
const workFileInput     = ref(null)

const attachTabs = [
  { id: 'DECISION', label: 'Quyết định' },
  { id: 'WORK',     label: 'Công việc'  },
]

// Per-file upload queue: [{ id, name, size, progress, status, xhr }]
const uploads = ref([])

const openAttachments = (doc) => {
  attachTarget.value   = { ...doc }
  uploadCategory.value = 'DECISION'
  uploads.value        = []
  showAttachments.value = true
}

const triggerUpload = () => {
  if (uploadCategory.value === 'WORK') workFileInput.value?.click()
  else decisionFileInput.value?.click()
}

const handleFilesChange = (e, category) => {
  const files = Array.from(e.target.files ?? [])
  if (!files.length || !attachTarget.value) return
  files.forEach((file) => uploadFile(file, category))
  e.target.value = ''
}

const uploadFile = (file, category) => {
  const entry = { id: `${Date.now()}-${Math.random()}`, name: file.name, size: file.size, category, progress: 0, status: 'uploading', xhr: null }
  uploads.value.push(entry)

  const fd = new FormData()
  fd.append('category', category)
  fd.append('files', file)

  const xhr = new XMLHttpRequest()
  entry.xhr = xhr

  xhr.upload.addEventListener('progress', (ev) => {
    if (ev.lengthComputable) entry.progress = Math.round(ev.loaded / ev.total * 100)
  })

  xhr.addEventListener('load', () => {
    try {
      const json = JSON.parse(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        entry.status = 'done'
        entry.progress = 100
        const newAtts = (json.data?.attachments ?? []).map((att) => ({
          ...att,
          category,
          metadata: { ...(att.metadata ?? {}), category },
        }))
        attachTarget.value = {
          ...attachTarget.value,
          attachments: [...(attachTarget.value.attachments ?? []), ...newAtts],
        }
        fetchDocuments()
      } else { entry.status = 'error' }
    } catch { entry.status = 'error' }
    // Tự ẩn sau 3s
    setTimeout(() => { uploads.value = uploads.value.filter(u => u.id !== entry.id) }, 3000)
  })

  xhr.addEventListener('error', () => {
    entry.status = 'error'
    setTimeout(() => { uploads.value = uploads.value.filter(u => u.id !== entry.id) }, 3000)
  })
  xhr.addEventListener('abort', () => { entry.status = 'cancelled' })

  xhr.open('POST', `${API}/incoming-documents/${attachTarget.value._id}/attachments?category=${encodeURIComponent(category)}`)
  xhr.withCredentials = true
  xhr.send(fd)
}

const cancelUpload = (entry) => {
  if (entry.status === 'uploading') entry.xhr?.abort()
  uploads.value = uploads.value.filter(u => u.id !== entry.id)
}

const deleteAttachment = async (attId) => {
  if (!attachTarget.value || !attId) return
  try {
    await http(`${API}/incoming-documents/${attachTarget.value._id}/attachments/${attId}`, { method: 'DELETE' })
    attachTarget.value = {
      ...attachTarget.value,
      attachments: attachTarget.value.attachments.filter(a => a._id !== attId),
    }
    fetchDocuments()
  } catch (e) { error.value = e.message }
}

const attachmentCategory = categoryOf
const tabAttachments = computed(() =>
  (attachTarget.value?.attachments ?? []).filter(a => attachmentCategory(a) === uploadCategory.value)
)

const fmtFileSize = (bytes) => {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ── Overdue helper ────────────────────────────────────────────────────────────
const isOverdue = (doc) => doc.dueAt && new Date(doc.dueAt) < new Date() && !['COMPLETED', 'ARCHIVED'].includes(doc.status)

const formatDate = (d) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
</script>

<template>
  <div class="h-full flex flex-col bg-zinc-50/40 overflow-hidden">

    <!-- Hidden file inputs: separate upload channels per attachment category -->
    <input ref="decisionFileInput" type="file" multiple class="hidden" @change="(event) => handleFilesChange(event, 'DECISION')" />
    <input ref="workFileInput" type="file" multiple class="hidden" @change="(event) => handleFilesChange(event, 'WORK')" />

    <!-- Header -->
    <header class="px-6 pt-6 pb-4 flex items-center justify-between gap-4 flex-wrap border-b border-zinc-200/60 bg-white">
      <div>
        <h1 class="text-xl font-bold text-zinc-900 flex items-center gap-2">
          <FileText class="w-5 h-5 text-indigo-600" /> Văn bản đến
        </h1>
        <p class="text-sm text-zinc-500 mt-0.5">Tiếp nhận và xử lý văn bản đầu vào</p>
      </div>
      <Button v-if="canCreateDocument" @click="showCreate = true" class="rounded-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
        <Plus class="w-4 h-4" /> Thêm văn bản
      </Button>
    </header>

    <!-- Filters -->
    <div class="px-6 py-3 flex items-center gap-3 flex-wrap bg-white border-b border-zinc-100">
      <div class="relative flex-1 min-w-[200px]">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
        <Input v-model="filterSearch" @input="fetchDocuments()" placeholder="Tìm kiếm văn bản..." class="pl-9 h-9 rounded-full bg-zinc-50 border-zinc-200" />
      </div>
      <Select v-model="filterStatus" @update:modelValue="fetchDocuments()">
        <SelectTrigger class="w-44 h-9 rounded-full border-zinc-200 text-sm">
          <SelectValue placeholder="Tất cả trạng thái" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Tất cả</SelectItem>
          <SelectItem v-for="(meta, key) in statusMeta" :key="key" :value="key">{{ meta.label }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="filterPriority" @update:modelValue="fetchDocuments()">
        <SelectTrigger class="w-40 h-9 rounded-full border-zinc-200 text-sm">
          <SelectValue placeholder="Ưu tiên" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Tất cả</SelectItem>
          <SelectItem v-for="(meta, key) in priorityMeta" :key="key" :value="key">{{ meta.label }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="mx-6 mt-3 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 font-medium flex items-center justify-between">
      {{ error }}
      <button @click="error = null"><X class="w-4 h-4" /></button>
    </div>

    <!-- Table -->
    <div class="flex-1 overflow-auto px-6 py-4">
      <div class="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">

        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center py-16 gap-2 text-zinc-400">
          <Loader2 class="w-5 h-5 animate-spin" /> Đang tải...
        </div>

        <!-- Empty -->
        <div v-else-if="!documents.length" class="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
          <FileText class="w-12 h-12 text-zinc-200" />
          <p class="text-sm font-medium">Chưa có văn bản nào</p>
        </div>

        <!-- Data table -->
        <table v-else class="w-full text-sm">
          <thead class="bg-zinc-50/60 border-b border-zinc-100">
            <tr>
              <th class="text-left px-5 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Số văn bản</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Tiêu đề</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden md:table-cell">Phòng ban</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden lg:table-cell">Ưu tiên</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Trạng thái</th>
              <th class="text-left px-4 py-3 text-[11px] font-bold text-zinc-400 uppercase tracking-wide hidden lg:table-cell">Hạn xử lý</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-50">
            <tr v-for="doc in documents" :key="doc._id"
                class="hover:bg-zinc-50/50 transition-colors"
                :class="{ 'bg-rose-50/30': isOverdue(doc) }">

              <td class="px-5 py-3.5 font-mono text-xs font-bold text-zinc-700 whitespace-nowrap">
                {{ doc.documentNumber }}
              </td>

              <td class="px-4 py-3.5 max-w-[280px]">
                <p class="font-semibold text-zinc-900 truncate">{{ doc.title }}</p>
                <p v-if="doc.sender" class="text-[11px] text-zinc-400 mt-0.5 truncate">{{ doc.sender }}</p>
              </td>

              <td class="px-4 py-3.5 hidden md:table-cell text-zinc-500 text-xs font-medium">
                {{ doc.currentDepartment?.name ?? '—' }}
              </td>

              <td class="px-4 py-3.5 hidden lg:table-cell">
                <span v-if="doc.priority" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
                      :class="priorityMeta[doc.priority]?.class">
                  {{ priorityMeta[doc.priority]?.label }}
                </span>
              </td>

              <td class="px-4 py-3.5">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                      :class="statusMeta[doc.status]?.class">
                  {{ statusMeta[doc.status]?.label ?? doc.status }}
                </span>
                <span v-if="isOverdue(doc)" class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">QUÁ HẠN</span>
              </td>

              <td class="px-4 py-3.5 hidden lg:table-cell text-xs text-zinc-500 whitespace-nowrap"
                  :class="{ 'text-rose-600 font-semibold': isOverdue(doc) }">
                {{ formatDate(doc.dueAt) }}
              </td>

              <!-- Actions -->
              <td class="px-4 py-3.5 whitespace-nowrap">
                <div class="flex items-center gap-1.5">
                  <!-- Giao phòng: DRAFT/RECEIVED -->
                  <Button v-if="canAssignDepartment && ['DRAFT', 'RECEIVED'].includes(doc.status)"
                          @click="openAssignDept(doc)" size="sm"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 gap-1">
                    <Building2 class="w-3 h-3" /> Giao phòng
                  </Button>

                  <!-- Đổi phòng: OFFICE_CHIEF đổi lại khi chưa giao chuyên viên -->
                  <Button v-if="canAssignDepartment && doc.status === 'ASSIGNED_TO_DEPARTMENT'"
                          @click="openAssignDept(doc)" size="sm"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-amber-50 text-amber-700 hover:bg-amber-100 border-0 gap-1">
                    <RefreshCw class="w-3 h-3" /> Đổi phòng
                  </Button>

                  <!-- Giao người -->
                  <Button v-if="canAssignUser && ['ASSIGNED_TO_DEPARTMENT', 'ASSIGNED_TO_USER'].includes(doc.status)"
                          @click="openAssignUser(doc)" size="sm"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-violet-50 text-violet-700 hover:bg-violet-100 border-0 gap-1">
                    <UserCheck class="w-3 h-3" /> {{ doc.status === 'ASSIGNED_TO_USER' ? 'Đổi phân công' : 'Giao người' }}
                  </Button>

                  <!-- Hoàn thành -->
                  <Button v-if="canCompleteDocument && ['IN_PROGRESS', 'ASSIGNED_TO_USER'].includes(doc.status)"
                          @click="completeDoc(doc)" size="sm"
                          class="h-7 rounded-full text-[11px] font-bold px-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-0 gap-1">
                    <CheckCircle class="w-3 h-3" /> Hoàn thành
                  </Button>

                  <!-- Attachment button with count -->
                  <button v-if="canManageAttachments" @click="openAttachments(doc)"
                          class="flex items-center gap-1.5 h-7 px-2.5 rounded-full border transition-colors"
                          :class="doc.attachments?.length
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                            : 'bg-zinc-50 border-zinc-200 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'">
                    <Paperclip class="w-3 h-3" />
                    <span class="text-[11px] font-bold">
                      {{ doc.attachments?.length ? `${doc.attachments.length} file` : 'Đính kèm' }}
                    </span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Pagination -->
        <div v-if="pagination.totalPages > 1" class="px-5 py-3 border-t border-zinc-100 flex items-center justify-between text-sm text-zinc-500">
          <span>{{ pagination.total }} văn bản</span>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="h-8 rounded-full" :disabled="pagination.page <= 1"
                    @click="fetchDocuments(pagination.page - 1)">Trước</Button>
            <span class="text-xs font-semibold">{{ pagination.page }} / {{ pagination.totalPages }}</span>
            <Button variant="outline" size="sm" class="h-8 rounded-full" :disabled="pagination.page >= pagination.totalPages"
                    @click="fetchDocuments(pagination.page + 1)">Sau</Button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Create Document Modal ─────────────────────────────────────── -->
    <Dialog v-model:open="showCreate">
      <DialogContent class="rounded-3xl max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><FileText class="w-5 h-5 text-indigo-600" /> Thêm văn bản mới</DialogTitle>
        </DialogHeader>
        <div class="grid gap-4 py-2">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Số văn bản *</span>
              <Input v-model="createForm.documentNumber" placeholder="VB-2026-001" class="rounded-full" />
            </div>
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Ưu tiên</span>
              <Select v-model="createForm.priority">
                <SelectTrigger class="rounded-full"><SelectValue /></SelectTrigger>
                <SelectContent class="rounded-full">
                  <SelectItem v-for="(m, k) in priorityMeta" :key="k" :value="k">{{ m.label }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Tiêu đề *</span>
            <Input v-model="createForm.title" placeholder="Tên văn bản..." class="rounded-full" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Cơ quan gửi</span>
              <Input v-model="createForm.sender" placeholder="Bộ/Ban/Ngành..." class="rounded-full" />
            </div>
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Hạn xử lý</span>
              <Popover v-model:open="calendarOpen">
                <PopoverTrigger as-child>
                  <button type="button" class="flex w-full items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 h-10 text-sm text-left hover:bg-zinc-50 transition-colors">
                    <CalendarIcon class="w-4 h-4 text-zinc-400 shrink-0" />
                    <span :class="createForm.dueAt ? 'text-zinc-900' : 'text-zinc-400'">{{ createForm.dueAt ? new Date(createForm.dueAt).toLocaleDateString('vi-VN') : 'Chọn ngày...' }}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent class="w-auto p-0 rounded-2xl border border-zinc-100 shadow-xl" align="start">
                  <Calendar
                    :model-value="calendarValue"
                    locale="vi"
                    class="rounded-2xl"
                    @update:model-value="onCalendarSelect"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Tóm tắt</span>
            <Textarea v-model="createForm.summary" placeholder="Nội dung tóm tắt..." class="resize-none h-20 rounded-xl" />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showCreate = false" class="rounded-full">Hủy</Button>
          <Button @click="submitCreate" :disabled="!createForm.documentNumber || !createForm.title || creating"
                  class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
            <Loader2 v-if="creating" class="w-4 h-4 animate-spin" />
            Tạo văn bản
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ── Assign Department Modal ───────────────────────────────────── -->
    <Dialog v-model:open="showAssignDept">
      <DialogContent class="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><Building2 class="w-5 h-5 text-indigo-600" /> Giao phòng ban</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <p class="text-sm text-zinc-500 bg-zinc-50 rounded-xl px-4 py-2.5 font-medium">{{ assignDeptTarget?.title }}</p>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Phòng ban *</span>
            <Select v-model="assignDeptForm.departmentId">
              <SelectTrigger class="rounded-full"><SelectValue placeholder="Chọn phòng ban..." /></SelectTrigger>
              <SelectContent class="rounded-2xl">
                <SelectItem v-for="d in departments" :key="d._id" :value="d._id">{{ d.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Ghi chú</span>
            <Textarea v-model="assignDeptForm.note" placeholder="Ghi chú giao việc..." class="resize-none h-20 rounded-xl" />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showAssignDept = false" class="rounded-full">Hủy</Button>
          <Button @click="submitAssignDept" :disabled="!assignDeptForm.departmentId || assigning"
                  class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
            <Loader2 v-if="assigning" class="w-4 h-4 animate-spin" />
            Giao phòng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ── Assign User Modal ─────────────────────────────────────────── -->
    <Dialog v-model:open="showAssignUser">
      <DialogContent class="rounded-3xl w-[calc(100vw-2rem)] max-w-5xl max-h-[calc(100dvh-2rem)] overflow-hidden p-5 sm:p-7">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><UserCheck class="w-5 h-5 text-violet-600" /> Giao chuyên viên</DialogTitle>
        </DialogHeader>
        <div class="min-h-0 overflow-y-auto pr-1 py-1">
          <p class="text-sm text-zinc-500 bg-zinc-50 rounded-xl px-4 py-2.5 font-medium">{{ assignUserTarget?.title }}</p>
          <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.92fr)]">
            <div class="space-y-1.5">
              <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Chuyên viên xử lý *</span>
              <div class="max-h-72 lg:max-h-[28rem] overflow-auto rounded-2xl border border-zinc-100 bg-zinc-50/50 p-2 space-y-1">
                <label v-for="u in users" :key="u._id"
                       class="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-violet-50">
                  <Checkbox
                    :model-value="assignUserForm.userIds.includes(u._id)"
                    @update:modelValue="checked => toggleAssignUser(u._id, checked === true)"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ u.fullName }}</span>
                  <span class="hidden sm:inline max-w-[45%] text-xs font-medium text-zinc-400 truncate">{{ u.email }}</span>
                </label>
              </div>
              <p class="text-xs text-zinc-400">{{ assignUserForm.userIds.length }} chuyên viên được chọn</p>
            </div>
            <div class="space-y-4">
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="space-y-1.5">
                  <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Thời lượng/phần việc *</span>
                  <Input v-model.number="assignUserForm.estimatedMinutes" type="number" min="15" step="15" class="rounded-full" />
                </div>
                <div class="space-y-1.5">
                  <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Deadline task</span>
                  <Popover v-model:open="assignUserCalendarOpen">
                    <PopoverTrigger as-child>
                      <button type="button" class="flex w-full items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 h-10 text-sm text-left hover:bg-zinc-50 transition-colors">
                        <CalendarIcon class="w-4 h-4 text-zinc-400 shrink-0" />
                        <span :class="assignUserForm.dueAt ? 'text-zinc-900' : 'text-zinc-400'">{{ assignUserForm.dueAt ? new Date(assignUserForm.dueAt).toLocaleDateString('vi-VN') : 'Chọn ngày...' }}</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent class="w-auto p-0 rounded-2xl border border-zinc-100 shadow-xl" align="start">
                      <Calendar
                        :model-value="assignUserCalendarValue"
                        locale="vi"
                        class="rounded-2xl"
                        @update:model-value="onAssignUserCalendarSelect"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">File công việc theo chuyên viên</span>
                  <span v-if="selectedAssignUsers.length" class="shrink-0 text-xs font-semibold text-zinc-400">
                    {{ assignedWorkFileCount }}/{{ workAttachmentsForAssign.length }} file đã gán
                  </span>
                </div>
                <div v-if="workAttachmentsForAssign.length && selectedAssignUsers.length"
                     class="max-h-64 overflow-auto rounded-2xl border border-zinc-100 bg-zinc-50/50 p-2 space-y-1">
                  <div v-for="att in workAttachmentsForAssign" :key="att._id"
                       class="grid gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-zinc-700 sm:grid-cols-[minmax(0,1fr)_190px] sm:items-center">
                    <div class="flex min-w-0 items-center gap-3">
                      <FileIcon class="w-4 h-4 shrink-0 text-violet-400" />
                      <span class="min-w-0 flex-1 truncate">{{ att.fileName ?? 'Tệp công việc' }}</span>
                    </div>
                    <Select v-model="assignUserForm.fileOwners[att._id]">
                      <SelectTrigger class="h-9 rounded-full border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-700 focus:border-violet-400">
                        <SelectValue placeholder="Chưa giao" />
                      </SelectTrigger>
                      <SelectContent class="rounded-2xl">
                        <SelectItem :value="UNASSIGNED_FILE_OWNER">Chưa giao</SelectItem>
                        <SelectItem v-for="u in selectedAssignUsers" :key="u._id" :value="u._id">
                          {{ u.fullName }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div v-else-if="workAttachmentsForAssign.length" class="rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-500">
                  Chọn chuyên viên trước, sau đó gán từng file cho đúng người xử lý.
                </div>
                <p v-else class="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                  Chưa có file Công việc. File này do văn phòng/chuyên viên đính kèm, Trưởng phòng chỉ chọn để giao.
                </p>
              </div>
              <div class="space-y-1.5">
                <span class="text-xs font-bold text-zinc-500 uppercase tracking-wide">Ghi chú</span>
                <Textarea v-model="assignUserForm.note" placeholder="Ghi chú phân công..." class="resize-none h-24 rounded-xl" />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter class="gap-2 pt-1">
          <Button variant="outline" @click="showAssignUser = false" class="rounded-full">Hủy</Button>
          <Button @click="submitAssignUser" :disabled="!assignUserForm.userIds.length || !assignUserForm.estimatedMinutes || assigning"
                  class="rounded-full bg-violet-600 hover:bg-violet-700 text-white gap-2">
            <Loader2 v-if="assigning" class="w-4 h-4 animate-spin" />
            Lưu phân công
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ── Attachment Modal ─────────────────────────────────────────── -->
    <Dialog v-model:open="showAttachments">
      <DialogContent class="rounded-3xl max-w-lg flex flex-col">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Paperclip class="w-5 h-5 text-indigo-600" /> Tài liệu đính kèm
          </DialogTitle>
          <p class="text-xs text-zinc-400 font-medium truncate pl-7">{{ attachTarget?.title }}</p>
        </DialogHeader>

        <!-- SlidingTabs category -->
        <div class="flex">
          <SlidingTabs :tabs="attachTabs" v-model="uploadCategory" />
        </div>

        <!-- Existing files for current category -->
        <div class="flex-1 flex flex-col space-y-2 min-h-[140px] max-h-56 overflow-auto pr-0.5">
          <template v-if="tabAttachments.length">
            <div v-for="att in tabAttachments" :key="att._id ?? att.filename"
                 class="flex items-center gap-3 px-4 py-1 bg-zinc-50 hover:bg-zinc-100 rounded-full transition-colors group">
              <FileIcon class="w-4 h-4 text-indigo-400 shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-zinc-900 truncate">{{ att.fileName ?? att.originalName ?? att.filename ?? '—' }}</p>
                <p class="text-[11px] text-zinc-400 font-medium">{{ fmtFileSize(att.sizeBytes ?? att.size) }}</p>
              </div>
              <a v-if="att.url || att.path" :href="att.url ?? `/uploads/${att.filename}`" target="_blank"
                 class="text-xs text-indigo-600 font-bold hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Xem</a>
              <button @click="deleteAttachment(att._id)"
                      class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-300 hover:text-rose-500">
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </template>
          <div v-else-if="!uploads.length" class="flex flex-col items-center justify-center py-6 text-zinc-400 gap-2">
            <Paperclip class="w-8 h-8 text-zinc-200" />
            <p class="text-xs font-medium">Chưa có tài liệu {{ uploadCategory === 'DECISION' ? 'quyết định' : 'công việc' }}</p>
          </div>
        </div>

        <!-- Upload queue (per-file progress) -->
        <div v-if="uploads.length" class="space-y-2">
          <div v-for="u in uploads" :key="u.id"
               class="flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors"
               :class="u.status === 'uploading' ? 'border-indigo-100 bg-indigo-50/40' : u.status === 'done' ? 'border-emerald-100 bg-emerald-50/40' : u.status === 'error' ? 'border-rose-100 bg-rose-50/40' : 'border-zinc-100 bg-zinc-50'">
            <FileIcon class="w-4 h-4 shrink-0"
                      :class="u.status === 'uploading' ? 'text-indigo-400' : u.status === 'done' ? 'text-emerald-500' : u.status === 'error' ? 'text-rose-400' : 'text-zinc-300'" />
            <div class="flex-1 min-w-0 space-y-1">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold text-zinc-800 truncate">{{ u.name }}</p>
                <span class="text-[10px] font-bold shrink-0"
                      :class="u.status === 'uploading' ? 'text-indigo-600' : u.status === 'done' ? 'text-emerald-600' : u.status === 'error' ? 'text-rose-600' : 'text-zinc-400'">
                  {{ u.status === 'uploading' ? `${u.progress}%` : u.status === 'done' ? 'Xong' : u.status === 'error' ? 'Lỗi' : 'Đã huỷ' }}
                </span>
              </div>
              <div class="h-1 w-full bg-zinc-200 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-300"
                     :class="u.status === 'uploading' ? 'bg-indigo-500' : u.status === 'done' ? 'bg-emerald-500' : u.status === 'error' ? 'bg-rose-400' : 'bg-zinc-300'"
                     :style="{ width: `${u.progress}%` }"></div>
              </div>
            </div>
            <button @click="cancelUpload(u)" class="shrink-0 text-zinc-300 hover:text-rose-500 transition-colors">
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Drop zone -->
        <div class="border-2 border-dashed border-zinc-200 rounded-2xl p-5 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors cursor-pointer"
             @click="triggerUpload">
          <div class="flex flex-col items-center gap-2 pointer-events-none">
            <Upload class="w-6 h-6 text-zinc-300" />
            <p class="text-sm font-semibold text-zinc-500">Nhấn để chọn file</p>
            <p class="text-xs text-zinc-400">Tối đa 20MB · Upload vào {{ uploadCategory === 'WORK' ? 'Công việc' : 'Quyết định' }}</p>
          </div>
        </div>

        <DialogFooter>
          <Button @click="showAttachments = false" class="rounded-full w-full bg-zinc-900 hover:bg-zinc-700 text-white">
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>
</template>
