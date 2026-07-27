<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  ArrowRight,
  Building2,
  CircleAlert,
  CircleCheck,
  Clock3,
  DatabaseZap,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table } from '@/components/ui/table'
import TableBody from '@/components/ui/table/TableBody.vue'
import TableCell from '@/components/ui/table/TableCell.vue'
import TableHead from '@/components/ui/table/TableHead.vue'
import TableHeader from '@/components/ui/table/TableHeader.vue'
import TableRow from '@/components/ui/table/TableRow.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { OrganizationService } from '@/features/organizations/services/organization.service'
import { http } from '@/shared/api/http'

const connectors = ref([])
const organizations = ref([])
const loading = ref(true)
const saving = ref(false)
const createOpen = ref(false)
const editing = ref(null)
const deleteTarget = ref(null)
const deleting = ref(false)
const error = ref('')
const actionMessage = ref('')
const actioningId = ref('')
const operational = ref({})
const form = ref({ organizationId: '', name: '', username: '', password: '', sourceSystem: 'LANGSON_DWR' })
const { user } = useAuth()

const organizationById = computed(() => new Map(organizations.value.map((organization) => [organization._id, organization])))
const canProvision = computed(() => user.value?.role?.code === 'ADMIN' && !user.value?.organization)
const activeCount = computed(() => connectors.value.filter((item) => item.state === 'ACTIVE').length)
const reviewCount = computed(() => connectors.value.filter((item) => ['DRAFT', 'BLOCKED'].includes(item.state)).length)

const resetForm = () => {
  form.value = { organizationId: '', name: '', username: '', password: '', sourceSystem: 'LANGSON_DWR' }
}

const organizationLabel = (id) => {
  const organization = organizationById.value.get(String(id))
  return organization ? organization.name : 'Tổ chức không còn khả dụng'
}

const formatDateTime = (value) => {
  if (!value) return 'Chưa lên lịch'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Chưa lên lịch' : date.toLocaleString('vi-VN')
}

const latestRun = (connectorId) => operational.value[connectorId]?.latestRun ?? null

const failureLabel = (reasonCode, sessionStatus) => ({
  SECRET_NOT_CONFIGURED: 'Chưa cấu hình secret trên worker',
  SECRET_REFERENCE_INVALID: 'Secret reference không hợp lệ',
  SECRET_FORMAT_INVALID: 'Secret phải là JSON có username và password',
  SOURCE_AUTH_FAILED: 'Tài khoản ingest bị từ chối',
  SOURCE_SESSION_FAILED: 'Phiên kết nối nguồn dữ liệu không hợp lệ',
  STALE_FENCE: 'Job đã được thay thế an toàn',
}[reasonCode] || (sessionStatus === 'REAUTH_REQUIRED'
  ? 'Cần cấu hình lại secret/tài khoản ingest'
  : 'Ingest thất bại — có thể thử lại'))

const latestRunLabel = (connectorId) => {
  if (operational.value[connectorId]?.error) return 'Không tải được trạng thái'
  const run = latestRun(connectorId)
  if (!run) return 'Chưa có job'
  if (run.state === 'SUCCEEDED') return 'Hoàn tất'
  if (run.state === 'FAILED') return failureLabel(run.reasonCode, operational.value[connectorId]?.connector?.session?.status)
  if (run.state === 'CLAIMED') return 'Đang chạy'
  if (run.state === 'STALE') return 'Đã thay phiên chạy'
  return run.state || 'Đang chờ'
}

const latestRunClass = (connectorId) => ({
  SUCCEEDED: 'text-emerald-700',
  FAILED: 'text-rose-700',
  CLAIMED: 'text-blue-700',
  STALE: 'text-amber-700',
}[latestRun(connectorId)?.state] || (operational.value[connectorId]?.error ? 'text-rose-700' : 'text-zinc-500'))

const stateMeta = (state) => ({
  ACTIVE: { label: 'Đang hoạt động', class: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CircleCheck },
  DELETING: { label: 'Đang xóa', class: 'border-rose-200 bg-rose-50 text-rose-700', icon: Loader2 },
  BLOCKED: { label: 'Cần xử lý', class: 'border-amber-200 bg-amber-50 text-amber-700', icon: CircleAlert },
  DISABLED: { label: 'Đã tắt', class: 'border-zinc-200 bg-zinc-100 text-zinc-600', icon: CircleAlert },
  DRAFT: { label: 'Chờ thiết lập', class: 'border-blue-200 bg-blue-50 text-blue-700', icon: Clock3 },
}[state] || { label: state || 'Không xác định', class: 'border-zinc-200 bg-zinc-100 text-zinc-600', icon: CircleAlert })

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const [connectorRes, organizationRes] = await Promise.all([
      http('/api/connectors'),
      OrganizationService.getOrganizations({ limit: 100 }),
    ])
    connectors.value = connectorRes.data ?? []
    organizations.value = organizationRes.data ?? []
    const results = await Promise.all(
      connectors.value.map(async (connector) => {
        try {
          const response = await http(`/api/connectors/${connector._id}/operational-status`)
          return [connector._id, response.data]
        } catch {
          return [connector._id, { error: true }]
        }
      }),
    )
    operational.value = Object.fromEntries(results)
  } catch (exception) {
    error.value = exception.message || 'Không thể tải danh sách Connector.'
  } finally {
    loading.value = false
  }
}

const operate = async (item, action) => {
  if (actioningId.value) return
  actioningId.value = item._id
  error.value = ''
  actionMessage.value = ''
  const messages = {
    activate: `Đã kích hoạt ${item.name}.`,
    disable: `Đã tắt ${item.name}.`,
    run: `Đã tạo job ingest cho ${item.name}.`,
  }
  const endpoints = {
    activate: `/api/connectors/${item._id}/activate`,
    disable: `/api/connectors/${item._id}/disable`,
    run: `/api/connectors/${item._id}/runs`,
  }
  try {
    await http(endpoints[action], { method: 'POST' })
    actionMessage.value = messages[action]
    await load()
  } catch (exception) {
    error.value = exception.message || 'Không thể cập nhật Connector.'
  } finally {
    actioningId.value = ''
  }
}

const openCreate = () => {
  error.value = ''
  editing.value = null
  resetForm()
  createOpen.value = true
}

const openEdit = (item) => {
  error.value = ''
  editing.value = item
  form.value = {
    organizationId: item.organizationId,
    name: item.name,
    username: '',
    password: '',
    sourceSystem: item.sourceSystem,
  }
  createOpen.value = true
}

const saveConnector = async () => {
  saving.value = true
  error.value = ''
  try {
    if (editing.value) {
      const body = { name: form.value.name }
      if (form.value.username || form.value.password) {
        if (!form.value.username || !form.value.password) {
          error.value = 'Nhập đủ tên tài khoản và mật khẩu ingest, hoặc để trống cả hai để giữ nguyên.'
          return
        }
        body.ingestAccount = { username: form.value.username, password: form.value.password }
      }
      await http(`/api/connectors/${editing.value._id}`, { method: 'PATCH', body })
    } else {
      await http('/api/connectors', {
        method: 'POST',
        body: {
          organizationId: form.value.organizationId,
          name: form.value.name,
          sourceSystem: form.value.sourceSystem,
          ingestAccount: { username: form.value.username, password: form.value.password },
        },
      })
    }
    createOpen.value = false
    editing.value = null
    await load()
  } catch (exception) {
    error.value = exception.message || 'Không thể lưu Connector.'
  } finally {
    saving.value = false
  }
}

const openRemove = (item) => {
  error.value = ''
  deleteTarget.value = item
}

const removeConnector = async () => {
  if (!deleteTarget.value) return
  deleting.value = true
  error.value = ''
  try {
    await http(`/api/connectors/${deleteTarget.value._id}`, { method: 'DELETE' })
    actionMessage.value = `Đã xóa ${deleteTarget.value.name}.`
    deleteTarget.value = null
    await load()
  } catch (exception) {
    error.value = exception.message || 'Không thể xóa Connector.'
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-1 flex-col overflow-hidden bg-zinc-50/50">
    <header class="shrink-0 border-b border-zinc-200/70 bg-white/85 px-4 py-4 backdrop-blur-md sm:px-6">
      <div class="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <DatabaseZap class="size-5" />
          </div>
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-zinc-900">Connector ingest</h1>
            <p class="mt-1 text-sm font-medium text-zinc-500">Quản lý nguồn dữ liệu riêng cho từng tổ chức.</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" :disabled="loading" @click="load">
            <RefreshCw :class="['size-4', loading && 'animate-spin']" /> Làm mới
          </Button>
          <Button v-if="canProvision" class="bg-blue-600 font-bold text-white hover:bg-blue-700 shadow-lg shadow-blue-600/15" @click="openCreate">
            <Plus class="size-4" /> Tạo Connector
          </Button>
        </div>
      </div>
    </header>

    <main class="flex-1 overflow-auto p-4 sm:p-6">
      <div class="mx-auto max-w-7xl space-y-6">
        <div v-if="error" class="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <CircleAlert class="mt-0.5 size-4 shrink-0" />
          <span>{{ error }}</span>
        </div>
        <div v-if="actionMessage" class="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CircleCheck class="mt-0.5 size-4 shrink-0" />
          <span>{{ actionMessage }}</span>
        </div>

        <section class="grid gap-3 md:grid-cols-3">
          <Card class="border-zinc-200/80 shadow-sm">
            <CardContent class="flex items-center gap-4 p-5">
              <div class="flex size-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><DatabaseZap class="size-5" /></div>
              <div><p class="text-2xl font-bold text-zinc-900">{{ connectors.length }}</p><p class="text-xs font-semibold text-zinc-500">Tổng Connector</p></div>
            </CardContent>
          </Card>
          <Card class="border-zinc-200/80 shadow-sm">
            <CardContent class="flex items-center gap-4 p-5">
              <div class="flex size-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CircleCheck class="size-5" /></div>
              <div><p class="text-2xl font-bold text-zinc-900">{{ activeCount }}</p><p class="text-xs font-semibold text-zinc-500">Đang hoạt động</p></div>
            </CardContent>
          </Card>
          <Card class="border-zinc-200/80 shadow-sm">
            <CardContent class="flex items-center gap-4 p-5">
              <div class="flex size-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><ShieldCheck class="size-5" /></div>
              <div><p class="text-2xl font-bold text-zinc-900">{{ reviewCount }}</p><p class="text-xs font-semibold text-zinc-500">Chờ thiết lập hoặc duyệt</p></div>
            </CardContent>
          </Card>
        </section>

        <Card class="overflow-hidden border-blue-100 bg-gradient-to-br from-blue-50 to-white shadow-sm">
          <CardContent class="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
            <div class="flex gap-3">
              <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm"><ShieldCheck class="size-4" /></div>
              <div>
                <p class="font-bold text-zinc-900">Mỗi Connector là một ranh giới dữ liệu</p>
                <p class="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">Một Connector chỉ gắn với một tổ chức và một secret reference. Giá trị secret là JSON tài khoản ingest do quản trị hạ tầng cấu hình; mật khẩu hoặc cookie không được nhập hay hiển thị trên eWork.</p>
              </div>
            </div>
            <Button v-if="canProvision" variant="outline" size="sm" class="border-blue-200 bg-white text-blue-700 hover:bg-blue-50" @click="openCreate">
              Bắt đầu thiết lập <ArrowRight class="size-4" />
            </Button>
          </CardContent>
        </Card>

        <Card class="overflow-hidden border-zinc-200/80 shadow-sm">
          <CardHeader class="flex-row items-center justify-between border-b border-zinc-100 p-5">
            <div>
              <CardTitle class="text-lg">Danh sách Connector</CardTitle>
              <CardDescription class="mt-1">Theo dõi trạng thái vận hành theo từng tổ chức.</CardDescription>
            </div>
            <Badge variant="outline" class="border-zinc-200 bg-zinc-50 text-zinc-600">{{ connectors.length }} mục</Badge>
          </CardHeader>

          <CardContent class="p-0">
            <div v-if="loading" class="flex h-64 flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 class="size-7 animate-spin" />
              <p class="text-sm font-medium">Đang tải Connector…</p>
            </div>
            <div v-else-if="!connectors.length" class="flex h-64 flex-col items-center justify-center gap-3 px-4 text-center">
              <div class="flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><DatabaseZap class="size-6" /></div>
              <div><p class="font-bold text-zinc-800">Chưa có Connector nào</p><p class="mt-1 text-sm text-zinc-500">Tạo Connector đầu tiên để bắt đầu tách biệt ingest theo tổ chức.</p></div>
              <Button v-if="canProvision" variant="outline" size="sm" @click="openCreate"><Plus class="size-4" /> Tạo Connector</Button>
            </div>
            <Table v-else>
              <TableHeader class="bg-zinc-50/70">
                <TableRow>
                  <TableHead class="pl-5">Connector</TableHead>
                  <TableHead>Tổ chức</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Lần chạy gần nhất</TableHead>
                  <TableHead class="pr-5 text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="item in connectors" :key="item._id">
                  <TableCell class="pl-5">
                    <div class="flex items-center gap-3"><div class="flex size-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><DatabaseZap class="size-4" /></div><div><p class="font-semibold text-zinc-900">{{ item.name }}</p><p class="mt-0.5 text-xs font-medium text-zinc-500">{{ item.sourceSystem }}</p></div></div>
                  </TableCell>
                  <TableCell><div class="flex items-center gap-2 font-medium text-zinc-700"><Building2 class="size-4 text-zinc-400" />{{ organizationLabel(item.organizationId) }}</div></TableCell>
                  <TableCell><Badge variant="outline" :class="stateMeta(item.state).class"><component :is="stateMeta(item.state).icon" class="size-3" />{{ stateMeta(item.state).label }}</Badge></TableCell>
                  <TableCell><div :class="['text-sm font-semibold', latestRunClass(item._id)]">{{ latestRunLabel(item._id) }}</div><p class="mt-0.5 text-xs text-zinc-500">{{ latestRun(item._id)?.finishedAt ? formatDateTime(latestRun(item._id).finishedAt) : formatDateTime(item.nextRunAt) }}</p></TableCell>
                  <TableCell class="pr-5 text-right">
                    <div class="flex justify-end gap-2">
                      <Button v-if="item.state !== 'ACTIVE'" variant="outline" size="sm" :disabled="Boolean(actioningId)" class="border-blue-200 text-blue-700 hover:bg-blue-50" @click="operate(item, 'activate')"><Loader2 v-if="actioningId === item._id" class="size-4 animate-spin" /><Power v-else class="size-4" />Bật</Button>
                      <Button v-else variant="outline" size="sm" :disabled="Boolean(actioningId)" class="border-emerald-200 text-emerald-700 hover:bg-emerald-50" @click="operate(item, 'run')"><Loader2 v-if="actioningId === item._id" class="size-4 animate-spin" /><Play v-else class="size-4" />Chạy ngay</Button>
                      <Button v-if="item.state === 'ACTIVE'" variant="ghost" size="sm" :disabled="Boolean(actioningId)" class="text-zinc-600 hover:bg-zinc-100" @click="operate(item, 'disable')">Tắt</Button>
                      <Button v-if="canProvision" variant="ghost" size="icon" :disabled="Boolean(actioningId)" class="text-zinc-600 hover:bg-zinc-100" title="Sửa Connector" @click="openEdit(item)"><Pencil class="size-4" /></Button>
                      <Button v-if="canProvision" variant="ghost" size="icon" :disabled="Boolean(actioningId)" class="text-rose-600 hover:bg-rose-50 hover:text-rose-700" title="Xóa Connector" @click="openRemove(item)"><Trash2 class="size-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>

    <Dialog v-if="canProvision" v-model:open="createOpen">
      <DialogContent class="max-w-xl p-0 overflow-hidden">
        <DialogHeader class="border-b border-zinc-100 bg-zinc-50/70 px-6 py-5">
          <DialogTitle class="flex items-center gap-2 text-xl"><span class="flex size-8 items-center justify-center rounded-xl bg-blue-600 text-white"><Pencil v-if="editing" class="size-4" /><Plus v-else class="size-4" /></span>{{ editing ? 'Sửa Connector' : 'Tạo Connector' }}</DialogTitle>
          <DialogDescription class="pt-1">{{ editing ? 'Chỉ tên và tài khoản ingest được thay đổi; tổ chức luôn được giữ nguyên.' : 'Nhập một tài khoản ingest riêng cho tổ chức này. Hệ thống mã hóa mật khẩu và không hiển thị lại.' }}</DialogDescription>
        </DialogHeader>
        <form class="space-y-5 px-6 py-5" @submit.prevent="saveConnector">
          <div v-if="error" class="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
            <CircleAlert class="mt-0.5 size-4 shrink-0" />
            <span>{{ error }}</span>
          </div>
          <div v-if="!editing" class="space-y-2">
            <label class="text-sm font-bold text-zinc-800" for="connector-organization">Tổ chức</label>
            <Select v-model="form.organizationId" required>
              <SelectTrigger id="connector-organization"><SelectValue placeholder="Chọn tổ chức sử dụng nguồn dữ liệu" /></SelectTrigger>
              <SelectContent><SelectItem v-for="organization in organizations" :key="organization._id" :value="organization._id">{{ organization.name }}{{ organization.code ? ` (${organization.code})` : '' }}</SelectItem></SelectContent>
            </Select>
            <p class="text-xs text-zinc-500">Dữ liệu ingest của Connector sẽ chỉ được ghi vào tổ chức này.</p>
          </div>
          <div v-else class="space-y-2">
            <p class="text-sm font-bold text-zinc-800">Tổ chức</p>
            <div class="flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700"><Building2 class="size-4 text-zinc-400" />{{ organizationLabel(form.organizationId) }}</div>
            <p class="text-xs text-zinc-500">Không thể chuyển Connector sang tổ chức khác để tránh trộn dữ liệu ingest.</p>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-bold text-zinc-800" for="connector-name">Tên Connector</label>
            <Input id="connector-name" v-model.trim="form.name" required placeholder="Ví dụ: eOffice - UBND xã A" />
          </div>
          <div class="space-y-2">
            <div class="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div class="flex gap-3"><KeyRound class="mt-0.5 size-4 shrink-0 text-blue-700" /><div><p class="text-sm font-bold text-blue-900">Tài khoản ingest riêng của Connector</p><p class="mt-1 text-xs leading-5 text-blue-800">Mật khẩu được mã hóa khi lưu và không bao giờ hiển thị lại. {{ editing ? 'Để trống cả hai trường để giữ nguyên tài khoản hiện tại.' : '' }}</p></div></div>
            </div>
            <label class="text-sm font-bold text-zinc-800" for="connector-username">Tên tài khoản ingest</label>
            <Input id="connector-username" v-model.trim="form.username" :required="!editing" autocomplete="username" placeholder="Tài khoản đăng nhập nguồn dữ liệu" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-bold text-zinc-800" for="connector-password">Mật khẩu ingest</label>
            <Input id="connector-password" v-model="form.password" :required="!editing" type="password" autocomplete="current-password" :placeholder="editing ? 'Để trống nếu không thay đổi' : 'Mật khẩu tài khoản ingest'" />
            <p class="text-xs text-zinc-500">{{ editing ? 'Nếu thay đổi tài khoản, Connector sẽ được tắt và cần bật lại.' : 'Bạn có thể đổi tài khoản sau bằng nút Sửa.' }}</p>
          </div>
          <DialogFooter class="gap-2 border-t border-zinc-100 pt-5">
            <Button type="button" variant="outline" :disabled="saving" @click="createOpen = false; editing = null">Hủy</Button>
            <Button type="submit" :disabled="saving || (!editing && !organizations.length)" class="bg-blue-600 font-bold text-white hover:bg-blue-700"><Loader2 v-if="saving" class="size-4 animate-spin" /><Pencil v-else-if="editing" class="size-4" /><Plus v-else class="size-4" />{{ saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo Connector' }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="deleteTarget">
      <DialogContent class="max-w-md p-0 overflow-hidden">
        <DialogHeader class="border-b border-rose-100 bg-rose-50/70 px-6 py-5">
          <DialogTitle class="flex items-center gap-2 text-xl text-rose-950"><span class="flex size-8 items-center justify-center rounded-xl bg-rose-600 text-white"><Trash2 class="size-4" /></span>Xóa Connector</DialogTitle>
          <DialogDescription class="pt-1 text-rose-800">Thao tác này chỉ xóa Connector và các job vận hành của nó; dữ liệu đã ingest và lịch sử audit vẫn được giữ lại.</DialogDescription>
        </DialogHeader>
        <div class="space-y-3 px-6 py-5 text-sm text-zinc-700">
          <div v-if="error" class="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-800">
            <CircleAlert class="mt-0.5 size-4 shrink-0" />
            <span>{{ error }}</span>
          </div>
          <p>Bạn có chắc muốn xóa <strong>{{ deleteTarget?.name }}</strong>?</p>
          <p class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">Connector phải đang tắt và không có job nào đang chạy.</p>
        </div>
        <DialogFooter class="gap-2 border-t border-zinc-100 px-6 py-4">
          <Button type="button" variant="outline" :disabled="deleting" @click="deleteTarget = null">Hủy</Button>
          <Button type="button" :disabled="deleting" class="bg-rose-600 font-bold text-white hover:bg-rose-700" @click="removeConnector"><Loader2 v-if="deleting" class="size-4 animate-spin" /><Trash2 v-else class="size-4" />{{ deleting ? 'Đang xóa…' : 'Xóa Connector' }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
