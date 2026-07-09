<script setup>
import { ref, onMounted, watch } from 'vue'
import { UserService } from '@/features/users/services/user.service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
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
} from '@/components/ui/table'
import {
  Search, Plus, User, Mail, Shield, Trash2, Edit2, Loader2, AlertCircle, ChevronLeft, ChevronRight
} from 'lucide-vue-next'

const users = ref([])
const loading = ref(true)
const search = ref('')

// Create / Edit dialog
const isDialogOpen = ref(false)
const isSubmitting = ref(false)
const dialogMode = ref('create')
const selectedUser = ref(null)
const errorMessage = ref('')

// Confirm hard-delete
const isConfirmOpen = ref(false)
const userToDelete = ref(null)

// Status toggle per-user loading
const togglingId = ref(null)

const formData = ref({
  username: '',
  fullName: '',
  email: '',
  password: '',
  roleCode: 'SPECIALIST',
})

const userPage = ref(1)
const userLimit = ref(20)
const userTotal = ref(0)
const userTotalPages = ref(1)

const fetchUsers = async () => {
  loading.value = true
  try {
    const res = await UserService.getUsers({ limit: userLimit.value, page: userPage.value, search: search.value })
    if (res?.data) users.value = res.data
    if (res?.meta) {
      userTotal.value = res.meta.total || 0
      userTotalPages.value = res.meta.totalPages || 1
    }
  } catch (error) {
    console.error('Lỗi khi tải danh sách người dùng:', error)
  } finally {
    loading.value = false
  }
}

watch([userPage, userLimit], () => {
  fetchUsers()
})

onMounted(fetchUsers)

let searchTimeout
const handleSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    userPage.value = 1
    fetchUsers()
  }, 300)
}

const openCreateDialog = () => {
  dialogMode.value = 'create'
  errorMessage.value = ''
  formData.value = { username: '', fullName: '', email: '', password: '', roleCode: 'SPECIALIST' }
  isDialogOpen.value = true
}

const openEditDialog = (user) => {
  dialogMode.value = 'edit'
  errorMessage.value = ''
  selectedUser.value = user
  formData.value = {
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    password: '',
    roleCode: user.role?.code || 'SPECIALIST',
  }
  isDialogOpen.value = true
}

const handleSubmit = async () => {
  if (!formData.value.username || !formData.value.fullName || !formData.value.email) {
    errorMessage.value = 'Vui lòng điền đầy đủ thông tin bắt buộc'
    return
  }
  if (dialogMode.value === 'create' && !formData.value.password) {
    errorMessage.value = 'Vui lòng nhập mật khẩu cho người dùng mới'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''
  try {
    const payload = { ...formData.value }
    if (dialogMode.value === 'edit' && !payload.password) delete payload.password

    if (dialogMode.value === 'create') {
      await UserService.createUser(payload)
    } else {
      await UserService.updateUser(selectedUser.value._id, payload)
    }

    isDialogOpen.value = false
    fetchUsers()
  } catch (error) {
    errorMessage.value = error.message || 'Lỗi khi lưu người dùng'
  } finally {
    isSubmitting.value = false
  }
}

// Toggle ACTIVE / INACTIVE
const toggleStatus = async (user) => {
  if (togglingId.value) return
  togglingId.value = user._id
  const newStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  try {
    await UserService.updateUser(user._id, { status: newStatus })
    // Trigger reactivity via index update instead of direct mutation
    const idx = users.value.findIndex(u => u._id === user._id)
    if (idx !== -1) users.value[idx] = { ...users.value[idx], status: newStatus }
  } catch (error) {
    console.error('Lỗi khi đổi trạng thái:', error)
  } finally {
    togglingId.value = null
  }
}

const confirmDelete = (user) => {
  userToDelete.value = user
  isConfirmOpen.value = true
}

const executeDelete = async () => {
  if (!userToDelete.value) return
  isSubmitting.value = true
  try {
    await UserService.deleteUser(userToDelete.value._id)
    isConfirmOpen.value = false
    fetchUsers()
  } catch (error) {
    console.error('Lỗi khi xóa người dùng:', error)
  } finally {
    isSubmitting.value = false
    userToDelete.value = null
  }
}

const getInitials = (name) => {
  if (!name) return 'U'
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
}

const getRoleConfig = (code, name) => {
  switch (code) {
    case 'ADMIN':            return { bg: 'bg-rose-100',   text: 'text-rose-700',   border: 'border-rose-200',   label: 'Quản trị hệ thống' }
    case 'OFFICE_CHIEF':     return { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', label: 'Chánh văn phòng' }
    case 'COMMUNE_LEADER':   return { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', label: 'Lãnh đạo xã' }
    case 'DEPARTMENT_LEADER':return { bg: 'bg-amber-100',  text: 'text-amber-700',  border: 'border-amber-200',  label: 'Trưởng phòng' }
    default:                 return { bg: 'bg-zinc-100',   text: 'text-zinc-700',   border: 'border-zinc-200',   label: name || 'Chuyên viên' }
  }
}
</script>

<template>
  <div class="flex-1 h-full flex flex-col bg-zinc-50/30 overflow-hidden relative">

    <!-- Header -->
    <header class="shrink-0 px-6 py-5 md:py-6 border-b border-zinc-200/50 bg-white/70 backdrop-blur-md sticky top-0 z-10">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-zinc-900">Quản lý nhân sự</h1>
          <p class="text-sm font-medium text-zinc-500 mt-1">Hệ thống danh bạ và phân quyền cán bộ cơ quan.</p>
        </div>

        <div class="flex items-center gap-3">
          <div class="relative group">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
              <Search class="w-4 h-4" />
            </span>
            <Input
              v-model="search"
              @input="handleSearch"
              placeholder="Tìm kiếm cán bộ..."
              class="pl-9 pr-4 h-10 w-full md:w-[260px] bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 rounded-full font-medium transition-all shadow-sm shadow-black/[0.02]"
            />
          </div>
          <Button
            @click="openCreateDialog"
            class="h-10 rounded-full font-bold bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-md shadow-blue-600/15 transition-all flex items-center gap-2 select-none border-0"
          >
            <Plus class="w-4 h-4" />
            <span class="hidden md:inline">Thêm mới</span>
          </Button>
        </div>
      </div>
    </header>

    <!-- Content -->
    <main class="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
      <div v-if="loading" class="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
        <Loader2 class="w-8 h-8 animate-spin text-blue-500" />
        <span class="text-sm font-medium animate-pulse">Đang tải dữ liệu...</span>
      </div>

      <div v-else-if="users.length === 0" class="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
        <div class="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-2">
          <User class="w-8 h-8 text-zinc-300" />
        </div>
        <span class="text-sm font-medium">Không tìm thấy cán bộ nào</span>
      </div>

      <div v-else class="bg-white border border-zinc-200/70 rounded-2xl shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
        <div class="flex-1 min-h-0 relative [&>div]:max-h-full custom-scrollbar-wrapper">
          <Table class="w-full text-sm text-left">
            <TableHeader class="bg-zinc-50 border-b border-zinc-100 text-[10px] uppercase font-bold text-zinc-400 tracking-wider sticky top-0 z-10">
              <TableRow class="!border-0 hover:bg-transparent shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <TableHead class="px-4 py-2 font-bold text-zinc-500">Cán bộ</TableHead>
                <TableHead class="px-4 py-2 font-bold hidden md:table-cell text-zinc-500">Liên hệ</TableHead>
                <TableHead class="px-4 py-2 font-bold hidden lg:table-cell text-zinc-500">Đơn vị / Phòng ban</TableHead>
                <TableHead class="px-4 py-2 font-bold text-zinc-500">Trạng thái</TableHead>
                <TableHead class="px-4 py-2 font-bold text-right text-zinc-500">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody class="divide-y divide-zinc-100">
              <TableRow v-for="user in users" :key="user._id" class="border-0 hover:bg-zinc-50/50 transition-colors">
                <!-- Column 1: Avatar, Name, Role -->
                <TableCell class="px-4 py-2 min-w-[240px]">
                  <div class="flex items-center gap-3">
                    <div class="h-8 w-8 rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-xs shrink-0" :class="[getRoleConfig(user.role?.code).bg, getRoleConfig(user.role?.code).text.replace('text-', 'text-')]">
                      {{ getInitials(user.fullName) }}
                    </div>
                    <div class="min-w-0 flex flex-col items-start gap-0.5">
                      <p class="text-sm font-bold text-zinc-900 truncate leading-tight">{{ user.fullName || '—' }}</p>
                      <span class="text-[8px] font-bold uppercase tracking-wider px-2 py-[1px] rounded-full border shrink-0" :class="[getRoleConfig(user.role?.code).bg, getRoleConfig(user.role?.code).text, getRoleConfig(user.role?.code).border]">
                        {{ getRoleConfig(user.role?.code, user.role?.name).label }}
                      </span>
                    </div>
                  </div>
                </TableCell>
                
                <!-- Column 2: Contact -->
                <TableCell class="px-4 py-2 hidden md:table-cell">
                  <div class="flex flex-col">
                    <span class="font-medium text-zinc-800">{{ user.email || '—' }}</span>
                    <span class="text-xs text-zinc-500">@{{ user.username }}</span>
                  </div>
                </TableCell>

                <!-- Column 3: Department -->
                <TableCell class="px-4 py-2 hidden lg:table-cell">
                  <div class="flex flex-col">
                    <span class="font-medium text-zinc-800 truncate">{{ user.organization?.name || '—' }}</span>
                    <span class="text-xs text-zinc-500 truncate">{{ user.department?.name || '—' }}</span>
                  </div>
                </TableCell>

                <!-- Column 4: Status -->
                <TableCell class="px-4 py-2">
                  <div class="flex items-center gap-2">
                    <button
                      :disabled="togglingId === user._id || user.role?.code === 'ADMIN'"
                      :class="[
                        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200',
                        user.status === 'ACTIVE' ? 'bg-blue-600' : 'bg-zinc-200',
                        'disabled:cursor-not-allowed disabled:opacity-50'
                      ]"
                      @click="toggleStatus(user)"
                    >
                      <span :class="['inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200', user.status === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0']" />
                    </button>
                  </div>
                </TableCell>

                <!-- Column 5: Actions -->
                <TableCell class="px-4 py-2 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" class="h-7 w-7 rounded-full text-zinc-400 hover:text-blue-600 hover:bg-blue-50" @click="openEditDialog(user)">
                      <Edit2 class="w-3.5 h-3.5" />
                    </Button>
                    <Button v-if="user.role?.code !== 'ADMIN'" variant="ghost" size="icon" class="h-7 w-7 rounded-full text-zinc-400 hover:text-red-600 hover:bg-red-50" @click="confirmDelete(user)">
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
              <span>/ Tổng {{ userTotal }} cán bộ</span>
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

    <!-- Create/Edit Dialog -->
    <Dialog :open="isDialogOpen" @update:open="isDialogOpen = $event">
      <DialogContent class="sm:max-w-[480px] p-0 border-0 rounded-[28px] overflow-hidden shadow-2xl shadow-black/10">
        <div class="px-6 py-5 border-b border-zinc-100 bg-white">
          <DialogTitle class="text-xl font-bold tracking-tight text-zinc-900">
            {{ dialogMode === 'create' ? 'Thêm cán bộ mới' : 'Cập nhật hồ sơ' }}
          </DialogTitle>
          <DialogDescription class="text-zinc-500 font-medium text-sm mt-1">
            Điền các thông tin cơ bản để hệ thống phân quyền định danh.
          </DialogDescription>
        </div>

        <div class="p-6 bg-zinc-50/50 flex flex-col gap-4">
          <Transition name="fade-height">
            <div v-if="errorMessage" class="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-semibold px-4 py-2.5 rounded-2xl flex items-center gap-2">
              <AlertCircle class="w-4 h-4 shrink-0" />
              <span>{{ errorMessage }}</span>
            </div>
          </Transition>

          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5 col-span-2 md:col-span-1">
              <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Họ và tên</label>
              <Input v-model="formData.fullName" placeholder="Nguyễn Văn A" class="h-10 rounded-xl bg-white border-zinc-200 focus:border-blue-500" />
            </div>
            <div class="flex flex-col gap-1.5 col-span-2 md:col-span-1">
              <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Tên đăng nhập</label>
              <Input v-model="formData.username" placeholder="nguyenvana" class="h-10 rounded-xl bg-white border-zinc-200 focus:border-blue-500" :disabled="dialogMode === 'edit'" />
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Email liên hệ</label>
            <Input v-model="formData.email" type="email" placeholder="email@scmager.local" class="h-10 rounded-xl bg-white border-zinc-200 focus:border-blue-500" />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">
              Mật khẩu <span v-if="dialogMode === 'edit'" class="text-zinc-400 lowercase normal-case font-medium">(Bỏ trống nếu không đổi)</span>
            </label>
            <Input v-model="formData.password" type="password" placeholder="••••••••" class="h-10 rounded-xl bg-white border-zinc-200 focus:border-blue-500" />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Chức vụ / Quyền</label>
            <select
              v-model="formData.roleCode"
              class="h-10 rounded-xl bg-white border border-zinc-200 focus:border-blue-500 text-sm font-medium px-3 outline-none"
            >
              <option value="SPECIALIST">Chuyên viên</option>
              <option value="DEPARTMENT_LEADER">Trưởng phòng</option>
              <option value="COMMUNE_LEADER">Lãnh đạo xã</option>
              <option value="OFFICE_CHIEF">Chánh văn phòng</option>
            </select>
          </div>
        </div>

        <div class="px-6 py-4 bg-white border-t border-zinc-100 flex justify-end gap-3">
          <Button variant="outline" @click="isDialogOpen = false" class="rounded-full font-bold h-10 px-5 border-zinc-200 text-zinc-600 hover:bg-zinc-50" :disabled="isSubmitting">
            Hủy bỏ
          </Button>
          <Button @click="handleSubmit" class="rounded-full font-bold h-10 px-6 bg-zinc-900 text-white hover:bg-zinc-800 shadow-md transition-all" :disabled="isSubmitting">
            <Loader2 v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            Lưu hồ sơ
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Confirm Delete Dialog -->
    <Dialog :open="isConfirmOpen" @update:open="isConfirmOpen = $event">
      <DialogContent class="sm:max-w-[400px] p-0 border-0 rounded-[28px] overflow-hidden shadow-2xl shadow-rose-900/10">
        <div class="p-6 flex flex-col items-center text-center gap-4 pt-8">
          <div class="w-16 h-16 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-2">
            <Trash2 class="w-8 h-8" />
          </div>
          <div>
            <DialogTitle class="text-xl font-bold tracking-tight text-zinc-900">Xóa nhân sự?</DialogTitle>
            <DialogDescription class="text-zinc-500 font-medium text-sm mt-2">
              Bạn đang chuẩn bị xóa vĩnh viễn tài khoản của
              <span class="font-bold text-zinc-900">{{ userToDelete?.fullName }}</span>.
              Hành động này <span class="text-rose-600 font-bold">không thể hoàn tác</span>.
            </DialogDescription>
          </div>
        </div>
        <div class="px-6 py-4 bg-zinc-50 flex justify-center gap-3 border-t border-zinc-100">
          <Button variant="outline" @click="isConfirmOpen = false" class="rounded-full font-bold h-10 w-full border-zinc-200 text-zinc-600 hover:bg-zinc-100" :disabled="isSubmitting">
            Hủy
          </Button>
          <Button variant="destructive" @click="executeDelete" class="rounded-full font-bold h-10 w-full bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20 text-white transition-all" :disabled="isSubmitting">
            <Loader2 v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            Xóa vĩnh viễn
          </Button>
        </div>
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
</style>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #e4e4e7; border-radius: 10px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d4d4d8; }

.list-move, .list-enter-active, .list-leave-active { transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1); }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateY(15px) scale(0.98); }
.list-leave-active { position: absolute; }

.fade-height-enter-active, .fade-height-leave-active { transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1); }
.fade-height-enter-from, .fade-height-leave-to { opacity: 0; transform: translateY(-5px); }
</style>
