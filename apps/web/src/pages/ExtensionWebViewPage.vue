<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BarChart3, CalendarDays, Check, ClipboardCheck, Clock3, FileText, LayoutDashboard, Loader2, LogOut, Plus, RefreshCw, UserRound, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { http } from '@/shared/api/http'
import { useAuth } from '@/features/auth/composables/useAuth'

const { user, loadMe, login, logout } = useAuth()
const activeTab = ref('overview')
const booting = ref(true)
const loading = ref(false)
const error = ref('')
const payload = ref(null)
const declarations = ref([])
const approvals = ref([])
const showTaskForm = ref(false)
const showApprovals = ref(false)
const credentials = ref({ login: '', password: '', remember: true })
const task = ref({ title: '', description: '', workStartAt: '', workEndAt: '', declaredPoint: 0 })
const loadingDots = ref(Array.from({ length: 9 }, () => false))
let loadingDotsTimer = null

const canApprove = computed(() => Number(user.value?.role?.level ?? 99) <= 3 && user.value?.role?.code !== 'SPECIALIST')
const overview = computed(() => payload.value?.data ?? {})
const taskSummary = computed(() => overview.value.tasks?.summary ?? {})
const documentSummary = computed(() => overview.value.ingestDocuments?.summary ?? {})
const documentPerformance = computed(() => overview.value.ingestDocuments?.performance ?? {})
const incomingDateRank = (value) => {
  const match = String(value ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : 0
}
const documents = computed(() => [...(overview.value.ingestDocuments?.items ?? [])].sort((left, right) => {
  const byArrivalDate = incomingDateRank(right.ngayDen) - incomingDateRank(left.ngayDen)
  if (byArrivalDate) return byArrivalDate
  return new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime()
}))
const dayKey = (value) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
const todayKey = () => dayKey(new Date())
const toDateTimeLocal = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)).replace(' ', 'T')
const formatTime = (value) => value ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
const formatDate = (value) => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
const taskStatus = (value) => ({ DRAFT: 'Nháp', PENDING_APPROVAL: 'Chờ duyệt', RETURNED: 'Cần bổ sung', APPROVED: 'Đã duyệt', CANCELLED: 'Đã hủy' }[value] ?? value)
const documentStatus = (item) => {
  if (item?.completed || ['COMPLETED', 'MANUALLY_PROCESSED'].includes(item?.processingStatus)) return 'Đã xử lý'
  if (item?.processingStatus === 'IN_PROGRESS') return 'Đang xử lý'
  return 'Chưa xác định'
}
const currentProcessor = (item) => item?.currentAssignee?.fullName
  || item?.currentAssignee?.externalFullName
  || item?.currentAssignee?.username
  || item?.currentAssignee?.externalUsername
  || 'Chưa xác định'
const latestTrackLogText = (item) => {
  const log = item?.latestTrackLog
  if (!log) return 'Chưa có tracklog.'
  const sender = log.sender?.fullName || log.sender?.username
  return [sender, log.content || 'Cập nhật xử lý'].filter(Boolean).join(' · ')
}
const todayTasks = computed(() => declarations.value.filter((item) => dayKey(item.workStartAt) === todayKey() && item.status !== 'CANCELLED'))
const approvalCount = computed(() => approvals.value.length)
const isOverlayLoading = computed(() => booting.value || loading.value)

const stopLoadingDots = () => {
  if (loadingDotsTimer) window.clearInterval(loadingDotsTimer)
  loadingDotsTimer = null
  loadingDots.value = Array.from({ length: 9 }, () => false)
}

const startLoadingDots = () => {
  if (loadingDotsTimer) return
  const update = () => {
    loadingDots.value = Array.from({ length: 9 }, () => Math.random() > 0.52)
  }
  update()
  loadingDotsTimer = window.setInterval(update, 170)
}

const setDefaultTaskTime = () => {
  const start = new Date()
  start.setSeconds(0, 0)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  task.value = { title: '', description: '', workStartAt: toDateTimeLocal(start), workEndAt: toDateTimeLocal(end), declaredPoint: 0 }
}

const loadWorkspace = async () => {
  if (!user.value) return
  loading.value = true
  error.value = ''
  try {
    const [overviewResult, declarationResult, approvalResult] = await Promise.all([
      http('/api/extension/overview?limit=50'),
      http('/api/work-declarations?limit=100'),
      canApprove.value ? http('/api/work-declarations?pendingForMe=true&limit=30') : Promise.resolve({ data: [] }),
    ])
    payload.value = overviewResult
    declarations.value = declarationResult?.data ?? []
    approvals.value = approvalResult?.data ?? []
  } catch (requestError) {
    error.value = requestError.message || 'Không thể tải dữ liệu extension.'
  } finally {
    loading.value = false
  }
}

const handleLogin = async () => {
  if (!credentials.value.login || !credentials.value.password) return
  loading.value = true
  error.value = ''
  try {
    await login(credentials.value)
    await loadWorkspace()
  } catch (requestError) {
    error.value = requestError.message || 'Đăng nhập không thành công.'
  } finally {
    loading.value = false
  }
}

const createTask = async () => {
  loading.value = true
  error.value = ''
  try {
    const created = await http('/api/work-declarations', { body: {
      ...task.value,
      workStartAt: new Date(task.value.workStartAt).toISOString(),
      workEndAt: new Date(task.value.workEndAt).toISOString(),
      declaredPoint: Number(task.value.declaredPoint || 0),
    } })
    await http(`/api/work-declarations/${created.data._id}/submit`, { body: {} })
    showTaskForm.value = false
    await loadWorkspace()
  } catch (requestError) {
    error.value = requestError.message || 'Không thể khai báo công việc.'
  } finally {
    loading.value = false
  }
}

const approve = async (item) => {
  loading.value = true
  error.value = ''
  try {
    await http(`/api/work-declarations/${item._id}/approve`, { body: {} })
    await loadWorkspace()
  } catch (requestError) {
    error.value = requestError.message || 'Không thể duyệt công việc.'
  } finally {
    loading.value = false
  }
}

const openTaskForm = () => { setDefaultTaskTime(); showTaskForm.value = true }
const signOut = async () => { await logout(); payload.value = null; declarations.value = []; approvals.value = [] }
watch(activeTab, () => { error.value = '' })
watch(isOverlayLoading, (active) => {
  if (active) startLoadingDots()
  else stopLoadingDots()
}, { immediate: true })

onMounted(async () => {
  await loadMe()
  if (user.value) await loadWorkspace()
  booting.value = false
})

onBeforeUnmount(stopLoadingDots)
</script>

<template>
  <main class="extension-shell">
    <section v-if="booting" class="center-state" />
    <section v-else-if="!user" class="login-view">
      <div class="brand"><span class="brand-mark"><LayoutDashboard class="h-5 w-5" /></span><div><strong>eWork</strong><small>Extension workspace</small></div></div>
      <form class="login-form" @submit.prevent="handleLogin">
        <label>Tài khoản<Input v-model="credentials.login" autocomplete="username" required /></label>
        <label>Mật khẩu<Input v-model="credentials.password" type="password" autocomplete="current-password" required /></label>
        <p v-if="error" class="error-text">{{ error }}</p>
        <Button class="w-full" :disabled="loading"><Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />Đăng nhập</Button>
      </form>
    </section>
    <template v-else>
      <header class="extension-header"><div class="brand"><span class="brand-mark"><LayoutDashboard class="h-4 w-4" /></span><strong>eWork</strong></div><div class="header-actions"><Button variant="ghost" size="icon" title="Tải lại" :disabled="loading" @click="loadWorkspace"><RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" /></Button><Button variant="ghost" size="icon" title="Đăng xuất" @click="signOut"><LogOut class="h-4 w-4" /></Button></div></header>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <section class="extension-content">
        <template v-if="activeTab === 'overview'">
          <div class="metric-grid">
            <article><span>Việc hôm nay</span><strong>{{ taskSummary.today ?? 0 }}</strong></article>
            <article><span>Quá hạn</span><strong class="danger">{{ taskSummary.overdue ?? 0 }}</strong></article>
            <article><span>Văn bản có hạn</span><strong>{{ documentSummary.total ?? 0 }}</strong></article>
            <article><span>Tổng điểm</span><strong>{{ documentPerformance.totalPoint ?? 0 }}</strong></article>
          </div>
          <section class="document-section">
            <header class="document-section-header">
              <div><FileText class="h-4 w-4" /><h2>Văn bản đến</h2></div>
              <span>{{ documentSummary.total ?? 0 }} bản</span>
            </header>
            <article v-for="item in documents" :key="item.id" class="compact-document-card">
              <header>
                <div>
                  <strong>{{ item.soKyHieu || '—' }}</strong>
                  <span v-if="item.ngayDen">Ngày đến {{ item.ngayDen }}</span>
                </div>
                <b :class="{ done: documentStatus(item) === 'Đã xử lý' }">{{ documentStatus(item) }}</b>
              </header>
              <p class="document-summary">{{ item.trichYeu || 'Không có trích yếu.' }}</p>
              <div class="compact-document-meta">
                <span><UserRound class="h-3.5 w-3.5" />{{ currentProcessor(item) !== 'Chưa xác định' ? currentProcessor(item) : (item.nguoiXuLy || 'Chưa xác định') }}</span>
                <span>{{ item.point ?? 0 }} điểm</span>
                <span>Hạn {{ formatDate(item.deadline) }}</span>
              </div>
              <p class="compact-document-log"><Clock3 class="h-3.5 w-3.5" />{{ latestTrackLogText(item) }}</p>
            </article>
            <p v-if="!documents.length" class="empty">Chưa có văn bản đến đã ingest.</p>
          </section>
        </template>
        <template v-else-if="activeTab === 'assignment'"><div class="section-header"><div><h1>Lịch hôm nay</h1><p>{{ todayTasks.length }} công việc</p></div><div class="section-actions"><Button v-if="canApprove" variant="outline" size="sm" @click="showApprovals = true"><ClipboardCheck class="mr-1 h-4 w-4" />Duyệt {{ approvalCount }}</Button><Button size="sm" @click="openTaskForm"><Plus class="mr-1 h-4 w-4" />Khai báo</Button></div></div><section class="schedule"><article v-for="item in todayTasks" :key="item._id" class="schedule-item"><time>{{ formatTime(item.workStartAt) }}<br>{{ formatTime(item.workEndAt) }}</time><div><strong>{{ item.title }}</strong><span>{{ item.declaredPoint ?? 0 }} điểm · {{ taskStatus(item.status) }}</span></div></article><p v-if="!todayTasks.length" class="empty">Chưa có lịch công việc hôm nay.</p></section></template>
        <template v-else><div class="metric-grid performance"><article><span>Hoàn thành</span><strong class="success">{{ documentPerformance.completedPoint ?? 0 }}</strong><small>{{ documentPerformance.completionRate ?? 0 }}%</small></article><article><span>Đang xử lý</span><strong>{{ documentPerformance.pendingPoint ?? 0 }}</strong></article><article><span>Quá hạn</span><strong class="danger">{{ documentPerformance.overduePoint ?? 0 }}</strong><small>{{ documentSummary.overdue ?? 0 }} văn bản</small></article><article><span>Gần hạn</span><strong>{{ documentPerformance.dueSoonPoint ?? 0 }}</strong></article></div><section class="list-section"><h2>Văn bản theo hạn</h2><article v-for="item in documents" :key="item.id" class="list-item"><div><strong>{{ item.soKyHieu || 'Văn bản đến' }}</strong><span>{{ item.trichYeu || 'Không có trích yếu.' }}</span><small>Hạn {{ formatDate(item.deadline) }}</small></div><b>{{ item.point ?? 0 }}đ</b></article><p v-if="!documents.length" class="empty">Chưa có văn bản theo dõi.</p></section></template>
      </section>
      <nav class="bottom-nav"><button :class="{ active: activeTab === 'assignment' }" @click="activeTab = 'assignment'"><CalendarDays class="h-5 w-5" /><span>Lịch</span></button><button :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'"><LayoutDashboard class="h-5 w-5" /><span>Tổng quan</span></button><button :class="{ active: activeTab === 'performance' }" @click="activeTab = 'performance'"><BarChart3 class="h-5 w-5" /><span>Hiệu suất</span></button></nav>
      <div v-if="showTaskForm || showApprovals" class="modal-backdrop" @click.self="showTaskForm = false; showApprovals = false"><section v-if="showTaskForm" class="modal"><header><div><small>Khai báo</small><h2>Công việc mới</h2></div><Button variant="ghost" size="icon" @click="showTaskForm = false"><X class="h-4 w-4" /></Button></header><form class="task-form" @submit.prevent="createTask"><label>Tên việc<Input v-model="task.title" required /></label><div class="two-col"><label>Bắt đầu<Input v-model="task.workStartAt" type="datetime-local" required /></label><label>Kết thúc<Input v-model="task.workEndAt" type="datetime-local" required /></label></div><label>Điểm<Input v-model="task.declaredPoint" type="number" min="0" required /></label><label>Mô tả<Textarea v-model="task.description" rows="3" /></label><Button :disabled="loading">Gửi duyệt</Button></form></section><section v-else class="modal"><header><div><small>Duyệt việc</small><h2>{{ approvalCount }} yêu cầu</h2></div><Button variant="ghost" size="icon" @click="showApprovals = false"><X class="h-4 w-4" /></Button></header><div class="approval-list"><article v-for="item in approvals" :key="item._id"><div><strong>{{ item.title }}</strong><span>{{ item.createdBy?.fullName || '—' }} · {{ formatDate(item.workStartAt) }}</span><small>{{ item.declaredPoint ?? 0 }} điểm</small></div><Button size="sm" @click="approve(item)"><Check class="mr-1 h-4 w-4" />Duyệt</Button></article><p v-if="!approvalCount" class="empty">Không có yêu cầu chờ duyệt.</p></div></section></div>
    </template>
    <div v-if="isOverlayLoading" class="loading-overlay" aria-live="polite" aria-label="Đang tải">
      <div class="loading-dots" aria-hidden="true"><span v-for="(isBright, index) in loadingDots" :key="index" :class="{ bright: isBright }" /></div>
    </div>
  </main>
</template>

<style scoped>
.extension-shell { position: relative; min-height: 100dvh; background: #f7f8fb; color: #18181b; font: 14px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; }
.document-section { margin-top: 12px; overflow: hidden; border: 1px solid #e4e4e7; border-radius: 8px; background: #fff; }
.document-section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 12px; border-bottom: 1px solid #f0f0f1; }
.document-section-header > div { display: flex; align-items: center; gap: 6px; }
.document-section-header h2 { margin: 0; font-size: 13px; }
.document-section-header svg { color: #2563eb; }
.document-section-header > span { color: #71717a; font-size: 11px; font-weight: 700; }
.incoming-document-card { padding: 12px; border-bottom: 1px solid #ececf0; }
.incoming-document-card:last-of-type { border-bottom: 0; }
.incoming-document-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.incoming-document-card header small, .incoming-document-card header span { display: block; color: #71717a; font-size: 10px; font-weight: 700; }
.incoming-document-card header strong { display: block; margin-top: 1px; font-size: 14px; }
.incoming-document-card header b { flex: 0 0 auto; padding: 4px 7px; border-radius: 999px; background: #fff7ed; color: #c2410c; font-size: 10px; white-space: nowrap; }
.incoming-document-card header b.done { background: #ecfdf5; color: #047857; }
.document-summary { display: -webkit-box; margin: 8px 0; overflow: hidden; color: #3f3f46; font-size: 12px; font-weight: 650; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.incoming-document-card dl { display: grid; gap: 6px; margin: 0; }
.incoming-document-card dl > div { display: grid; grid-template-columns: 112px minmax(0, 1fr); align-items: start; gap: 6px; }
.incoming-document-card dt { display: flex; align-items: center; gap: 4px; color: #71717a; font-size: 10px; font-weight: 750; }
.incoming-document-card dd { display: -webkit-box; margin: 0; overflow: hidden; color: #27272a; font-size: 11px; font-weight: 650; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.incoming-document-card footer { display: flex; gap: 14px; margin-top: 10px; padding-top: 8px; border-top: 1px solid #f0f0f1; color: #2563eb; font-size: 11px; font-weight: 800; }
.incoming-document-card footer span { display: inline-flex; gap: 4px; }
.incoming-document-card footer b { color: #71717a; font-weight: 700; }
.compact-document-card { padding: 10px 12px; border-bottom: 1px solid #ececf0; }
.compact-document-card:last-of-type { border-bottom: 0; }
.compact-document-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.compact-document-card header strong { display: block; font-size: 13px; }
.compact-document-card header span { display: block; margin-top: 1px; color: #71717a; font-size: 10px; font-weight: 700; }
.compact-document-card header b { flex: 0 0 auto; padding: 3px 6px; border-radius: 999px; background: #fff7ed; color: #c2410c; font-size: 9px; white-space: nowrap; }
.compact-document-card header b.done { background: #ecfdf5; color: #047857; }
.compact-document-card .document-summary { margin: 5px 0; font-size: 11px; -webkit-line-clamp: 1; }
.compact-document-meta { display: flex; align-items: center; gap: 5px 9px; overflow: hidden; color: #52525b; font-size: 10px; font-weight: 650; white-space: nowrap; }
.compact-document-meta span { display: inline-flex; align-items: center; gap: 3px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.compact-document-meta span:first-child { flex: 1 1 auto; }
.compact-document-log { display: flex; align-items: center; gap: 4px; margin: 5px 0 0; overflow: hidden; color: #71717a; font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.compact-document-log svg { flex: 0 0 auto; }
.center-state, .login-view { min-height: 100dvh; display: grid; place-content: center; gap: 16px; padding: 24px; }.login-view { align-content: center; max-width: 390px; margin: auto; }.brand { display: flex; align-items: center; gap: 9px; }.brand-mark { display: grid; place-items: center; width: 31px; height: 31px; border-radius: 8px; background: #2563eb; color: white; }.brand small { display: block; color: #71717a; font-size: 10px; }.login-form, .task-form { display: grid; gap: 13px; margin-top: 18px; }.login-form label, .task-form label { display: grid; gap: 6px; color: #52525b; font-size: 12px; font-weight: 700; }.extension-header { height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid #e4e4e7; background: #fff; }.header-actions { display: flex; }.extension-content { min-height: calc(100dvh - 112px); padding: 14px; }.metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }.metric-grid article, .list-section, .schedule { border: 1px solid #e4e4e7; border-radius: 8px; background: white; }.metric-grid article { padding: 12px; }.metric-grid span, .metric-grid small { display: block; color: #71717a; font-size: 11px; font-weight: 700; }.metric-grid strong { display: block; margin-top: 4px; font-size: 23px; }.danger { color: #e11d48; }.success { color: #059669; }.list-section, .schedule { margin-top: 12px; overflow: hidden; }.list-section h2 { margin: 0; padding: 12px; font-size: 13px; border-bottom: 1px solid #f0f0f1; }.list-item, .schedule-item, .approval-list article { display: flex; justify-content: space-between; gap: 10px; padding: 11px 12px; border-bottom: 1px solid #f0f0f1; }.list-item:last-child, .schedule-item:last-child, .approval-list article:last-child { border: 0; }.list-item div, .schedule-item div { min-width: 0; }.list-item strong, .schedule-item strong, .approval-list strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.list-item span, .list-item small, .schedule-item span, .approval-list span, .approval-list small { display: block; margin-top: 3px; color: #71717a; font-size: 11px; }.list-item b { color: #2563eb; white-space: nowrap; }.section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.section-header h1 { margin: 0; font-size: 17px; }.section-header p { margin: 2px 0 0; color: #71717a; font-size: 11px; }.section-actions { display: flex; gap: 6px; }.schedule-item time { width: 43px; color: #2563eb; font-size: 11px; font-weight: 800; }.bottom-nav { position: sticky; bottom: 0; display: grid; grid-template-columns: repeat(3, 1fr); height: 56px; border-top: 1px solid #e4e4e7; background: white; }.bottom-nav button { display: grid; place-items: center; gap: 1px; border: 0; background: transparent; color: #71717a; font-size: 10px; }.bottom-nav button.active { color: #2563eb; font-weight: 800; }.modal-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; align-items: end; background: rgba(24, 24, 27, .36); }.modal { max-height: 92dvh; overflow: auto; padding: 16px; border-radius: 12px 12px 0 0; background: white; }.modal header { display: flex; justify-content: space-between; align-items: start; }.modal header small { color: #2563eb; font-weight: 800; text-transform: uppercase; }.modal h2 { margin: 2px 0 0; font-size: 18px; }.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.empty { margin: 0; padding: 22px 12px; color: #a1a1aa; text-align: center; font-size: 12px; }.error-text, .error-banner { color: #be123c; font-size: 12px; }.error-banner { padding: 8px 14px; background: #fff1f2; }.approval-list { margin-top: 12px; border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden; }.approval-list article { align-items: center; }.loading-overlay { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(247, 248, 251, .76); backdrop-filter: blur(3px); }.loading-dots { display: grid; grid-template-columns: repeat(3, 9px); gap: 7px; }.loading-dots span { width: 9px; height: 9px; border-radius: 999px; background: #2563eb; opacity: .16; transform: scale(.82); transition: opacity 130ms ease, transform 130ms ease; }.loading-dots span.bright { opacity: 1; transform: scale(1); }
</style>
