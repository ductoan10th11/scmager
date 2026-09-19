<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  X,
  ExternalLink,
  Users,
  Clock3,
  FileText,
  Building2,
  User,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  XCircle,
  MessageSquareWarning,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import SlidingTabs from '@/components/ui/sliding-tabs/SlidingTabs.vue'
import { http } from '@/shared/api/http'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  documentId: {
    type: String,
    default: '',
  },
  initialData: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['update:open'])

const router = useRouter()
const context = ref(null)
const loading = ref(false)
const error = ref('')
const activeTab = ref('general')

const getValue = (ctx, field) =>
  ctx?.[field] ??
  ctx?.management?.overrides?.[field] ??
  ctx?.observation?.[field] ??
  (field === 'documentId' ? ctx?.externalDocumentId : undefined) ??
  (field === 'url' ? ctx?.sourceUrl : undefined) ??
  ''

const getIdentifier = (ctx) =>
  getValue(ctx, 'soKyHieu') || getValue(ctx, 'documentId') || ctx?.soKyHieu || '—'

const displayIdentifier = computed(() => {
  if (context.value) {
    return getIdentifier(context.value)
  }
  return props.initialData?.soKyHieu || '—'
})

const displaySubject = computed(() => {
  if (context.value) {
    return getValue(context.value, 'subject') || props.initialData?.subject || 'Không có trích yếu'
  }
  return props.initialData?.subject || 'Không có trích yếu'
})

const contextType = computed(() => {
  return getValue(context.value, 'pageType') || context.value?.pageType || 'incoming'
})

const typeLabel = computed(() => {
  return (
    {
      incoming: 'Nhiệm vụ',
      outgoing: 'Sản phẩm',
      outgoing_c2: 'Sản phẩm C2',
    }[contextType.value] || 'Nhiệm vụ'
  )
})

const formatCapturedAt = computed(() => {
  const value =
    context.value?.observedAt ||
    context.value?.capturedAt ||
    context.value?.updatedAt ||
    context.value?.createdAt
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('vi-VN')
})

const formatDate = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('vi-VN')
}

// Thông tin hạn xử lý và phân công (ưu tiên context, fallback initialData)
const deadlineInfo = computed(() => {
  const tracking = context.value?.tracking || {}
  const dueAt = tracking.dueAt || props.initialData?.dueAt
  const deadlineStatus = tracking.deadlineStatus || props.initialData?.deadlineStatus
  const overdueDays = props.initialData?.overdueDays ?? 0
  const assigneeName = tracking.assignee?.fullName || props.initialData?.assigneeName || 'Chưa phân công'
  const departmentName = tracking.assignee?.departmentName || props.initialData?.departmentName || 'Chưa phân phòng'

  let statusText = 'Còn hạn xử lý'
  let statusBadgeClass = 'bg-sky-50 text-sky-700 border-sky-200/80'

  if (deadlineStatus === 'PENDING_OVERDUE') {
    statusText = overdueDays > 0 ? `Quá hạn ${overdueDays} ngày` : 'Đang quá hạn'
    statusBadgeClass = 'bg-rose-50 text-rose-700 border-rose-200/80'
  } else if (deadlineStatus === 'DONE_LATE') {
    statusText = 'Đã xử lý trễ hạn'
    statusBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200/80'
  }

  return {
    dueAt,
    deadlineStatus,
    overdueDays,
    assigneeName,
    departmentName,
    statusText,
    statusBadgeClass,
  }
})

// Ý kiến chỉ đạo từ lãnh đạo
const directorComment = computed(() => {
  if (!context.value) return ''
  return (
    getValue(context.value, 'directorComment') ||
    getValue(context.value, 'yKienChiDao') ||
    getValue(context.value, 'instruction') ||
    ''
  )
})

const directingLeader = computed(() => {
  if (!context.value) return ''
  return (
    getValue(context.value, 'directingLeader') ||
    getValue(context.value, 'lanhDaoChiDao') ||
    ''
  )
})

// Khiếu nại
const complaint = computed(() => context.value?.management?.scoreComplaint ?? null)

const complaintCount = computed(() => {
  const history = complaint.value?.history ?? []
  const requests = history.filter((h) => h.action === 'REQUESTED')
  if (requests.length > 0) return requests.length
  return complaint.value?.status && complaint.value?.status !== 'NONE' ? 1 : 0
})

const complaintStatusLabel = (status) =>
  ({
    PENDING: 'Chờ lãnh đạo duyệt',
    APPROVED: 'Đã chấp nhận',
    REJECTED: 'Bị từ chối',
    CANCELLED: 'Đã hủy',
  }[status] || '')

// Chi tiết hành chính
const adminFields = computed(() => {
  if (!context.value) return []
  return [
    ['Cơ quan ban hành', getValue(context.value, 'issuingAuthority') || getValue(context.value, 'coQuanBanHanh')],
    ['Ngày ban hành', formatDate(getValue(context.value, 'issueDate') || getValue(context.value, 'ngayBanHanh'))],
    ['Sổ văn bản', getValue(context.value, 'documentBook') || getValue(context.value, 'soVanBan')],
    ['Loại văn bản', getValue(context.value, 'documentType') || getValue(context.value, 'loaiVanBan')],
    ['Số đến', getValue(context.value, 'receivedNumber') || getValue(context.value, 'soDen')],
    ['Ngày đến', formatDate(getValue(context.value, 'receivedDate') || getValue(context.value, 'ngayDen'))],
    ['Người ký', getValue(context.value, 'signer') || getValue(context.value, 'nguoiKy')],
    ['Độ khẩn', getValue(context.value, 'priority')],
    ['Hình thức', getValue(context.value, 'documentForm')],
    ['Đơn vị soạn thảo', getValue(context.value, 'draftingUnit')],
    ['Người soạn thảo', getValue(context.value, 'draftingUser')],
    ['Nhiệm vụ liên quan', getValue(context.value, 'relatedIncomingSoKyHieu')],
  ].filter(([, value]) => value && value !== '—')
})

// Người nhận & Liên kết
const recipients = computed(() => getValue(context.value, 'recipients') || [])
const resultLinks = computed(() => Array.isArray(context.value?.resultLinks) ? context.value.resultLinks : [])

// Timeline
const rawTimeline = computed(() => getValue(context.value, 'timeline') || [])

const cleanTimeline = computed(() => {
  return rawTimeline.value.map((entry) => {
    const explicitAction = String(entry?.['Thao tác'] || '').trim()
    const content = String(entry?.['Nội dung'] || '').trim()
    const match = content.match(/^Thao tác:\s*(.+)$/i)
    const action = explicitAction || (match ? match[1].trim() : '')
    const note = content === `Thao tác: ${action}` || content === action ? '' : content

    const actor = String(entry?.['Người gửi'] || entry?.['Người thực hiện'] || 'Hệ thống')
    const time = String(
      entry?.['Thời gian'] ||
      entry?.['Đã xử lý'] ||
      entry?.['Đang xử lý'] ||
      entry?.['Chưa xử lý'] ||
      '',
    )
    const receiver = entry?.['Người nhận'] ? String(entry['Người nhận']).trim() : ''

    return {
      actor,
      time,
      action: action || 'Chuyển xử lý',
      note,
      receiver,
    }
  })
})

const sourceUrl = computed(() => getValue(context.value, 'url'))

// Tabs
const tabs = computed(() => {
  const list = [
    { id: 'general', label: 'Thông tin văn bản', icon: FileText },
    { id: 'timeline', label: `Tiến trình (${cleanTimeline.value.length})`, icon: Clock3 },
  ]
  if (recipients.value.length > 0 || resultLinks.value.length > 0) {
    list.push({ id: 'recipients', label: `Người nhận & Khác (${recipients.value.length})`, icon: Users })
  }
  return list
})

const loadDetail = async () => {
  if (!props.documentId) return
  loading.value = true
  error.value = ''
  if (props.initialData) {
    context.value = { ...props.initialData }
  }
  try {
    const res = await http(`/api/office-document-contexts/${props.documentId}`)
    context.value = res.data ?? null
  } catch (err) {
    error.value = err.message || 'Không thể tải chi tiết ngữ cảnh văn bản.'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.documentId],
  ([isOpen, docId]) => {
    if (isOpen && docId) {
      activeTab.value = 'general'
      loadDetail()
    } else if (!isOpen) {
      context.value = null
    }
  },
  { immediate: true },
)

const closeDrawer = () => {
  emit('update:open', false)
}

const goToOfficeDocuments = () => {
  if (!props.documentId) return
  closeDrawer()
  router.push({ path: '/office-documents', query: { focus: props.documentId } })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="office-context-drawer">
      <div v-if="open" class="fixed inset-0 z-50">
        <!-- Backdrop -->
        <button
          type="button"
          class="absolute inset-0 bg-zinc-950/25 backdrop-blur-[2px] transition-opacity"
          aria-label="Đóng"
          @click="closeDrawer"
        />

        <!-- Slide-over Drawer Panel -->
        <aside
          class="absolute right-0 top-0 flex h-full w-full max-w-[620px] flex-col bg-white shadow-2xl transition-transform"
        >
          <!-- 1. Header tinh gọn, chuẩn mực -->
          <header class="border-b border-zinc-100 px-6 py-4 bg-white/95 backdrop-blur-sm shrink-0">
            <div class="flex items-center justify-between gap-3 mb-2.5">
              <!-- Nhãn phân loại & Trạng thái -->
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold"
                  :class="contextType === 'incoming' ? 'bg-sky-50 text-sky-700 border border-sky-200/80' : 'bg-indigo-50 text-indigo-700 border border-indigo-200/80'"
                >
                  {{ typeLabel }}
                </span>

                <span
                  v-if="deadlineInfo.deadlineStatus"
                  class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border"
                  :class="deadlineInfo.statusBadgeClass"
                >
                  <AlertTriangle v-if="deadlineInfo.deadlineStatus === 'PENDING_OVERDUE'" class="w-3 h-3 shrink-0" />
                  <Clock3 v-else class="w-3 h-3 shrink-0" />
                  <span>{{ deadlineInfo.statusText }}</span>
                </span>

                <span v-if="formatCapturedAt" class="text-xs text-zinc-400 font-medium">
                  {{ formatCapturedAt }}
                </span>
              </div>

              <!-- Nút chuyển trang & Đóng -->
              <div class="flex items-center gap-1.5 shrink-0">
                <Button
                  v-if="documentId"
                  variant="outline"
                  size="sm"
                  class="h-8 rounded-full gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 border-zinc-200 hover:bg-zinc-50 shadow-2xs"
                  @click="goToOfficeDocuments"
                >
                  <ExternalLink class="h-3.5 w-3.5" />
                  <span>Mở trong Văn bản cơ quan</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
                  title="Đóng"
                  @click="closeDrawer"
                >
                  <X class="h-4 w-4" />
                </Button>
              </div>
            </div>

            <!-- Số ký hiệu & Trích yếu văn bản -->
            <div>
              <h2 class="text-lg font-bold text-zinc-900 tracking-tight leading-snug">
                {{ displayIdentifier }}
              </h2>
              <p class="mt-1 text-xs sm:text-sm text-zinc-600 leading-relaxed line-clamp-2">
                {{ displaySubject }}
              </p>
            </div>
          </header>

          <!-- 2. Body nội dung -->
          <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <!-- Thẻ tóm tắt nhanh hạn xử lý & phân công (Quick Summary Card) -->
            <div class="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 shadow-2xs">
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <!-- Hạn xử lý -->
                <div>
                  <span class="text-zinc-400 font-medium block text-[11px] uppercase tracking-wider mb-0.5">Hạn xử lý</span>
                  <div class="flex items-center gap-1.5">
                    <Calendar class="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <strong class="text-zinc-900 font-bold">
                      {{ formatDate(deadlineInfo.dueAt) }}
                    </strong>
                  </div>
                </div>

                <!-- Tình trạng -->
                <div>
                  <span class="text-zinc-400 font-medium block text-[11px] uppercase tracking-wider mb-0.5">Tình trạng</span>
                  <strong
                    class="font-bold block truncate"
                    :class="deadlineInfo.deadlineStatus === 'PENDING_OVERDUE' ? 'text-rose-600' : deadlineInfo.deadlineStatus === 'DONE_LATE' ? 'text-amber-600' : 'text-sky-600'"
                  >
                    {{ deadlineInfo.statusText }}
                  </strong>
                </div>

                <!-- Cán bộ phụ trách -->
                <div>
                  <span class="text-zinc-400 font-medium block text-[11px] uppercase tracking-wider mb-0.5">Phụ trách</span>
                  <div class="flex items-center gap-1.5">
                    <User class="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <strong class="text-zinc-900 font-bold truncate" :title="deadlineInfo.assigneeName">
                      {{ deadlineInfo.assigneeName }}
                    </strong>
                  </div>
                </div>

                <!-- Đơn vị / Phòng ban -->
                <div>
                  <span class="text-zinc-400 font-medium block text-[11px] uppercase tracking-wider mb-0.5">Đơn vị</span>
                  <div class="flex items-center gap-1.5">
                    <Building2 class="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <strong class="text-zinc-900 font-bold truncate" :title="deadlineInfo.departmentName">
                      {{ deadlineInfo.departmentName }}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <!-- SlidingTabs chuyển nhóm nội dung -->
            <div class="flex justify-start">
              <SlidingTabs v-model="activeTab" :tabs="tabs" />
            </div>

            <!-- Loading Skeleton -->
            <div v-if="loading && !context" class="space-y-3 py-2">
              <div v-for="i in 5" :key="i" class="h-11 animate-pulse rounded-xl bg-zinc-100" />
            </div>

            <!-- Lỗi nạp -->
            <div
              v-else-if="error"
              class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
            >
              {{ error }}
            </div>

            <!-- Tab 1: THÔNG TIN VĂN BẢN -->
            <div v-else-if="activeTab === 'general'" class="space-y-4">
              <!-- Ý kiến chỉ đạo của lãnh đạo (nếu có) -->
              <div
                v-if="directorComment"
                class="rounded-2xl border border-sky-200/80 bg-sky-50/50 p-4 space-y-1.5 shadow-2xs"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-sky-800">
                    Ý kiến chỉ đạo của lãnh đạo
                  </span>
                  <span v-if="directingLeader" class="text-xs font-semibold text-sky-700">
                    {{ directingLeader }}
                  </span>
                </div>
                <p class="text-xs sm:text-sm text-zinc-800 font-medium italic leading-relaxed">
                  "{{ directorComment }}"
                </p>
              </div>

              <!-- Thẻ Khiếu nại (nếu có) -->
              <div
                v-if="complaint && complaint.status !== 'NONE'"
                class="rounded-2xl border p-4 space-y-2 text-xs"
                :class="{
                  'border-amber-300/80 bg-amber-50/50': complaint.status === 'PENDING',
                  'border-emerald-300/80 bg-emerald-50/50': complaint.status === 'APPROVED',
                  'border-rose-300/80 bg-rose-50/50': complaint.status === 'REJECTED',
                  'border-zinc-300 bg-zinc-50/70': complaint.status === 'CANCELLED',
                }"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                      :class="{
                        'bg-amber-100 text-amber-900': complaint.status === 'PENDING',
                        'bg-emerald-100 text-emerald-900': complaint.status === 'APPROVED',
                        'bg-rose-100 text-rose-900': complaint.status === 'REJECTED',
                        'bg-zinc-100 text-zinc-800': complaint.status === 'CANCELLED',
                      }"
                    >
                      <MessageSquareWarning v-if="complaint.status === 'PENDING'" class="h-3 w-3" />
                      <CheckCircle2 v-else-if="complaint.status === 'APPROVED'" class="h-3 w-3" />
                      <XCircle v-else-if="complaint.status === 'REJECTED'" class="h-3 w-3" />
                      {{ complaintStatusLabel(complaint.status) }}
                    </span>
                    <span class="text-zinc-600 font-medium">Lần {{ complaintCount }}</span>
                  </div>
                </div>

                <div v-if="complaint.reason" class="text-zinc-700 pt-1 border-t border-zinc-200/50">
                  <span class="font-bold text-zinc-500">Lý do:</span>
                  <span class="ml-1 font-medium">{{ complaint.reason }}</span>
                </div>
                <div v-if="complaint.decisionNote" class="text-zinc-800">
                  <span class="font-bold text-amber-900">Ý kiến duyệt:</span>
                  <span class="ml-1 font-medium">{{ complaint.decisionNote }}</span>
                </div>
              </div>

              <!-- Lưới thông tin văn bản hành chính -->
              <div class="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-3 shadow-2xs">
                <h3 class="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Thông tin hành chính
                </h3>
                <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div
                    v-for="[label, value] in adminFields"
                    :key="label"
                    class="border-b border-zinc-100 pb-2.5 last:border-0 sm:last:border-0"
                  >
                    <dt class="text-zinc-400 font-medium text-[11px] mb-0.5">{{ label }}</dt>
                    <dd class="text-zinc-800 font-semibold break-words">{{ value }}</dd>
                  </div>
                </dl>
              </div>

              <!-- Ghi chú nếu có -->
              <div
                v-if="getValue(context, 'note') || context?.management?.note || getValue(context, 'comment')"
                class="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-3 shadow-2xs"
              >
                <h3 class="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Ghi chú
                </h3>
                <div v-if="getValue(context, 'note')" class="text-xs">
                  <span class="font-medium text-zinc-400 block mb-0.5">Nội dung khi chuyển văn thư:</span>
                  <p class="text-zinc-700 bg-zinc-50 p-2.5 rounded-xl border border-zinc-100 whitespace-pre-wrap leading-relaxed">
                    {{ getValue(context, 'note') }}
                  </p>
                </div>
                <div v-if="context?.management?.note" class="text-xs">
                  <span class="font-medium text-zinc-400 block mb-0.5">Ghi chú quản lý:</span>
                  <p class="text-zinc-700 bg-amber-50/60 p-2.5 rounded-xl border border-amber-200/60 whitespace-pre-wrap leading-relaxed">
                    {{ context.management.note }}
                  </p>
                </div>
              </div>

              <!-- URL nguồn -->
              <div v-if="sourceUrl" class="text-right">
                <a
                  :href="sourceUrl"
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 font-semibold hover:underline"
                >
                  <span>Mở liên kết nguồn văn bản gốc</span>
                  <ArrowUpRight class="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <!-- Tab 2: TIẾN TRÌNH XỬ LÝ (TIMELINE) -->
            <div v-else-if="activeTab === 'timeline'" class="space-y-4">
              <div v-if="cleanTimeline.length" class="relative pl-6 space-y-5 border-l-2 border-sky-100 ml-3 py-1">
                <div
                  v-for="(item, idx) in cleanTimeline"
                  :key="idx"
                  class="relative group"
                >
                  <!-- Chấm mốc thời gian -->
                  <span
                    class="absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-500 shadow-sm transition-transform group-hover:scale-125"
                  />

                  <!-- Card thông tin bước xử lý -->
                  <div class="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-2 hover:border-zinc-300 transition-colors">
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                      <strong class="text-xs font-bold text-zinc-900">{{ item.actor }}</strong>
                      <span class="text-[11px] font-medium text-zinc-400">{{ item.time }}</span>
                    </div>

                    <!-- Badge thao tác -->
                    <div>
                      <span class="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200/60">
                        {{ item.action }}
                      </span>
                      <span v-if="item.receiver" class="text-[11px] text-zinc-500 ml-2 font-medium">
                        → {{ item.receiver }}
                      </span>
                    </div>

                    <!-- Ghi chú bước -->
                    <p
                      v-if="item.note"
                      class="text-xs text-zinc-700 bg-zinc-50/80 p-2.5 rounded-lg border border-zinc-100 leading-relaxed whitespace-pre-wrap"
                    >
                      {{ item.note }}
                    </p>
                  </div>
                </div>
              </div>

              <div v-else class="text-center py-8 text-zinc-400 text-xs">
                Chưa có nhật ký xử lý nào được ghi nhận.
              </div>
            </div>

            <!-- Tab 3: NGƯỜI NHẬN & LIÊN KẾT -->
            <div v-else-if="activeTab === 'recipients'" class="space-y-4">
              <!-- Danh sách người nhận -->
              <div v-if="recipients.length" class="space-y-2.5">
                <h3 class="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Danh sách người nhận ({{ recipients.length }})
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div
                    v-for="(recipient, idx) in recipients"
                    :key="idx"
                    class="rounded-xl border border-zinc-200/80 bg-white p-3 text-xs space-y-1 shadow-2xs"
                  >
                    <p class="font-bold text-zinc-800">
                      {{ recipient.fullName || recipient.department || '—' }}
                    </p>
                    <p class="text-[11px] text-zinc-500">
                      {{ recipient.department || '—' }} · {{ recipient.role || recipient.entityType || '—' }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Văn bản liên kết (kết quả / nguồn) -->
              <div v-if="resultLinks.length" class="space-y-2.5 pt-2 border-t border-zinc-100">
                <h3 class="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Văn bản liên kết ({{ resultLinks.length }})
                </h3>
                <div class="space-y-2">
                  <div
                    v-for="link in resultLinks"
                    :key="link._id"
                    class="rounded-xl border border-zinc-200/80 bg-white p-3.5 text-xs space-y-1.5 shadow-2xs"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <strong class="text-zinc-900 font-bold">
                        {{ getIdentifier(link.outgoingDocument || link.incomingDocument) }}
                      </strong>
                      <Badge variant="outline" class="rounded-full text-[11px]">
                        {{ link.status }}
                      </Badge>
                    </div>
                    <p class="text-zinc-600 text-xs line-clamp-2">
                      {{ getValue(link.outgoingDocument || link.incomingDocument, 'subject') || 'Không có trích yếu' }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Footer tối giản -->
          <footer class="border-t border-zinc-100 px-6 py-3 bg-zinc-50/70 flex items-center justify-end shrink-0">
            <Button
              variant="outline"
              size="sm"
              class="rounded-full h-8 px-5 text-xs font-semibold border-zinc-200 text-zinc-700 hover:bg-zinc-100"
              @click="closeDrawer"
            >
              Đóng
            </Button>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.office-context-drawer-enter-active,
.office-context-drawer-leave-active {
  transition: opacity 200ms ease;
}
.office-context-drawer-enter-active > aside,
.office-context-drawer-leave-active > aside {
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.office-context-drawer-enter-from,
.office-context-drawer-leave-to {
  opacity: 0;
}
.office-context-drawer-enter-from > aside,
.office-context-drawer-leave-to > aside {
  transform: translateX(100%);
}
</style>
