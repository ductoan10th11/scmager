<script setup>
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { io } from 'socket.io-client'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Power,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { http } from '@/shared/api/http'

const loading = ref(false)
const actionLoading = ref(false)
const socketConnected = ref(false)
const error = ref(null)
const INITIAL_LOG_LIMIT = 10
const DISPLAY_LOG_LIMIT = 50
const SYNC_INTERVAL_MS = 15_000
const status = ref({
  enabled: false,
  running: false,
  intervalMs: 0,
  nextRunAt: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSummary: null,
  lastError: '',
  logSize: 0,
})
const logs = shallowRef([])
let socket = null
let syncTimer = null
let flushHandle = null
let pendingLogBuffer = []

const statusTone = computed(() => {
  if (status.value.running) return 'border-sky-200 bg-sky-50 text-sky-700'
  if (status.value.enabled) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-zinc-200 bg-zinc-50 text-zinc-600'
})

const statusLabel = computed(() => {
  if (status.value.running) return 'Đang chạy'
  if (status.value.enabled) return 'Đang bật'
  return 'Đang tắt'
})

const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN')
}

const formatMs = (value) => {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`
}

const compactSummary = (summary) => {
  if (!summary) return '—'
  const d = summary.discovery ?? {}
  const e = summary.enrichment ?? {}
  return [
    `scan ${d.scannedItems ?? 0}`,
    `new ${d.inserted ?? 0}`,
    `enriched ${e.enriched ?? 0}`,
    `done ${e.completed ?? 0}`,
    `failed ${e.failed ?? 0}`,
    `dlq ${e.deadLettered ?? 0}`,
  ].join(' · ')
}

const terminalLevelClass = (level) => {
  if (level === 'ERROR') return 'text-rose-300'
  if (level === 'WARN') return 'text-amber-300'
  return 'text-emerald-300'
}

const terminalTime = (value) => {
  if (!value) return '--:--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('vi-VN', { hour12: false })
}

const terminalLine = (log) => {
  const actor = log.actor?.username || log.actor?.fullName || 'system'
  const summary = log.summary ? ` :: ${compactSummary(log.summary)}` : ''
  return `${log.event} | ${log.error || log.message}${summary} | ${actor}`
}

const mapLog = (log) => ({
  ...log,
  displayTime: terminalTime(log.at),
  levelClass: terminalLevelClass(log.level),
  line: terminalLine(log),
})

const flushPendingLogs = () => {
  flushHandle = null
  if (!pendingLogBuffer.length) return

  const incoming = pendingLogBuffer.splice(0).reverse().map(mapLog)
  const incomingIds = new Set(incoming.map((item) => item.id))
  logs.value = [
    ...incoming,
    ...logs.value.filter((item) => !incomingIds.has(item.id)),
  ].slice(0, DISPLAY_LOG_LIMIT)
}

const upsertLog = (log) => {
  if (!log?.id) return
  pendingLogBuffer.push(log)
  if (pendingLogBuffer.length > DISPLAY_LOG_LIMIT) {
    pendingLogBuffer = pendingLogBuffer.slice(-DISPLAY_LOG_LIMIT)
  }
  if (flushHandle !== null) return
  flushHandle = window.requestAnimationFrame(flushPendingLogs)
}

const fetchSnapshot = async () => {
  loading.value = true
  error.value = null
  try {
    const [statusRes, logRes] = await Promise.all([
      http('/api/ingest-cron/status'),
      http(`/api/ingest-cron/logs?limit=${INITIAL_LOG_LIMIT}`),
    ])
    status.value = statusRes.data ?? status.value
    logs.value = (logRes.data ?? []).slice(0, DISPLAY_LOG_LIMIT).map(mapLog)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const syncStatus = async () => {
  try {
    const res = await http('/api/ingest-cron/status')
    status.value = res.data ?? status.value
  } catch {
    // The visible API error area is reserved for user-triggered actions.
  }
}

const setCronEnabled = async (checked) => {
  if (checked === status.value.enabled || actionLoading.value) return

  actionLoading.value = true
  error.value = null
  try {
    const endpoint = checked ? '/api/ingest-cron/start' : '/api/ingest-cron/stop'
    const res = await http(endpoint, { method: 'POST' })
    status.value = res.data ?? status.value
    await syncStatus()
  } catch (e) {
    error.value = e.message
    await syncStatus()
  } finally {
    actionLoading.value = false
  }
}

const clearLogs = async () => {
  actionLoading.value = true
  error.value = null
  try {
    const res = await http('/api/ingest-cron/clear-logs', { method: 'POST' })
    pendingLogBuffer = []
    if (flushHandle !== null) {
      window.cancelAnimationFrame(flushHandle)
      flushHandle = null
    }
    logs.value = (res.data ?? []).map(mapLog)
  } catch (e) {
    error.value = e.message
  } finally {
    actionLoading.value = false
  }
}

const connectSocket = () => {
  socket = io('/', {
    path: '/api/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
  })

  socket.on('connect', () => {
    socketConnected.value = true
    syncStatus()
  })
  socket.on('disconnect', () => {
    socketConnected.value = false
  })
  socket.on('connect_error', (e) => {
    socketConnected.value = false
    error.value = e.message
  })
  socket.on('ingest:cron:status', (payload) => {
    status.value = payload ?? status.value
  })
  socket.on('ingest:cron:log', upsertLog)
  socket.on('ingest:cron:logs-cleared', () => {
    pendingLogBuffer = []
    if (flushHandle !== null) {
      window.cancelAnimationFrame(flushHandle)
      flushHandle = null
    }
    logs.value = []
  })
}

onMounted(() => {
  fetchSnapshot()
  connectSocket()
  syncTimer = window.setInterval(syncStatus, SYNC_INTERVAL_MS)
})

onUnmounted(() => {
  socket?.disconnect()
  socket = null
  if (syncTimer) {
    window.clearInterval(syncTimer)
    syncTimer = null
  }
  if (flushHandle !== null) {
    window.cancelAnimationFrame(flushHandle)
    flushHandle = null
  }
})
</script>

<template>
  <section class="h-full overflow-auto bg-zinc-50/60">
    <header class="border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-xl font-bold text-zinc-900">
            <Activity class="h-5 w-5 text-emerald-600" /> Ingest monitor
          </h1>
          <p class="mt-1 text-sm text-zinc-500">Cron, trạng thái worker và log realtime</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="loading" @click="fetchSnapshot">
            <RefreshCw class="mr-2 h-4 w-4" /> Tải lại
          </Button>
          <div class="flex h-10 items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 shadow-sm">
            <Loader2 v-if="actionLoading" class="h-4 w-4 animate-spin text-zinc-400" />
            <span v-else class="h-2.5 w-2.5 rounded-full" :class="status.enabled ? 'bg-emerald-500' : 'bg-zinc-300'"></span>
            <span class="text-sm font-bold text-zinc-800">{{ status.enabled ? 'Cron bật' : 'Cron tắt' }}</span>
            <button
              type="button"
              role="switch"
              :aria-checked="status.enabled"
              :disabled="actionLoading"
              class="relative h-6 w-11 shrink-0 rounded-full p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="status.enabled ? 'bg-emerald-600' : 'bg-zinc-200'"
              @click="setCronEnabled(!status.enabled)"
            >
              <span
                class="block h-5 w-5 rounded-full bg-white shadow transition-transform"
                :class="status.enabled ? 'translate-x-5' : 'translate-x-0'"
              ></span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 sm:px-6">
      <div v-if="error" class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{{ error }}</div>

      <section class="grid gap-3 md:grid-cols-4">
        <div class="rounded-2xl border bg-white p-4 shadow-sm" :class="statusTone">
          <div class="flex items-center justify-between">
            <p class="text-xs font-bold uppercase">Cron</p>
            <Power class="h-4 w-4" />
          </div>
          <p class="mt-3 text-2xl font-black">{{ statusLabel }}</p>
          <p class="mt-1 text-xs font-medium">Chu kỳ {{ formatMs(status.intervalMs) }}</p>
        </div>
        <div class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between text-zinc-500">
            <p class="text-xs font-bold uppercase">Socket</p>
            <CheckCircle2 v-if="socketConnected" class="h-4 w-4 text-emerald-600" />
            <AlertTriangle v-else class="h-4 w-4 text-amber-600" />
          </div>
          <p class="mt-3 text-2xl font-black text-zinc-900">{{ socketConnected ? 'Online' : 'Offline' }}</p>
          <p class="mt-1 text-xs font-medium text-zinc-500">{{ logs.length }} log đang hiển thị</p>
        </div>
        <div class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between text-zinc-500">
            <p class="text-xs font-bold uppercase">Lần chạy kế</p>
            <Clock class="h-4 w-4" />
          </div>
          <p class="mt-3 text-sm font-bold leading-6 text-zinc-900">{{ formatDateTime(status.nextRunAt) }}</p>
          <p class="mt-1 text-xs font-medium text-zinc-500">Lần xong: {{ formatDateTime(status.lastFinishedAt) }}</p>
        </div>
        <div class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between text-zinc-500">
            <p class="text-xs font-bold uppercase">Sprint cuối</p>
            <Activity class="h-4 w-4" />
          </div>
          <p class="mt-3 text-xs font-semibold leading-5 text-zinc-900">{{ compactSummary(status.lastSummary) }}</p>
          <p class="mt-1 truncate text-xs font-medium text-rose-600">{{ status.lastError || 'Không có lỗi gần nhất' }}</p>
        </div>
      </section>

      <section class="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#111214] shadow-sm">
        <div class="flex h-11 shrink-0 items-center justify-between border-b border-white/10 bg-[#202124] px-4">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 font-mono text-xs font-semibold text-zinc-300">
              <span>ingest-cron</span>
              <span class="text-zinc-600">/</span>
              <span class="text-zinc-500">{{ socketConnected ? 'socket online' : 'socket offline' }}</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" class="h-8 px-2 text-zinc-300 hover:bg-white/10 hover:text-white" :disabled="actionLoading || !logs.length" @click="clearLogs">
            <Trash2 class="mr-2 h-4 w-4" /> Clear
          </Button>
        </div>

        <div v-if="loading" class="flex flex-1 items-center justify-center bg-[#0b0c0e] font-mono text-sm text-zinc-400">
          <Loader2 class="mr-2 h-4 w-4 animate-spin" /> loading cron log...
        </div>
        <div v-else class="min-h-0 flex-1 overflow-auto bg-[#0b0c0e] px-4 py-3 font-mono text-[12px] leading-6" style="contain: content;">
          <template v-if="logs.length">
            <div v-for="log in logs" :key="log.id" class="grid min-w-[920px] grid-cols-[78px_58px_minmax(0,1fr)] gap-3 border-b border-white/[0.04] py-1">
              <span class="whitespace-nowrap text-zinc-500">{{ log.displayTime }}</span>
              <span class="font-bold" :class="log.levelClass">{{ log.level }}</span>
              <span class="min-w-0 break-words text-zinc-200">{{ log.line }}</span>
            </div>
          </template>
          <div v-else class="flex h-full items-center justify-center text-sm font-medium text-zinc-500">
            $ waiting for cron output...
          </div>
        </div>
      </section>
    </main>
  </section>
</template>
