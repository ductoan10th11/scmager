<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Building2, Edit2, Loader2, Plus, Search, Trash2 } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ORGANIZATION_TYPES, OrganizationService } from '@/features/organizations/services/organization.service'

const router = useRouter()
const organizations = ref([])
const loading = ref(true)
const search = ref('')
const typeFilter = ref('all')
const isDialogOpen = ref(false)
const isConfirmOpen = ref(false)
const isSubmitting = ref(false)
const dialogMode = ref('create')
const selectedOrganization = ref(null)
const organizationToDelete = ref(null)
const errorMessage = ref('')

const formData = ref({
  name: '',
  code: '',
  type: 'COMMUNE',
  parent: 'none',
  address: '',
  isActive: true,
})

const parentOptions = computed(() => organizations.value
  .filter((item) => item._id !== selectedOrganization.value?._id && item.isActive)
  .map((item) => ({ value: item._id, label: `${item.name} (${item.code})` })))

const typeLabel = (type) => ORGANIZATION_TYPES.find((item) => item.value === type)?.label || type

const fetchOrganizations = async () => {
  loading.value = true
  try {
    const res = await OrganizationService.getOrganizations({
      limit: 100,
      search: search.value,
      type: typeFilter.value === 'all' ? '' : typeFilter.value,
    })
    organizations.value = res?.data || []
  } finally {
    loading.value = false
  }
}

let searchTimeout
const handleSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(fetchOrganizations, 300)
}

const resetForm = () => {
  formData.value = {
    name: '',
    code: '',
    type: 'COMMUNE',
    parent: 'none',
    address: '',
    isActive: true,
  }
}

const openCreateDialog = () => {
  dialogMode.value = 'create'
  selectedOrganization.value = null
  errorMessage.value = ''
  resetForm()
  isDialogOpen.value = true
}

const openEditDialog = (organization) => {
  dialogMode.value = 'edit'
  selectedOrganization.value = organization
  errorMessage.value = ''
  formData.value = {
    name: organization.name || '',
    code: organization.code || '',
    type: organization.type || 'COMMUNE',
    parent: organization.parent?._id || 'none',
    address: organization.address || '',
    isActive: Boolean(organization.isActive),
  }
  isDialogOpen.value = true
}

const handleSubmit = async () => {
  if (!formData.value.name || !formData.value.code || !formData.value.type) {
    errorMessage.value = 'Vui lòng nhập đầy đủ tên, mã và loại tổ chức.'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''
  try {
    const payload = {
      ...formData.value,
      parent: formData.value.parent === 'none' ? null : formData.value.parent,
    }

    if (dialogMode.value === 'create') {
      await OrganizationService.createOrganization(payload)
    } else {
      await OrganizationService.updateOrganization(selectedOrganization.value._id, payload)
    }

    isDialogOpen.value = false
    await fetchOrganizations()
  } catch (error) {
    errorMessage.value = error.message || 'Không thể lưu tổ chức.'
  } finally {
    isSubmitting.value = false
  }
}

const confirmDelete = (organization) => {
  organizationToDelete.value = organization
  isConfirmOpen.value = true
}

const togglingOrganizationId = ref(null)
const toggleOrganizationStatus = async (organization) => {
  if (togglingOrganizationId.value) return
  togglingOrganizationId.value = organization._id
  try {
    const newStatus = !organization.isActive
    await OrganizationService.updateOrganization(organization._id, { isActive: newStatus })
    organization.isActive = newStatus
  } finally {
    togglingOrganizationId.value = null
  }
}

const openDepartments = (organization) => {
  router.push(`/organizations/${organization._id}/departments`)
}

const executeDelete = async () => {
  if (!organizationToDelete.value) return
  isSubmitting.value = true
  try {
    await OrganizationService.deleteOrganization(organizationToDelete.value._id)
    isConfirmOpen.value = false
    await fetchOrganizations()
  } finally {
    isSubmitting.value = false
    organizationToDelete.value = null
  }
}

onMounted(fetchOrganizations)
</script>

<template>
  <div class="flex-1 h-full flex flex-col bg-zinc-50/30 overflow-hidden">
    <header class="shrink-0 px-6 py-5 md:py-6 border-b border-zinc-200/50 bg-white/70 backdrop-blur-md sticky top-0 z-10">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-zinc-900">Quản lý tổ chức</h1>
          <p class="text-sm font-medium text-zinc-500 mt-1">Cơ cấu cơ quan, đơn vị cấp trên và phòng ban trực thuộc.</p>
        </div>

        <div class="flex items-center gap-3">
          <div class="relative group">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
              <Search class="w-4 h-4" />
            </span>
            <Input
              v-model="search"
              @input="handleSearch"
              placeholder="Tìm tên, mã, địa chỉ..."
              class="pl-9 pr-4 h-10 w-full md:w-[260px] bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 !outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:!outline-none rounded-full font-medium transition-all shadow-sm shadow-black/[0.02]"
            />
          </div>

          <Select v-model="typeFilter" @update:modelValue="fetchOrganizations">
            <SelectTrigger class="h-10 w-[180px] rounded-full border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm !outline-none !ring-0 focus:!ring-0 focus:!outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:!outline-none">
              <SelectValue placeholder="Tất cả loại" />
            </SelectTrigger>
            <SelectContent class="!rounded-[20px] shadow-xl border-zinc-200 overflow-hidden">
              <SelectGroup>
                <SelectItem value="all">Tất cả loại</SelectItem>
                <SelectItem v-for="type in ORGANIZATION_TYPES" :key="type.value" :value="type.value">
                  {{ type.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Button @click="openCreateDialog" class="h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 shadow-lg shadow-blue-600/10 gap-2">
            <Plus class="w-4 h-4" />
            Thêm tổ chức
          </Button>
        </div>
      </div>
    </header>

    <main class="flex-1 overflow-auto p-6">
      <div v-if="loading" class="h-64 flex items-center justify-center text-zinc-400">
        <Loader2 class="w-8 h-8 animate-spin" />
      </div>

      <div v-else-if="organizations.length === 0" class="h-64 flex flex-col items-center justify-center text-zinc-400 gap-3">
        <Building2 class="w-10 h-10" />
        <p class="text-sm font-semibold">Chưa có tổ chức nào.</p>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="organization in organizations"
          :key="organization._id"
          class="bg-white border border-zinc-200/70 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4 cursor-pointer hover:border-blue-200 hover:shadow-md transition-all"
          @click="openDepartments(organization)"
        >
          <!-- Left: Name & Code -->
          <div class="min-w-[200px] flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base font-bold text-zinc-900 truncate">{{ organization.name }}</h2>
              <Badge class="bg-blue-50 text-blue-700 border-blue-100 shrink-0 text-[10px] h-5 px-1.5 py-0">{{ typeLabel(organization.type) }}</Badge>
            </div>
            <p class="text-xs text-zinc-500 font-medium mt-1">{{ organization.code }}</p>
          </div>

          <!-- Middle: Info columns -->
          <div class="hidden md:flex items-center gap-6 flex-1 text-sm">
            <div class="flex flex-col w-[160px]">
              <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Cấp trên</span>
              <span class="font-semibold text-zinc-800 truncate mt-0.5">{{ organization.parent?.name || 'Không có' }}</span>
            </div>
            <div class="flex flex-col flex-1 min-w-[120px]">
              <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Địa chỉ</span>
              <span class="font-semibold text-zinc-800 truncate mt-0.5">{{ organization.address || 'Chưa cập nhật' }}</span>
            </div>
          </div>

          <!-- Right: Status Switch & Actions -->
          <div class="flex items-center gap-4 shrink-0">
            <div class="flex items-center gap-2" @click.stop>
              <span class="text-xs font-semibold" :class="organization.isActive ? 'text-emerald-600' : 'text-zinc-400'">
                {{ organization.isActive ? 'Hoạt động' : 'Đã ngưng' }}
              </span>
              <button
                :disabled="togglingOrganizationId === organization._id"
                :class="[
                  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200',
                  organization.isActive ? 'bg-blue-600' : 'bg-zinc-200',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                ]"
                @click.stop="toggleOrganizationStatus(organization)"
              >
                <span
                  :class="[
                    'inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200',
                    organization.isActive ? 'translate-x-5' : 'translate-x-0'
                  ]"
                />
              </button>
            </div>
            
            <div class="w-px h-6 bg-zinc-200 hidden sm:block"></div>
            
            <div class="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" class="h-8 w-8 rounded-full text-zinc-400 hover:text-blue-600 hover:bg-blue-50" @click.stop="openEditDialog(organization)">
                <Edit2 class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 rounded-full text-zinc-400 hover:text-red-600 hover:bg-red-50" @click.stop="confirmDelete(organization)">
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <Dialog v-model:open="isDialogOpen">
      <DialogContent class="sm:max-w-[520px] !rounded-[32px] p-6 shadow-2xl !fixed !left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2">
        <DialogHeader>
          <DialogTitle>{{ dialogMode === 'create' ? 'Thêm tổ chức' : 'Cập nhật tổ chức' }}</DialogTitle>
          <DialogDescription>Nhập thông tin cơ cấu tổ chức theo đúng mã quản lý nội bộ.</DialogDescription>
        </DialogHeader>

        <form @submit.prevent="handleSubmit" class="space-y-4 py-2">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label for="org-name" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Tên tổ chức</label>
              <Input id="org-name" v-model="formData.name" placeholder="UBND xã..." class="h-10 !rounded-full px-4 !outline-none !ring-0 focus:!ring-0 focus:!outline-none focus:border-zinc-300" />
            </div>
            <div class="space-y-2">
              <label for="org-code" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Mã</label>
              <Input id="org-code" v-model="formData.code" placeholder="UBND_XA" class="h-10 !rounded-full px-4 !outline-none !ring-0 focus:!ring-0 focus:!outline-none focus:border-zinc-300" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label for="org-type" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Loại</label>
              <Select v-model="formData.type">
                <SelectTrigger id="org-type" class="h-10 w-full !rounded-full border-zinc-200 bg-white px-4 text-sm font-medium !outline-none !ring-0 focus:!ring-0 focus:!outline-none focus:border-zinc-300">
                  <SelectValue placeholder="Chọn loại tổ chức" />
                </SelectTrigger>
                <SelectContent class="!rounded-[20px] shadow-xl border-zinc-200 overflow-hidden">
                  <SelectGroup>
                    <SelectItem v-for="type in ORGANIZATION_TYPES" :key="type.value" :value="type.value">
                      {{ type.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <label for="org-parent" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Cấp trên</label>
              <Select v-model="formData.parent">
                <SelectTrigger id="org-parent" class="h-10 w-full !rounded-full border-zinc-200 bg-white px-4 text-sm font-medium !outline-none !ring-0 focus:!ring-0 focus:!outline-none focus:border-zinc-300">
                  <SelectValue placeholder="Không có" />
                </SelectTrigger>
                <SelectContent class="!rounded-[20px] shadow-xl border-zinc-200 overflow-hidden">
                  <SelectGroup>
                    <SelectItem value="none">Không có</SelectItem>
                    <SelectItem v-for="parent in parentOptions" :key="parent.value" :value="parent.value">
                      {{ parent.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="space-y-2">
            <label for="org-address" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Địa chỉ</label>
            <Input id="org-address" v-model="formData.address" placeholder="Địa chỉ cơ quan" class="h-10 !rounded-full px-4 !outline-none !ring-0 focus:!ring-0 focus:!outline-none focus:border-zinc-300" />
          </div>

          <p v-if="errorMessage" class="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{{ errorMessage }}</p>
        </form>

        <DialogFooter class="mt-4 gap-3 sm:space-x-3">
          <Button variant="outline" @click="isDialogOpen = false" :disabled="isSubmitting" class="rounded-full font-bold px-6 border-zinc-200">Hủy</Button>
          <Button @click="handleSubmit" :disabled="isSubmitting" class="rounded-full font-bold px-6 shadow-md bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20">
            <Loader2 v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            {{ dialogMode === 'create' ? 'Tạo tổ chức' : 'Lưu thay đổi' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="isConfirmOpen">
      <DialogContent class="sm:max-w-[420px] !rounded-[32px] p-6 shadow-2xl !fixed !left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2">
        <DialogHeader>
          <DialogTitle>Ngưng hoạt động tổ chức?</DialogTitle>
          <DialogDescription>Tổ chức sẽ được chuyển sang trạng thái ngưng hoạt động.</DialogDescription>
        </DialogHeader>
        <DialogFooter class="mt-4 gap-3 sm:space-x-3">
          <Button variant="outline" @click="isConfirmOpen = false" :disabled="isSubmitting" class="rounded-full font-bold px-6 border-zinc-200">Hủy</Button>
          <Button variant="destructive" @click="executeDelete" :disabled="isSubmitting" class="rounded-full font-bold px-6 shadow-md">
            <Loader2 v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            Xác nhận
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
/* Xoay icon chevron của dropdown khi click mở */
:deep([role="combobox"][data-state="open"] > span > svg) {
  transform: rotate(180deg);
}
:deep([role="combobox"] > span > svg) {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

</style>

<style>
/* CSS không scoped để có thể tác động lên các thành phần Portal (như dropdown menu bị đẩy ra ngoài body) */
[role="listbox"][data-state="open"],
[role="presentation"][data-state="open"] {
  animation: dropdownFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

[role="listbox"][data-state="closed"],
[role="presentation"][data-state="closed"] {
  animation: dropdownFadeOut 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes dropdownFadeIn {
  from { opacity: 0; transform: scale(0.96) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes dropdownFadeOut {
  from { opacity: 1; transform: scale(1) translateY(0); }
  to { opacity: 0; transform: scale(0.96) translateY(-4px); }
}

/* Hiệu ứng mượt mà cho Popup (sử dụng thuộc tính scale độc lập, không dùng transform để tránh xung đột với !-translate-x-1/2) */
[role="dialog"][data-state="open"] {
  animation: dialogScaleFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

[role="dialog"][data-state="closed"] {
  animation: dialogScaleFadeOut 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes dialogScaleFadeIn {
  from { opacity: 0; scale: 0.96; }
  to { opacity: 1; scale: 1; }
}

@keyframes dialogScaleFadeOut {
  from { opacity: 1; scale: 1; }
  to { opacity: 0; scale: 0.96; }
}
</style>
