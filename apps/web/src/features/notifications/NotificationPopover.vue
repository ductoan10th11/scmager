<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { io } from 'socket.io-client'
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Clock3, FileText, Forward, Loader2, RotateCcw, Send } from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { http } from '@/shared/api/http'

defineProps({ collapsed: { type: Boolean, default: false } })

const router = useRouter()
const open = ref(false)
const loading = ref(false)
const items = ref([])
const unreadCount = ref(0)
let socket = null

const typeLabels = {
  DOCUMENT_ASSIGNED_TO_DEPARTMENT: 'Văn bản giao phòng',
  DOCUMENT_REASSIGNED_DEPARTMENT: 'Văn bản đổi phòng',
  DOCUMENT_READY_TO_COMPLETE: 'Sẵn sàng hoàn thành',
  DOCUMENT_SLA_UNASSIGNED: 'Treo phân công',
  TASK_DUE_SOON: 'Gần hạn',
  TASK_OVERDUE: 'Quá hạn',
  WORK_DECLARATION_SUBMITTED: 'Công việc chờ duyệt',
  WORK_DECLARATION_FORWARDED: 'Công việc chuyển duyệt',
  WORK_DECLARATION_APPROVED: 'Công việc đã duyệt',
  WORK_DECLARATION_RETURNED: 'Công việc cần bổ sung',
}

const defaultTypeMeta = { icon: Bell, class: 'bg-zinc-100 text-zinc-600' }
const typeMeta = {
  DOCUMENT_ASSIGNED_TO_DEPARTMENT: { icon: FileText, class: 'bg-sky-50 text-sky-700' },
  DOCUMENT_REASSIGNED_DEPARTMENT: { icon: Forward, class: 'bg-sky-50 text-sky-700' },
  DOCUMENT_READY_TO_COMPLETE: { icon: CheckCircle2, class: 'bg-emerald-50 text-emerald-700' },
  DOCUMENT_SLA_UNASSIGNED: { icon: AlertTriangle, class: 'bg-amber-50 text-amber-700' },
  TASK_DUE_SOON: { icon: Clock3, class: 'bg-amber-50 text-amber-700' },
  TASK_OVERDUE: { icon: AlertTriangle, class: 'bg-rose-50 text-rose-700' },
  WORK_DECLARATION_SUBMITTED: { icon: Send, class: 'bg-violet-50 text-violet-700' },
  WORK_DECLARATION_FORWARDED: { icon: Forward, class: 'bg-indigo-50 text-indigo-700' },
  WORK_DECLARATION_APPROVED: { icon: CheckCircle2, class: 'bg-emerald-50 text-emerald-700' },
  WORK_DECLARATION_RETURNED: { icon: RotateCcw, class: 'bg-amber-50 text-amber-700' },
}

const fetchUnreadCount = async () => {
  try {
    const result = await http('/api/notifications/unread-count')
    unreadCount.value = Number(result?.data?.count ?? 0)
  } catch {
    unreadCount.value = 0
  }
}

const fetchNotifications = async () => {
  loading.value = true
  try {
    const result = await http('/api/notifications?page=1&limit=50')
    items.value = result.data ?? []
  } finally {
    loading.value = false
  }
}

const refresh = async () => {
  await Promise.all([fetchUnreadCount(), fetchNotifications()])
}

const markRead = async (item) => {
  if (!item?._id || item.readAt) return
  await http(`/api/notifications/${item._id}/read`, { method: 'PATCH' })
  item.readAt = new Date().toISOString()
  unreadCount.value = Math.max(0, unreadCount.value - 1)
}

const markAllRead = async () => {
  await http('/api/notifications/read-all', { method: 'PATCH' })
  const readAt = new Date().toISOString()
  items.value = items.value.map((item) => ({ ...item, readAt: item.readAt || readAt }))
  unreadCount.value = 0
}

const openNotification = async (item) => {
  await markRead(item)
  open.value = false
  if (item.relatedModel === 'IncomingDocument') {
    router.push(`/documents/${item.relatedId}`)
  } else if (item.relatedModel === 'WorkDeclaration') {
    router.push('/assignments')
  } else if (item.relatedModel === 'Task') {
    router.push('/assignments')
  }
}

const formatDateTime = (value) => value ? new Date(value).toLocaleString('vi-VN') : '—'

onMounted(() => {
  refresh()
  socket = io('/', { path: '/api/socket.io', withCredentials: true, transports: ['websocket', 'polling'] })
  socket.on('notification:new', refresh)
  socket.on('notification:changed', refresh)
  socket.on('work-declaration:changed', (payload) => {
    window.dispatchEvent(new CustomEvent('work-declaration:changed', { detail: payload }))
  })
})

onUnmounted(() => {
  socket?.disconnect()
  socket = null
})
</script>

<template>
  <div class="w-full">
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="relative flex h-11 w-full items-center gap-3 overflow-hidden rounded-full px-3 text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-900"
        :class="collapsed ? 'md:justify-center' : ''"
        title="Thông báo"
      >
        <Bell class="h-5 w-5 shrink-0" />
        <span v-if="unreadCount" class="absolute left-7 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
        <span class="whitespace-nowrap text-[10px] font-medium md:text-sm" :class="collapsed ? 'md:hidden' : ''">Thông báo</span>
      </button>
    </PopoverTrigger>

    <PopoverContent
      side="right"
      align="end"
      :side-offset="24"
      :collision-padding="24"
      class="w-[min(420px,calc(100vw-48px))] overflow-hidden rounded-lg border-zinc-200 p-0 shadow-xl"
    >
      <header class="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <div><h2 class="text-sm font-bold text-zinc-900">Thông báo</h2><p class="mt-0.5 text-xs text-zinc-500">{{ unreadCount }} chưa đọc</p></div>
        <Button v-if="unreadCount" variant="ghost" size="sm" class="h-8 rounded-full text-xs" @click="markAllRead"><CheckCheck class="mr-1.5 h-4 w-4" /> Đọc tất cả</Button>
      </header>

      <div class="max-h-[min(800px,calc(100vh-144px))] overflow-y-auto">
        <div v-if="loading" class="space-y-3 p-4"><div v-for="index in 5" :key="index" class="h-16 animate-pulse rounded-md bg-zinc-100" /></div>
        <template v-else>
          <button v-for="item in items" :key="item._id" type="button" class="flex h-20 w-full items-start gap-3 overflow-hidden border-b border-zinc-100 px-4 py-3 text-left transition-colors last:border-0 hover:bg-zinc-50" :class="!item.readAt ? 'bg-indigo-50/40' : ''" @click="openNotification(item)">
            <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md" :class="(typeMeta[item.type] || defaultTypeMeta).class"><component :is="(typeMeta[item.type] || defaultTypeMeta).icon" class="h-4 w-4" /></span>
            <span class="min-w-0 flex-1"><span class="flex items-start gap-2"><span class="line-clamp-1 flex-1 text-sm font-bold text-zinc-900">{{ item.title }}</span><span v-if="!item.readAt" class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" /></span><span class="mt-0.5 line-clamp-1 block text-xs leading-5 text-zinc-600">{{ item.body || typeLabels[item.type] || 'Không có nội dung.' }}</span><span class="mt-0.5 block truncate text-[11px] font-medium text-zinc-400">{{ item.actor?.fullName ?? 'Hệ thống' }} · {{ formatDateTime(item.createdAt) }}</span></span>
          </button>
        </template>
        <div v-if="!loading && !items.length" class="px-4 py-12 text-center text-sm font-medium text-zinc-400">Chưa có thông báo.</div>
      </div>
    </PopoverContent>
  </Popover>
  </div>
</template>
