<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle,
  Clock,
  Download,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  Play,
  SendHorizontal,
  UserRound,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { http } from '@/shared/api/http'
import { useAuth } from '@/features/auth/composables/useAuth'

const API = '/api'
const route = useRoute()
const router = useRouter()
const { user } = useAuth()

const task = ref(null)
const loading = ref(false)
const error = ref(null)
const actionLoading = ref(null)

const roleCode = computed(() => user.value?.role?.code)
const roleLevel = computed(() => Number(user.value?.role?.level ?? 99))
const isSpecialist = computed(() => roleCode.value === 'SPECIALIST')
const canReviewTask = computed(() => roleLevel.value <= 3)

const taskId = computed(() => String(route.params.taskId ?? ''))

const statusMeta = {
  DRAFT:              { label: 'Nháp',            class: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  TODO:               { label: 'Chờ xử lý',       class: 'bg-blue-50 text-blue-700 border-blue-200' },
  IN_PROGRESS:        { label: 'Đang làm',         class: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_REVIEW:     { label: 'Chờ duyệt',        class: 'bg-violet-50 text-violet-700 border-violet-200' },
  REVISION_REQUESTED: { label: 'Cần sửa',          class: 'bg-orange-50 text-orange-700 border-orange-200' },
  DONE:               { label: 'Hoàn thành',       class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED:          { label: 'Đã hủy',           class: 'bg-zinc-50 text-zinc-400 border-zinc-200' },
}

const priorityMeta = {
  LOW:    { label: 'Thấp',       class: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
  MEDIUM: { label: 'Trung bình', class: 'bg-blue-50 text-blue-600 border-blue-200' },
  HIGH:   { label: 'Cao',        class: 'bg-amber-50 text-amber-700 border-amber-200' },
  URGENT: { label: 'Khẩn cấp',   class: 'bg-rose-50 text-rose-700 border-rose-200' },
}

const typeMeta = {
  INVITATION: 'Cuộc họp',
  DEADLINE: 'Deadline',
  DAILY: 'Hàng ngày',
}

const normalizeCategory = (attachment) => String(
  attachment?.metadata?.category ?? attachment?.category ?? 'DECISION',
).toUpperCase()

const decisionAttachments = computed(() => {
  const attachments = task.value?.sourceDocument?.attachments ?? []
  return attachments.filter((attachment) => normalizeCategory(attachment) === 'DECISION')
})

const assignedAttachments = computed(() => task.value?.attachments ?? [])

const scheduleSegments = computed(() => task.value?.scheduleSegments ?? [])

const isOverdue = computed(() => (
  task.value?.dueAt
  && new Date(task.value.dueAt) < new Date()
  && !['DONE', 'CANCELLED'].includes(task.value.status)
))

const canStart = computed(() => (
  isSpecialist.value && ['TODO', 'REVISION_REQUESTED'].includes(task.value?.status)
))

const canSubmitReview = computed(() => (
  isSpecialist.value && task.value?.status === 'IN_PROGRESS'
))

const canEditDeadline = computed(() => (
  isSpecialist.value
  && ['TODO', 'IN_PROGRESS', 'REVISION_REQUESTED'].includes(task.value?.status)
  && !isOverdue.value
))

const canReview = computed(() => (
  canReviewTask.value && task.value?.status === 'PENDING_REVIEW'
))

const fetchTask = async () => {
  if (!taskId.value) return
  loading.value = true
  error.value = null
  try {
    const res = await http(`${API}/tasks/${taskId.value}`)
    task.value = res.data
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const formatDate = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : 'Chưa đặt'
const formatDateTime = (value) => value ? new Date(value).toLocaleString('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}) : 'Chưa đặt'

const formatBytes = (bytes) => {
  const value = Number(bytes ?? 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`
  return `${Math.round(value / 1024 / 102.4) / 10} MB`
}

const attachmentUrl = (attachment, source = 'task', inline = false) => {
  const base = source === 'source'
    ? `${API}/tasks/${taskId.value}/source-attachments/${attachment._id}/download`
    : `${API}/tasks/${taskId.value}/attachments/${attachment._id}/download`
  return inline ? `${base}?disposition=inline` : base
}

const viewAttachment = (attachment, source) => {
  window.open(attachmentUrl(attachment, source, true), '_blank', 'noopener,noreferrer')
}

const downloadAttachment = (attachment, source) => {
  const link = document.createElement('a')
  link.href = attachmentUrl(attachment, source, false)
  link.download = attachment.fileName || 'attachment'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const doAction = async (endpoint, body = {}) => {
  if (!task.value?._id) return
  actionLoading.value = endpoint
  error.value = null
  try {
    await http(`${API}/tasks/${task.value._id}/${endpoint}`, { method: 'POST', body })
    await fetchTask()
  } catch (e) {
    error.value = e.message
  } finally {
    actionLoading.value = null
  }
}

const showSubmit = ref(false)
const submitNote = ref('')
const submitForReview = async () => {
  actionLoading.value = 'submit-review'
  error.value = null
  try {
    await http(`${API}/tasks/${task.value._id}/submit-review`, {
      method: 'POST',
      body: { note: submitNote.value.trim() },
    })
    showSubmit.value = false
    submitNote.value = ''
    await fetchTask()
  } catch (e) {
    error.value = e.message
  } finally {
    actionLoading.value = null
  }
}

const showTimeEdit = ref(false)
const timeEditForm = ref({ dueAt: '' })
const openTimeEdit = () => {
  timeEditForm.value = { dueAt: task.value?.dueAt ? String(task.value.dueAt).slice(0, 10) : '' }
  showTimeEdit.value = true
}

const submitTimeEdit = async () => {
  if (!timeEditForm.value.dueAt) return
  actionLoading.value = 'time'
  error.value = null
  try {
    await http(`${API}/tasks/${task.value._id}`, {
      method: 'PATCH',
      body: { dueAt: timeEditForm.value.dueAt },
    })
    showTimeEdit.value = false
    await fetchTask()
  } catch (e) {
    error.value = e.message
  } finally {
    actionLoading.value = null
  }
}

const showReview = ref(false)
const reviewForm = ref({ result: 'APPROVED', note: '', score: '' })
const submitReview = async () => {
  actionLoading.value = 'review'
  error.value = null
  try {
    const payload = { ...reviewForm.value }
    if (!payload.score) delete payload.score
    await http(`${API}/tasks/${task.value._id}/review`, { method: 'POST', body: payload })
    showReview.value = false
    await fetchTask()
  } catch (e) {
    error.value = e.message
  } finally {
    actionLoading.value = null
  }
}

onMounted(fetchTask)
</script>

<template>
  <div class="h-full overflow-auto bg-zinc-50/40">
    <header class="sticky top-0 z-10 border-b border-zinc-200/70 bg-white/95 px-6 py-4 backdrop-blur">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex items-center gap-3">
          <Button variant="ghost" size="icon" class="h-9 w-9 rounded-full" @click="router.back()">
            <ArrowLeft class="h-4 w-4" />
          </Button>
          <div class="min-w-0">
            <h1 class="truncate text-xl font-bold text-zinc-900">Chi tiết nhiệm vụ</h1>
            <p class="mt-0.5 text-sm text-zinc-500">Thông tin xử lý, lịch làm và tài liệu liên quan</p>
          </div>
        </div>
        <div v-if="task" class="flex shrink-0 items-center gap-2">
          <Button
            v-if="canStart"
            class="rounded-full bg-amber-500 text-white hover:bg-amber-600"
            :disabled="Boolean(actionLoading)"
            @click="doAction('start')"
          >
            <Loader2 v-if="actionLoading === 'start'" class="mr-2 h-4 w-4 animate-spin" />
            <Play v-else class="mr-2 h-4 w-4" />
            {{ task.status === 'REVISION_REQUESTED' ? 'Tiếp tục sửa' : 'Bắt đầu làm' }}
          </Button>
          <Button
            v-if="canEditDeadline"
            variant="outline"
            class="rounded-full"
            @click="openTimeEdit"
          >
            <Clock class="mr-2 h-4 w-4" /> Đổi hạn
          </Button>
          <Button
            v-if="canSubmitReview"
            class="rounded-full bg-violet-600 text-white hover:bg-violet-700"
            :disabled="Boolean(actionLoading)"
            @click="showSubmit = true"
          >
            <SendHorizontal class="mr-2 h-4 w-4" /> Nộp duyệt
          </Button>
          <Button
            v-if="canReview"
            class="rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
            :disabled="Boolean(actionLoading)"
            @click="showReview = true"
          >
            <CheckCircle class="mr-2 h-4 w-4" /> Duyệt nhiệm vụ
          </Button>
        </div>
      </div>
    </header>

    <main class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-5">
      <div v-if="loading" class="flex items-center justify-center rounded-lg border border-zinc-100 bg-white py-20 text-zinc-400">
        <Loader2 class="mr-2 h-5 w-5 animate-spin" /> Đang tải nhiệm vụ...
      </div>

      <div v-else-if="error" class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
        {{ error }}
      </div>

      <template v-else-if="task">
        <section class="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span class="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold" :class="statusMeta[task.status]?.class">
                  {{ statusMeta[task.status]?.label ?? task.status }}
                </span>
                <span v-if="task.priority" class="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold" :class="priorityMeta[task.priority]?.class">
                  {{ priorityMeta[task.priority]?.label ?? task.priority }}
                </span>
                <span v-if="isOverdue" class="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                  <AlertTriangle class="mr-1 h-3 w-3" /> Quá hạn
                </span>
              </div>
              <h2 class="text-2xl font-bold leading-tight text-zinc-950">{{ task.title }}</h2>
              <p v-if="task.description" class="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-zinc-600">{{ task.description }}</p>
              <p v-else class="mt-3 text-sm text-zinc-400">Chưa có mô tả chi tiết.</p>
            </div>
          </div>
        </section>

        <section class="grid gap-4 lg:grid-cols-4">
          <div class="rounded-lg border border-zinc-100 bg-white p-4 shadow-sm">
            <div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
              <CalendarDays class="h-4 w-4" /> Hạn xử lý
            </div>
            <p class="mt-2 text-lg font-bold text-zinc-900">{{ formatDate(task.dueAt) }}</p>
          </div>
          <div class="rounded-lg border border-zinc-100 bg-white p-4 shadow-sm">
            <div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
              <Clock class="h-4 w-4" /> Thời lượng
            </div>
            <p class="mt-2 text-lg font-bold text-zinc-900">{{ task.estimatedMinutes || 0 }} phút</p>
          </div>
          <div class="rounded-lg border border-zinc-100 bg-white p-4 shadow-sm">
            <div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
              <UserRound class="h-4 w-4" /> Người xử lý
            </div>
            <p class="mt-2 truncate text-lg font-bold text-zinc-900">{{ task.assignedTo?.fullName ?? 'Chưa giao' }}</p>
          </div>
          <div class="rounded-lg border border-zinc-100 bg-white p-4 shadow-sm">
            <div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
              <Building2 class="h-4 w-4" /> Phòng ban
            </div>
            <p class="mt-2 truncate text-lg font-bold text-zinc-900">{{ task.assignedDepartment?.name ?? task.department?.name ?? 'Chưa xác định' }}</p>
          </div>
        </section>

        <section class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div class="space-y-5">
            <div class="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
              <div class="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-sm font-bold uppercase tracking-wide text-zinc-700">File công việc được giao</h3>
                  <p class="mt-1 text-xs text-zinc-400">Các tài liệu trưởng phòng đã giao riêng cho nhiệm vụ này.</p>
                </div>
                <span class="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-500">{{ assignedAttachments.length }} file</span>
              </div>

              <div v-if="assignedAttachments.length" class="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
                <div v-for="attachment in assignedAttachments" :key="attachment._id" class="flex items-center justify-between gap-3 px-4 py-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600">
                      <FileText class="h-5 w-5" />
                    </span>
                    <div class="min-w-0">
                      <p class="truncate text-sm font-bold text-zinc-800">{{ attachment.fileName }}</p>
                      <p class="text-xs text-zinc-400">{{ attachment.contentType || 'Tệp đính kèm' }} · {{ formatBytes(attachment.sizeBytes) }}</p>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" class="h-8 rounded-full" @click="viewAttachment(attachment, 'task')">
                      <Eye class="mr-1.5 h-3.5 w-3.5" /> Xem
                    </Button>
                    <Button variant="ghost" size="sm" class="h-8 rounded-full" @click="downloadAttachment(attachment, 'task')">
                      <Download class="mr-1.5 h-3.5 w-3.5" /> Tải
                    </Button>
                  </div>
                </div>
              </div>
              <div v-else class="flex items-center justify-center rounded-lg border border-dashed border-zinc-200 py-10 text-sm font-medium text-zinc-400">
                <Paperclip class="mr-2 h-4 w-4" /> Chưa có file công việc được giao.
              </div>
            </div>

            <div class="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
              <div class="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-sm font-bold uppercase tracking-wide text-zinc-700">File quyết định</h3>
                  <p class="mt-1 text-xs text-zinc-400">Tài liệu quyết định thuộc văn bản nguồn của nhiệm vụ.</p>
                </div>
                <span class="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-500">{{ decisionAttachments.length }} file</span>
              </div>

              <div v-if="decisionAttachments.length" class="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
                <div v-for="attachment in decisionAttachments" :key="attachment._id" class="flex items-center justify-between gap-3 px-4 py-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                      <FileText class="h-5 w-5" />
                    </span>
                    <div class="min-w-0">
                      <p class="truncate text-sm font-bold text-zinc-800">{{ attachment.fileName }}</p>
                      <p class="text-xs text-zinc-400">{{ attachment.contentType || 'Tệp đính kèm' }} · {{ formatBytes(attachment.sizeBytes) }}</p>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" class="h-8 rounded-full" @click="viewAttachment(attachment, 'source')">
                      <Eye class="mr-1.5 h-3.5 w-3.5" /> Xem
                    </Button>
                    <Button variant="ghost" size="sm" class="h-8 rounded-full" @click="downloadAttachment(attachment, 'source')">
                      <Download class="mr-1.5 h-3.5 w-3.5" /> Tải
                    </Button>
                  </div>
                </div>
              </div>
              <div v-else class="flex items-center justify-center rounded-lg border border-dashed border-zinc-200 py-10 text-sm font-medium text-zinc-400">
                <Paperclip class="mr-2 h-4 w-4" /> Văn bản nguồn chưa có file quyết định.
              </div>
            </div>
          </div>

          <aside class="space-y-5">
            <div class="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
              <h3 class="text-sm font-bold uppercase tracking-wide text-zinc-700">Văn bản nguồn</h3>
              <div v-if="task.sourceDocument" class="mt-4 space-y-3">
                <div>
                  <p class="text-xs font-bold uppercase tracking-wide text-zinc-400">Số văn bản</p>
                  <p class="mt-1 text-sm font-bold text-zinc-800">{{ task.sourceDocument.documentNumber || 'Chưa có số' }}</p>
                </div>
                <div>
                  <p class="text-xs font-bold uppercase tracking-wide text-zinc-400">Tiêu đề</p>
                  <p class="mt-1 text-sm font-semibold leading-5 text-zinc-700">{{ task.sourceDocument.title }}</p>
                </div>
                <div v-if="task.sourceDocument.summary">
                  <p class="text-xs font-bold uppercase tracking-wide text-zinc-400">Tóm tắt</p>
                  <p class="mt-1 whitespace-pre-wrap text-sm leading-5 text-zinc-600">{{ task.sourceDocument.summary }}</p>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <p class="text-xs font-bold uppercase tracking-wide text-zinc-400">Ngày ban hành</p>
                    <p class="mt-1 text-sm font-semibold text-zinc-700">{{ formatDate(task.sourceDocument.issuedAt) }}</p>
                  </div>
                  <div>
                    <p class="text-xs font-bold uppercase tracking-wide text-zinc-400">Hạn văn bản</p>
                    <p class="mt-1 text-sm font-semibold text-zinc-700">{{ formatDate(task.sourceDocument.dueAt) }}</p>
                  </div>
                </div>
              </div>
              <p v-else class="mt-4 text-sm text-zinc-400">Nhiệm vụ này không gắn với văn bản nguồn.</p>
            </div>

            <div class="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
              <h3 class="text-sm font-bold uppercase tracking-wide text-zinc-700">Lịch thực hiện</h3>
              <div v-if="scheduleSegments.length" class="mt-4 space-y-3">
                <div v-for="(segment, index) in scheduleSegments" :key="`${segment.startAt}-${segment.endAt}-${index}`" class="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                  <p class="text-xs font-bold text-zinc-500">Khung {{ index + 1 }}</p>
                  <p class="mt-1 text-sm font-semibold text-zinc-800">{{ formatDateTime(segment.startAt) }}</p>
                  <p class="text-sm font-semibold text-zinc-800">{{ formatDateTime(segment.endAt) }}</p>
                </div>
              </div>
              <p v-else class="mt-4 text-sm text-zinc-400">Chưa có lịch thực hiện cụ thể.</p>
            </div>

            <div class="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
              <h3 class="text-sm font-bold uppercase tracking-wide text-zinc-700">Duyệt kết quả</h3>
              <div class="mt-4 space-y-3 text-sm">
                <div class="flex justify-between gap-3">
                  <span class="text-zinc-400">Ngày nộp</span>
                  <span class="font-semibold text-zinc-700">{{ formatDateTime(task.review?.submittedAt) }}</span>
                </div>
                <div class="flex justify-between gap-3">
                  <span class="text-zinc-400">Kết quả</span>
                  <span class="font-semibold text-zinc-700">{{ task.review?.result || 'Chưa nộp' }}</span>
                </div>
                <div v-if="task.review?.note">
                  <p class="text-zinc-400">Ghi chú</p>
                  <p class="mt-1 whitespace-pre-wrap rounded-lg bg-zinc-50 px-3 py-2 font-medium text-zinc-700">{{ task.review.note }}</p>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </template>
    </main>

    <Dialog v-model:open="showTimeEdit">
      <DialogContent class="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Đổi hạn hoàn thành</DialogTitle>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <p class="rounded-lg bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-600">{{ task?.title }}</p>
          <Input v-model="timeEditForm.dueAt" type="date" class="rounded-lg" />
        </div>
        <DialogFooter>
          <Button variant="outline" class="rounded-full" @click="showTimeEdit = false">Hủy</Button>
          <Button class="rounded-full bg-zinc-900 text-white hover:bg-zinc-700" :disabled="!timeEditForm.dueAt || Boolean(actionLoading)" @click="submitTimeEdit">
            <Loader2 v-if="actionLoading === 'time'" class="mr-2 h-4 w-4 animate-spin" />
            Lưu deadline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showSubmit">
      <DialogContent class="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Nộp kết quả xử lý</DialogTitle>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <p class="rounded-lg bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-600">{{ task?.title }}</p>
          <Textarea v-model="submitNote" placeholder="Mô tả nội dung đã hoàn thành..." class="h-28 resize-none rounded-lg" />
        </div>
        <DialogFooter>
          <Button variant="outline" class="rounded-full" @click="showSubmit = false">Hủy</Button>
          <Button class="rounded-full bg-violet-600 text-white hover:bg-violet-700" :disabled="Boolean(actionLoading)" @click="submitForReview">
            <Loader2 v-if="actionLoading === 'submit-review'" class="mr-2 h-4 w-4 animate-spin" />
            Gửi duyệt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showReview">
      <DialogContent class="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Duyệt nhiệm vụ</DialogTitle>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="rounded-lg border px-3 py-2 text-sm font-bold"
              :class="reviewForm.result === 'APPROVED' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-zinc-200 text-zinc-500'"
              @click="reviewForm.result = 'APPROVED'"
            >
              Chấp thuận
            </button>
            <button
              type="button"
              class="rounded-lg border px-3 py-2 text-sm font-bold"
              :class="reviewForm.result === 'RETURNED' ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-zinc-200 text-zinc-500'"
              @click="reviewForm.result = 'RETURNED'"
            >
              Trả lại
            </button>
          </div>
          <Input v-if="reviewForm.result === 'APPROVED'" v-model="reviewForm.score" type="number" min="0" max="100" placeholder="Điểm đánh giá" class="rounded-lg" />
          <Textarea v-model="reviewForm.note" placeholder="Nhận xét..." class="h-24 resize-none rounded-lg" />
        </div>
        <DialogFooter>
          <Button variant="outline" class="rounded-full" @click="showReview = false">Hủy</Button>
          <Button class="rounded-full text-white" :class="reviewForm.result === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-500 hover:bg-orange-600'" :disabled="Boolean(actionLoading)" @click="submitReview">
            <Loader2 v-if="actionLoading === 'review'" class="mr-2 h-4 w-4 animate-spin" />
            {{ reviewForm.result === 'APPROVED' ? 'Chấp thuận' : 'Trả lại' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
