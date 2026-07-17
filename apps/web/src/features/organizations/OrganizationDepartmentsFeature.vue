<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Building2, Edit2, Loader2, Mail, Phone, Plus, Search, Trash2, UserRound, Users, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table'
import { DepartmentService } from '@/features/departments/services/department.service'
import { OrganizationService, ORGANIZATION_TYPES } from '@/features/organizations/services/organization.service'
import { UserService } from '@/features/users/services/user.service'
import SlidingTabs from '@/components/ui/sliding-tabs/SlidingTabs.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import AppBreadcrumb from '@/components/ui/breadcrumb/AppBreadcrumb.vue'

const route = useRoute()
const router = useRouter()
const { user: currentUser } = useAuth()
const organizationId = computed(() => route.params.organizationId || currentUser.value?.organization?._id || currentUser.value?.organization)
const canEditOrg = computed(() => {
  const code = currentUser.value?.role?.code
  if (code === 'ADMIN') return true
  const myOrg = currentUser.value?.organization?._id || currentUser.value?.organization
  return myOrg && myOrg === organizationId.value
})

const organization = ref(null)
const departments = ref([])
const orgUsers = ref([])
const leaders = ref([])
const loading = ref(true)
const search = ref('')
const activeTab = ref('departments') // 'departments' | 'users'
const isDialogOpen = ref(false)
const isConfirmOpen = ref(false)
const isSubmitting = ref(false)
const dialogMode = ref('create')
const selectedDepartment = ref(null)
const departmentToDelete = ref(null)
const errorMessage = ref('')

const formData = ref({
  name: '',
  code: '',
  parent: 'none',
  leader: 'none',
  description: '',
  isOffice: false,
  isActive: true,
})

const parentOptions = computed(() => departments.value
  .filter((item) => item._id !== selectedDepartment.value?._id && item.isActive)
  .map((item) => ({ value: item._id, label: `${item.name} (${item.code})` })))

const leaderOptions = computed(() => {
  const departmentId = selectedDepartment.value?._id
  if (!departmentId) return []

  return leaders.value
    .filter((user) => (user.department?._id || user.department) === departmentId)
    .map((user) => ({
      value: user._id,
      label: `${user.fullName || user.username} (${user.email})`,
    }))
})

const userPage = ref(1)
const userLimit = ref(10)
const userTotal = ref(0)
const userTotalPages = ref(1)
const loadingUsers = ref(false)

const fetchOrgUsers = async () => {
  loadingUsers.value = true
  try {
    const res = await UserService.getUsers({
      limit: userLimit.value,
      page: userPage.value,
      search: activeTab.value === 'users' ? search.value : '',
      organization: organizationId.value
    })
    orgUsers.value = res?.data || []
    if (res?.meta) {
      userTotal.value = res.meta.total || 0
      userTotalPages.value = res.meta.totalPages || 1
    }
  } finally {
    loadingUsers.value = false
  }
}

watch([userPage, userLimit], () => {
  fetchOrgUsers()
})

watch(activeTab, () => {
  search.value = ''
  userPage.value = 1
  fetchPageData()
})

const fetchPageData = async () => {
  loading.value = true
  try {
    const [organizationRes, departmentRes, usersRes] = await Promise.all([
      OrganizationService.getOrganizationById(organizationId.value),
      DepartmentService.getDepartments(organizationId.value, { limit: 100, search: activeTab.value === 'departments' ? search.value : '' }),
      UserService.getUsers({ limit: 100, status: 'ACTIVE', organization: organizationId.value }),
      fetchOrgUsers(),
    ])
    organization.value = organizationRes?.data || null
    departments.value = departmentRes?.data || []
    leaders.value = usersRes?.data || []
  } finally {
    loading.value = false
  }
}

let searchTimeout
const handleSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(fetchPageData, 300)
}

const resetForm = () => {
  formData.value = {
    name: '',
    code: '',
    parent: 'none',
    leader: 'none',
    description: '',
    isOffice: false,
    isActive: true,
  }
}

const openCreateDialog = () => {
  dialogMode.value = 'create'
  selectedDepartment.value = null
  errorMessage.value = ''
  resetForm()
  if (organization.value?.code) {
    formData.value.code = `${organization.value.code}_`
  }
  isDialogOpen.value = true
}

const openEditDialog = (department) => {
  dialogMode.value = 'edit'
  selectedDepartment.value = department
  errorMessage.value = ''
  formData.value = {
    name: department.name || '',
    code: department.code || '',
    parent: department.parent?._id || 'none',
    leader: department.leader?._id || 'none',
    description: department.description || '',
    isOffice: Boolean(department.isOffice),
    isActive: Boolean(department.isActive),
  }
  isDialogOpen.value = true
}

const handleSubmit = async () => {
  if (!formData.value.name || !formData.value.code) {
    errorMessage.value = 'Vui lòng nhập tên và mã phòng ban.'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''
  try {
    let finalCode = formData.value.code.trim()
    const orgCode = organization.value?.code
    if (orgCode && !finalCode.startsWith(`${orgCode}_`)) {
      finalCode = `${orgCode}_${finalCode}`
    }

    const payload = {
      ...formData.value,
      code: finalCode,
      parent: formData.value.parent === 'none' ? null : formData.value.parent,
      leader: formData.value.leader === 'none' ? null : formData.value.leader,
    }

    if (dialogMode.value === 'create') {
      await DepartmentService.createDepartment(organizationId.value, payload)
    } else {
      await DepartmentService.updateDepartment(organizationId.value, selectedDepartment.value._id, payload)
    }

    isDialogOpen.value = false
    await fetchPageData()
  } catch (error) {
    errorMessage.value = error.message || 'Không thể lưu phòng ban.'
  } finally {
    isSubmitting.value = false
  }
}

const confirmDelete = (department) => {
  departmentToDelete.value = department
  isConfirmOpen.value = true
}

const togglingDepartmentId = ref(null)
const toggleDepartmentStatus = async (department) => {
  if (togglingDepartmentId.value) return
  togglingDepartmentId.value = department._id
  try {
    const newStatus = !department.isActive
    await DepartmentService.updateDepartment(organizationId.value, department._id, { isActive: newStatus })
    department.isActive = newStatus
  } finally {
    togglingDepartmentId.value = null
  }
}

const executeDelete = async () => {
  if (!departmentToDelete.value) return
  isSubmitting.value = true
  try {
    await DepartmentService.deleteDepartment(organizationId.value, departmentToDelete.value._id)
    isConfirmOpen.value = false
    await fetchPageData()
  } finally {
    isSubmitting.value = false
    departmentToDelete.value = null
  }
}

// --- User dialog ---
const isUserDialogOpen = ref(false)
const isUserSubmitting = ref(false)
const userErrorMessage = ref('')
const userDialogMode = ref('create') // 'create' | 'edit'
const selectedOrgUser = ref(null)
const userFormData = ref({ username: '', fullName: '', position: '', email: '', password: '', roleCode: 'OFFICE_CHIEF', phone: '', department: 'none' })

// Auto-generate username from fullName (only in create mode)
const toUsername = (name) => name
  .toUpperCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/Đ/g, 'D').replace(/đ/g, 'D')
  .replace(/[^A-Z0-9]/g, '')
  .toLowerCase()

watch(() => userFormData.value.fullName, (val) => {
  if (userDialogMode.value === 'create') userFormData.value.username = toUsername(val)
})

const openUserDialog = () => {
  userDialogMode.value = 'create'
  selectedOrgUser.value = null
  userErrorMessage.value = ''
  userFormData.value = { username: '', fullName: '', position: '', email: '', password: '', roleCode: 'OFFICE_CHIEF', phone: '', department: 'none' }
  isUserDialogOpen.value = true
}

const openEditUserDialog = (u) => {
  userDialogMode.value = 'edit'
  selectedOrgUser.value = u
  userErrorMessage.value = ''
  userFormData.value = {
    username: u.username,
    fullName: u.fullName,
    position: u.position || '',
    email: u.email,
    password: '',
    roleCode: u.role?.code || 'OFFICE_CHIEF',
    phone: u.phone || '',
    department: u.department?._id || 'none',
  }
  isUserDialogOpen.value = true
}

const handleUserSubmit = async () => {
  if (!userFormData.value.username || !userFormData.value.fullName || !userFormData.value.email) {
    userErrorMessage.value = 'Vui lòng điền đầy đủ thông tin bắt buộc.'
    return
  }
  if (userDialogMode.value === 'create' && !userFormData.value.password) {
    userErrorMessage.value = 'Vui lòng nhập mật khẩu.'
    return
  }
  isUserSubmitting.value = true
  userErrorMessage.value = ''
  try {
    const payload = { ...userFormData.value }
    if (payload.department === 'none') payload.department = null
    if (userDialogMode.value === 'edit' && !payload.password) delete payload.password
    if (userDialogMode.value === 'create') {
      await UserService.createUser({ ...payload, organization: organizationId.value })
    } else {
      await UserService.updateUser(selectedOrgUser.value._id, payload)
    }
    isUserDialogOpen.value = false
    await fetchPageData()
  } catch (err) {
    userErrorMessage.value = err.message || 'Không thể lưu nhân sự.'
  } finally {
    isUserSubmitting.value = false
  }
}

// Toggle user status (ACTIVE / INACTIVE)
const togglingUserId = ref(null)
const toggleOrgUserStatus = async (u) => {
  if (togglingUserId.value) return
  togglingUserId.value = u._id
  const newStatus = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  try {
    await UserService.updateUser(u._id, { status: newStatus })
    const idx = orgUsers.value.findIndex(x => x._id === u._id)
    if (idx !== -1) orgUsers.value[idx] = { ...orgUsers.value[idx], status: newStatus }
  } finally {
    togglingUserId.value = null
  }
}
const userToDelete = ref(null)
const isUserConfirmOpen = ref(false)
const isDeletingUser = ref(false)

const confirmDeleteUser = (u) => {
  userToDelete.value = u
  isUserConfirmOpen.value = true
}

const executeDeleteUser = async () => {
  if (!userToDelete.value) return
  isDeletingUser.value = true
  try {
    await UserService.deleteUser(userToDelete.value._id)
    isUserConfirmOpen.value = false
    await fetchPageData()
  } finally {
    isDeletingUser.value = false
    userToDelete.value = null
  }
}

const TABS = computed(() => [
  { id: 'departments', label: 'Phòng ban' },
  { id: 'users', label: 'Nhân sự' },
])

// Edit org info
const isOrgEditOpen = ref(false)
const isOrgSubmitting = ref(false)
const orgErrorMessage = ref('')
const orgFormData = ref({ name: '', code: '', type: 'COMMUNE', address: '', isActive: true })

const openOrgEdit = () => {
  if (!organization.value) return
  orgFormData.value = {
    name: organization.value.name || '',
    code: organization.value.code || '',
    type: organization.value.type || 'COMMUNE',
    address: organization.value.address || '',
    isActive: organization.value.isActive !== false,
  }
  orgErrorMessage.value = ''
  isOrgEditOpen.value = true
}

const handleOrgSubmit = async () => {
  if (!orgFormData.value.name || !orgFormData.value.code) {
    orgErrorMessage.value = 'Vui lòng nhập tên và mã tổ chức.'
    return
  }
  isOrgSubmitting.value = true
  orgErrorMessage.value = ''
  try {
    await OrganizationService.updateOrganization(organizationId.value, orgFormData.value)
    isOrgEditOpen.value = false
    await fetchPageData()
  } catch (err) {
    orgErrorMessage.value = err.message || 'Không thể cập nhật tổ chức.'
  } finally {
    isOrgSubmitting.value = false
  }
}

onMounted(fetchPageData)
</script>

<template>
  <div class="flex-1 h-full flex flex-col bg-zinc-50/30 overflow-hidden">
    <header class="shrink-0 px-6 pt-5 pb-4 border-b border-zinc-200/50 bg-white/70 backdrop-blur-md sticky top-0 z-10">
      <!-- Row 1: back + org info -->
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <AppBreadcrumb :items="[
            { label: 'Tổ chức', to: '/organizations' },
            { label: organization?.name || 'Phòng ban' },
          ]" />
          <Button v-if="currentUser?.role?.code === 'ADMIN'" variant="ghost" class="h-9 rounded-full px-3 text-zinc-500 hover:text-zinc-900 -ml-3 mb-2" @click="router.push('/organizations')">
            <ArrowLeft class="w-4 h-4 mr-2" />
            Tổ chức
          </Button>
          <div class="flex items-center gap-2 min-w-0">
            <div class="h-11 w-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Building2 class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900 truncate">{{ organization?.name || 'Tổ chức' }}</h1>
              <p class="text-sm font-medium text-zinc-500 mt-1">{{ organization?.code }} · {{ organization?.address || 'Chưa cập nhật địa chỉ' }}</p>
            </div>
            <Button
              v-if="canEditOrg"
              variant="ghost" size="icon"
              class="h-9 w-9 rounded-full text-zinc-400 hover:text-blue-600 hover:bg-blue-50 shrink-0"
              @click="openOrgEdit"
            >
              <Edit2 class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Row 2: tabs (left) + search & action (right) -->
      <div class="flex flex-col md:flex-row md:items-center justify-start gap-4 mt-6 relative z-0">
        <!-- Tabs left -->
        <div class="shrink-0 relative z-10">
          <SlidingTabs :tabs="TABS" v-model="activeTab" />
        </div>

        <!-- Search + Action right -->
        <div class="relative z-0 min-h-[40px] flex items-center flex-1">
          <Transition name="slide-behind" mode="out-in">
            <div v-if="activeTab === 'departments'" key="departments" class="flex items-center gap-3">
              <div class="relative group">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
                  <Search class="w-4 h-4" />
                </span>
                <Input
                  v-model="search"
                  @input="handleSearch"
                  placeholder="Tìm phòng ban..."
                  class="pl-9 pr-4 h-10 w-full md:w-[260px] bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 rounded-full font-medium transition-all shadow-sm shadow-black/[0.02]"
                />
              </div>
              <Button
                @click="openCreateDialog"
                class="h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 shadow-lg shadow-blue-600/10 gap-2"
              >
                <Plus class="w-4 h-4" />
                <span class="hidden md:inline">Thêm phòng ban</span>
              </Button>
            </div>
            
            <div v-else key="users" class="flex items-center gap-3">
              <div class="relative group">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
                  <Search class="w-4 h-4" />
                </span>
                <Input
                  v-model="search"
                  @input="handleSearch"
                  placeholder="Tìm nhân sự..."
                  class="pl-9 pr-4 h-10 w-full md:w-[260px] bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 rounded-full font-medium transition-all shadow-sm shadow-black/[0.02]"
                />
              </div>
              <Button
                @click="openUserDialog"
                class="h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 shadow-lg shadow-blue-600/10 gap-2"
              >
                <Plus class="w-4 h-4" />
                <span class="hidden md:inline">Thêm nhân sự</span>
              </Button>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <!-- Departments tab -->
    <main v-if="activeTab === 'departments'" class="flex-1 overflow-auto p-6">
      <div v-if="loading" class="h-64 flex items-center justify-center text-zinc-400">
        <Loader2 class="w-8 h-8 animate-spin" />
      </div>

      <div v-else-if="departments.length === 0" class="h-64 flex flex-col items-center justify-center text-zinc-400 gap-3">
        <Users class="w-10 h-10" />
        <p class="text-sm font-semibold">Chưa có phòng ban nào trong tổ chức này.</p>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="department in departments"
          :key="department._id"
          class="bg-white border border-zinc-200/70 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
          @click="router.push(`/organizations/${organizationId}/departments/${department._id}`)"
        >
          <!-- Left: Name & Code -->
          <div class="min-w-[200px] flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base font-bold text-zinc-900 truncate">{{ department.name }}</h2>
              <Badge v-if="department.isOffice" class="bg-blue-50 text-blue-700 border-blue-100 shrink-0 text-[10px] h-5 px-1.5 py-0">Văn phòng</Badge>
            </div>
            <p class="text-xs text-zinc-500 font-medium mt-1">{{ department.code }}</p>
          </div>

          <!-- Middle: Info columns -->
          <div class="hidden lg:flex items-center gap-6 flex-1 text-sm">
            <div class="flex flex-col w-[140px]">
              <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Cấp trên</span>
              <span class="font-semibold text-zinc-800 truncate mt-0.5">{{ department.parent?.name || 'Không có' }}</span>
            </div>
            <div class="flex flex-col w-[140px]">
              <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Lãnh đạo</span>
              <span class="font-semibold text-zinc-800 truncate mt-0.5">{{ department.leader?.fullName || 'Chưa phân công' }}</span>
            </div>
            <div class="flex flex-col w-[100px]">
              <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nhân sự</span>
              <span class="font-semibold text-zinc-800 truncate mt-0.5">{{ department.memberCount || 0 }} người</span>
            </div>
          </div>

          <!-- Right: Status Switch & Actions -->
          <div class="flex items-center gap-4 shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold" :class="department.isActive ? 'text-emerald-600' : 'text-zinc-400'">
                {{ department.isActive ? 'Hoạt động' : 'Đã ngưng' }}
              </span>
              <button
                :disabled="togglingDepartmentId === department._id"
                :class="[
                  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200',
                  department.isActive ? 'bg-blue-600' : 'bg-zinc-200',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                ]"
                @click.stop="toggleDepartmentStatus(department)"
              >
                <span
                  :class="[
                    'inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200',
                    department.isActive ? 'translate-x-5' : 'translate-x-0'
                  ]"
                />
              </button>
            </div>
            
            <div class="w-px h-6 bg-zinc-200 hidden sm:block"></div>
            
            <div class="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" class="h-8 w-8 rounded-full text-zinc-400 hover:text-blue-600 hover:bg-blue-50" @click.stop="openEditDialog(department)">
                <Edit2 class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 rounded-full text-zinc-400 hover:text-red-600 hover:bg-red-50" @click.stop="confirmDelete(department)">
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Users tab -->
    <main v-else class="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
      <div v-if="loading" class="h-64 flex items-center justify-center text-zinc-400">
        <Loader2 class="w-8 h-8 animate-spin" />
      </div>
      <div v-else-if="orgUsers.length === 0" class="h-64 flex flex-col items-center justify-center text-zinc-400 gap-3">
        <Users class="w-10 h-10" />
        <p class="text-sm font-semibold">Chưa có nhân sự nào thuộc tổ chức này.</p>
      </div>
      <div v-else class="bg-white border border-zinc-200/70 rounded-2xl shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
        <div class="flex-1 min-h-0 relative [&>div]:max-h-full custom-scrollbar-wrapper">
          <Table class="w-full text-sm text-left">
            <TableHeader class="bg-zinc-50 border-b border-zinc-100 text-[10px] uppercase font-bold text-zinc-400 tracking-wider sticky top-0 z-10">
              <TableRow class="!border-0 hover:bg-transparent shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <TableHead class="px-4 py-2 font-bold text-zinc-500">Nhân sự</TableHead>
                <TableHead class="px-4 py-2 font-bold hidden md:table-cell text-zinc-500">Liên hệ</TableHead>
                <TableHead class="px-4 py-2 font-bold hidden lg:table-cell text-zinc-500">Phòng ban</TableHead>
                <TableHead class="px-4 py-2 font-bold text-zinc-500">Trạng thái</TableHead>
                <TableHead class="px-4 py-2 font-bold text-right text-zinc-500">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody class="divide-y divide-zinc-100">
              <TableRow v-for="u in orgUsers" :key="u._id" class="border-0 hover:bg-zinc-50/50 transition-colors">
                <!-- Column 1: Avatar, Name, Role -->
                <TableCell class="px-4 py-2 min-w-[240px]">
                  <div class="flex items-center gap-3">
                    <div class="h-8 w-8 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                      {{ (u.fullName || u.username || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() }}
                    </div>
                    <div class="min-w-0 flex flex-col items-start gap-0.5">
                      <p class="text-sm font-bold text-zinc-900 truncate leading-tight">{{ u.fullName || '—' }}</p>
                      <p class="max-w-[180px] truncate text-xs font-medium text-zinc-500">{{ u.position || 'Chưa có chức vụ' }}</p>
                      <span class="text-[8px] font-bold uppercase tracking-wider px-2 py-[1px] rounded-full bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
                        {{ u.role?.name || u.role?.code || 'N/A' }}
                      </span>
                    </div>
                  </div>
                </TableCell>
                
                <!-- Column 2: Contact (Email, Phone) -->
                <TableCell class="px-4 py-2 hidden md:table-cell">
                  <div class="flex flex-col">
                    <span class="font-medium text-zinc-800">{{ u.email || '—' }}</span>
                    <span class="text-xs text-zinc-500">{{ u.phone || '—' }}</span>
                  </div>
                </TableCell>

                <!-- Column 3: Department -->
                <TableCell class="px-4 py-2 hidden lg:table-cell">
                  <span class="font-medium text-zinc-800">{{ u.department?.name || 'Chưa có phòng ban' }}</span>
                </TableCell>

                <!-- Column 4: Status -->
                <TableCell class="px-4 py-2">
                  <div class="flex items-center gap-2">
                    <span class="whitespace-nowrap text-xs font-semibold" :class="u.status === 'ACTIVE' ? 'text-emerald-600' : 'text-zinc-400'">
                      {{ u.status === 'ACTIVE' ? 'Hoạt động' : 'Đã ngưng' }}
                    </span>
                    <button
                      :disabled="togglingUserId === u._id || u.role?.code === 'ADMIN'"
                      :class="[
                        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200',
                        u.status === 'ACTIVE' ? 'bg-blue-600' : 'bg-zinc-200',
                        'disabled:cursor-not-allowed disabled:opacity-50'
                      ]"
                      @click="toggleOrgUserStatus(u)"
                    >
                      <span :class="['inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200', u.status === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0']" />
                    </button>
                  </div>
                </TableCell>

                <!-- Column 5: Actions -->
                <TableCell class="px-4 py-2 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" class="h-7 w-7 rounded-full text-zinc-400 hover:text-blue-600 hover:bg-blue-50" @click="openEditUserDialog(u)">
                      <Edit2 class="w-3.5 h-3.5" />
                    </Button>
                    <Button v-if="u.role?.code !== 'ADMIN'" variant="ghost" size="icon" class="h-7 w-7 rounded-full text-zinc-400 hover:text-red-600 hover:bg-red-50" @click="confirmDeleteUser(u)">
                      <Trash2 class="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <!-- Fixed Pagination Footer -->
        <div class="px-4 py-3 bg-zinc-50/95 shrink-0 border-t border-zinc-100 z-10">
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-2 text-xs text-zinc-500 font-medium">
              <span>Hiển thị</span>
              <Select :model-value="userLimit.toString()" @update:modelValue="val => userLimit = Number(val)">
                <SelectTrigger class="h-7 w-[70px] text-xs bg-white border-zinc-200">
                  <SelectValue :placeholder="userLimit.toString()" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <span>/ Tổng {{ userTotal }} nhân sự</span>
            </div>

            <div class="flex items-center gap-1">
              <Button 
                variant="outline" 
                size="icon" 
                class="h-7 w-7" 
                :disabled="userPage === 1"
                @click="userPage--"
              >
                <ChevronLeft class="w-4 h-4" />
              </Button>
              <div class="flex items-center justify-center min-w-[60px] text-xs font-medium text-zinc-600">
                {{ userPage }} / {{ userTotalPages || 1 }}
              </div>
              <Button 
                variant="outline" 
                size="icon" 
                class="h-7 w-7" 
                :disabled="userPage >= userTotalPages"
                @click="userPage++"
              >
                <ChevronRight class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <Dialog v-model:open="isDialogOpen">
      <DialogContent class="sm:max-w-[560px] !rounded-[32px] p-6 shadow-2xl duration-300">
        <DialogHeader>
          <DialogTitle>{{ dialogMode === 'create' ? 'Thêm phòng ban' : 'Cập nhật phòng ban' }}</DialogTitle>
          <DialogDescription>Phòng ban thuộc {{ organization?.name || 'tổ chức hiện tại' }}.</DialogDescription>
        </DialogHeader>

        <form @submit.prevent="handleSubmit" class="space-y-4 py-2">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label for="dept-name" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Tên phòng ban</label>
              <Input id="dept-name" v-model="formData.name" placeholder="Văn phòng HĐND-UBND" class="h-10" />
            </div>
            <div class="space-y-2">
              <label for="dept-code" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Mã</label>
              <Input id="dept-code" v-model="formData.code" placeholder="VP_HDND_UBND" class="h-10" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label for="dept-parent" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Phòng ban cấp trên</label>
              <Select v-model="formData.parent">
                <SelectTrigger id="dept-parent" class="h-10 w-full border-zinc-200 bg-white px-4 text-sm font-medium outline-none ring-0 focus:ring-0">
                  <SelectValue placeholder="Không có" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Không có</SelectItem>
                    <SelectItem v-for="parent in parentOptions" :key="parent.value" :value="parent.value">
                      {{ parent.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div v-if="dialogMode === 'edit'" class="space-y-2">
              <label for="dept-leader" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Lãnh đạo phụ trách</label>
              <Select v-model="formData.leader">
                <SelectTrigger id="dept-leader" class="h-10 w-full border-zinc-200 bg-white px-4 text-sm font-medium outline-none ring-0 focus:ring-0">
                  <SelectValue placeholder="Chưa phân công" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Chưa phân công</SelectItem>
                    <SelectItem v-for="leader in leaderOptions" :key="leader.value" :value="leader.value">
                      {{ leader.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="space-y-2">
            <label for="dept-description" class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Mô tả</label>
            <Input id="dept-description" v-model="formData.description" placeholder="Chức năng, phạm vi phụ trách..." class="h-10" />
          </div>

          <p v-if="errorMessage" class="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{{ errorMessage }}</p>
        </form>

        <DialogFooter class="mt-4 gap-3 sm:space-x-3">
          <Button variant="outline" @click="isDialogOpen = false" :disabled="isSubmitting" class="rounded-full font-bold px-6 border-zinc-200">Hủy</Button>
          <Button @click="handleSubmit" :disabled="isSubmitting" class="rounded-full font-bold px-6 shadow-md bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20">
            <Loader2 v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            {{ dialogMode === 'create' ? 'Tạo phòng ban' : 'Lưu thay đổi' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="isConfirmOpen">
      <DialogContent class="sm:max-w-[420px] !rounded-[32px] p-6 shadow-2xl duration-300">
        <DialogHeader>
           <DialogTitle>Ngưng hoạt động phòng ban?</DialogTitle>
          <DialogDescription>Phòng ban sẽ được chuyển sang trạng thái ngưng hoạt động.</DialogDescription>
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
    <!-- User create dialog -->
    <Dialog v-model:open="isUserDialogOpen">
      <DialogContent class="sm:max-w-[480px] !rounded-[32px] p-6 shadow-2xl duration-300">
        <DialogHeader>
          <DialogTitle>Thêm nhân sự vào {{ organization?.name }}</DialogTitle>
          <DialogDescription>Nhân sự sẽ mặc định thuộc tổ chức này.</DialogDescription>
        </DialogHeader>

        <form @submit.prevent="handleUserSubmit" class="space-y-4 py-2">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Họ và tên</label>
              <Input v-model="userFormData.fullName" placeholder="Nguyễn Văn A" class="h-10 rounded-full" />
            </div>
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Tên đăng nhập</label>
              <Input v-model="userFormData.username" placeholder="nguyenvana" class="h-10 rounded-full" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Email</label>
              <Input v-model="userFormData.email" type="email" placeholder="email@scmager.local" class="h-10 rounded-full" />
            </div>
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Số điện thoại</label>
              <Input v-model="userFormData.phone" placeholder="0987654321" class="h-10 rounded-full" />
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Chức vụ</label>
            <Input v-model="userFormData.position" placeholder="Ví dụ: Chủ tịch, Công chức văn phòng..." class="h-10 rounded-full" />
          </div>
          <div class="space-y-2">
            <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Mật khẩu</label>
            <Input v-model="userFormData.password" type="password" placeholder="••••••••" class="h-10 rounded-full" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Vai trò hệ thống</label>
              <Select v-model="userFormData.roleCode">
                <SelectTrigger class="h-10 w-full border-zinc-200 bg-white rounded-full px-4 text-sm font-medium">
                  <SelectValue placeholder="Chọn chức vụ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="OFFICE_CHIEF">Chánh văn phòng</SelectItem>
                    <SelectItem value="COMMUNE_LEADER">Lãnh đạo xã</SelectItem>
                    <SelectItem value="DEPARTMENT_LEADER">Trưởng phòng</SelectItem>
                    <SelectItem value="SPECIALIST">Chuyên viên</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Phòng ban</label>
              <Select v-model="userFormData.department">
                <SelectTrigger class="h-10 w-full border-zinc-200 bg-white rounded-full px-4 text-sm font-medium">
                  <SelectValue placeholder="Không có" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Không có</SelectItem>
                    <SelectItem v-for="d in departments.filter((department) => department.isActive)" :key="d._id" :value="d._id">{{ d.name }}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p v-if="userErrorMessage" class="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{{ userErrorMessage }}</p>
        </form>

        <DialogFooter class="mt-4 gap-3 sm:space-x-3">
          <Button variant="outline" @click="isUserDialogOpen = false" :disabled="isUserSubmitting" class="rounded-full font-bold px-6 border-zinc-200">Hủy</Button>
          <Button @click="handleUserSubmit" :disabled="isUserSubmitting" class="rounded-full font-bold px-6 bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20">
            <Loader2 v-if="isUserSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            Tạo nhân sự
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <!-- Confirm delete user -->
    <Dialog v-model:open="isUserConfirmOpen">
      <DialogContent class="sm:max-w-[400px] !rounded-[32px] p-6 shadow-2xl duration-300">
        <DialogHeader>
          <DialogTitle>Xóa nhân sự?</DialogTitle>
          <DialogDescription>
            Bạn đang chuẩn bị xóa vĩnh viễn tài khoản của
            <span class="font-bold text-zinc-900">{{ userToDelete?.fullName }}</span>.
            Hành động này không thể hoàn tác.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="mt-4 gap-3 sm:space-x-3">
          <Button variant="outline" @click="isUserConfirmOpen = false" :disabled="isDeletingUser" class="rounded-full font-bold px-6 border-zinc-200">Hủy</Button>
          <Button variant="destructive" @click="executeDeleteUser" :disabled="isDeletingUser" class="rounded-full font-bold px-6 shadow-md">
            <Loader2 v-if="isDeletingUser" class="w-4 h-4 mr-2 animate-spin" />
            Xóa vĩnh viễn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Edit org info dialog -->
    <Dialog v-model:open="isOrgEditOpen">
      <DialogContent class="sm:max-w-[500px] !rounded-[32px] p-6 shadow-2xl duration-300">
        <DialogHeader>
          <DialogTitle>Cập nhật thông tin tổ chức</DialogTitle>
          <DialogDescription>Chỉnh sửa tên, mã, loại và địa chỉ của {{ organization?.name }}.</DialogDescription>
        </DialogHeader>

        <form @submit.prevent="handleOrgSubmit" class="space-y-4 py-2">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Tên tổ chức</label>
              <Input v-model="orgFormData.name" placeholder="UBND xã..." class="h-10 rounded-full" />
            </div>
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Mã</label>
              <Input v-model="orgFormData.code" placeholder="UBND_XA" class="h-10 rounded-full" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Loại</label>
              <Select v-model="orgFormData.type">
                <SelectTrigger class="h-10 w-full border-zinc-200 bg-white rounded-full px-4 text-sm font-medium">
                  <SelectValue placeholder="Chọn loại" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="t in ORGANIZATION_TYPES" :key="t.value" :value="t.value">{{ t.label }}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Địa chỉ</label>
              <Input v-model="orgFormData.address" placeholder="Địa chỉ cơ quan" class="h-10 rounded-full" />
            </div>
          </div>
          <p v-if="orgErrorMessage" class="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{{ orgErrorMessage }}</p>
        </form>

        <DialogFooter class="mt-4 gap-3 sm:space-x-3">
          <Button variant="outline" @click="isOrgEditOpen = false" :disabled="isOrgSubmitting" class="rounded-full font-bold px-6 border-zinc-200">Hủy</Button>
          <Button @click="handleOrgSubmit" :disabled="isOrgSubmitting" class="rounded-full font-bold px-6 bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20">
            <Loader2 v-if="isOrgSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            Lưu thay đổi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.custom-scrollbar-wrapper :deep(div) {
  scrollbar-width: thin;
  scrollbar-color: #e4e4e7 transparent;
}
.custom-scrollbar-wrapper :deep(div::-webkit-scrollbar) {
  width: 6px;
  height: 6px;
}
.custom-scrollbar-wrapper :deep(div::-webkit-scrollbar-track) {
  background: transparent;
}
.custom-scrollbar-wrapper :deep(div::-webkit-scrollbar-thumb) {
  background-color: #e4e4e7;
  border-radius: 10px;
}
.custom-scrollbar-wrapper :deep(div::-webkit-scrollbar-thumb:hover) {
  background-color: #d4d4d8;
}

/* Slide Behind Transition */
.slide-behind-enter-active,
.slide-behind-leave-active {
  transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
}
.slide-behind-enter-from {
  opacity: 0;
  transform: translateX(-40px);
}
.slide-behind-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}
</style>
