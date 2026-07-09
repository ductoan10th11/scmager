<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/shared/api/http'
import { DepartmentService } from '@/features/departments/services/department.service'
import { UserService } from '@/features/users/services/user.service'
import { useAuth } from '@/features/auth/composables/useAuth'
import SlidingTabs from '@/components/ui/sliding-tabs/SlidingTabs.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, Building2, Search, Plus, User as UserIcon, Loader2,
  Mail, Shield, Trash2, Edit2, ChevronLeft, ChevronRight, Briefcase
} from 'lucide-vue-next'

const props = defineProps({
  organizationId: {
    type: String,
    required: true
  },
  departmentId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const { user: currentUser } = useAuth()

const activeTab = ref('users')
const TABS = computed(() => [
  { id: 'users', label: 'Nhân sự' },
  { id: 'tasks', label: 'Tình trạng công việc' },
])

const loadingInfo = ref(true)
const department = ref(null)

const users = ref([])
const loadingUsers = ref(false)
const searchUsers = ref('')
const userPage = ref(1)
const userLimit = ref(20)
const userTotal = ref(0)
const userTotalPages = ref(1)

const tasks = ref([])
const loadingTasks = ref(false)

const statusMeta = {
  DRAFT:              { label: 'Nháp',       class: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  TODO:               { label: 'Chờ làm',    class: 'bg-blue-50 text-blue-700 border-blue-200' },
  IN_PROGRESS:        { label: 'Đang làm',   class: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_REVIEW:     { label: 'Chờ duyệt',  class: 'bg-violet-50 text-violet-700 border-violet-200' },
  REVISION_REQUESTED: { label: 'Cần sửa',    class: 'bg-orange-50 text-orange-700 border-orange-200' },
  DONE:               { label: 'Hoàn thành', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED:          { label: 'Đã hủy',     class: 'bg-zinc-50 text-zinc-400 border-zinc-200' },
}

const taskStats = computed(() => {
  const list = tasks.value
  return {
    total: list.length,
    active: list.filter(t => ['TODO', 'IN_PROGRESS', 'REVISION_REQUESTED'].includes(t.status)).length,
    review: list.filter(t => t.status === 'PENDING_REVIEW').length,
    done: list.filter(t => t.status === 'DONE').length,
    overdue: list.filter(isOverdue).length,
  }
})

const fetchDepartmentInfo = async () => {
  loadingInfo.value = true
  try {
    const res = await DepartmentService.getDepartmentById(props.organizationId, props.departmentId)
    if (res?.data) {
      department.value = res.data
    }
  } catch (error) {
    console.error('Lỗi khi tải thông tin phòng ban:', error)
  } finally {
    loadingInfo.value = false
  }
}

const fetchUsers = async () => {
  loadingUsers.value = true
  try {
    const res = await UserService.getUsers({
      limit: userLimit.value,
      page: userPage.value,
      search: searchUsers.value,
      department: props.departmentId
    })
    if (res?.data) {
      users.value = res.data
    }
    if (res?.meta) {
      userTotal.value = res.meta.total || 0
      userTotalPages.value = res.meta.totalPages || 1
    }
  } catch (error) {
    console.error('Lỗi khi tải nhân sự:', error)
  } finally {
    loadingUsers.value = false
  }
}

const fetchTasks = async () => {
  loadingTasks.value = true
  try {
    const params = new URLSearchParams({
      departmentId: props.departmentId,
      limit: '100',
      sort: '-createdAt',
    })
    const res = await http(`/api/tasks?${params}`)
    tasks.value = res?.data ?? []
  } catch (error) {
    console.error('Lỗi khi tải công việc phòng ban:', error)
  } finally {
    loadingTasks.value = false
  }
}

onMounted(() => {
  fetchDepartmentInfo()
  fetchUsers()
  fetchTasks()
})

watch([userPage, userLimit], () => {
  fetchUsers()
})

watch(activeTab, (tab) => {
  if (tab === 'tasks' && tasks.value.length === 0) fetchTasks()
})

let searchTimeout
const handleSearchUsers = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    userPage.value = 1
    fetchUsers()
  }, 300)
}

const goBack = () => {
  router.push(`/organizations/${props.organizationId}/departments`)
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

const isOverdue = (task) => task.dueAt && new Date(task.dueAt) < new Date() && !['DONE', 'CANCELLED'].includes(task.status)
const formatDate = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—'
const taskAssigneeName = (task) => task.assignedTo?.fullName ?? 'Chưa giao'
</script>

<template>
  <div class="flex-1 h-full flex flex-col bg-zinc-50/30 overflow-hidden">
    <header class="shrink-0 px-6 pt-5 pb-4 border-b border-zinc-200/50 bg-white/70 backdrop-blur-md sticky top-0 z-10">
      <!-- Row 1: back + dept info -->
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <Button variant="ghost" class="h-9 rounded-full px-3 text-zinc-500 hover:text-zinc-900 -ml-3 mb-2" @click="goBack">
            <ArrowLeft class="w-4 h-4 mr-2" />
            Phòng ban
          </Button>
          
          <div v-if="loadingInfo" class="flex items-center gap-3">
            <div class="h-11 w-11 rounded-2xl bg-zinc-100 animate-pulse shrink-0"></div>
            <div class="flex flex-col gap-2">
              <div class="h-5 w-48 bg-zinc-100 animate-pulse rounded"></div>
              <div class="h-4 w-32 bg-zinc-100 animate-pulse rounded"></div>
            </div>
          </div>
          
          <div v-else-if="department" class="flex items-center gap-2 min-w-0">
            <div class="h-11 w-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Briefcase class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900 truncate">{{ department.name }}</h1>
              <p class="text-sm font-medium text-zinc-500 mt-1">
                {{ department.code }} 
                <span v-if="department.leader">· Lãnh đạo: {{ department.leader.fullName }}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Row 2: tabs (left) + search (right) -->
      <div class="flex flex-col md:flex-row md:items-center justify-start gap-4 mt-6 relative z-0">
        <!-- Tabs left -->
        <div class="shrink-0 relative z-10">
          <SlidingTabs :tabs="TABS" v-model="activeTab" />
        </div>

        <!-- Search + Action right -->
        <div class="relative z-0 min-h-[40px] flex items-center flex-1">
          <Transition name="slide-behind" mode="out-in">
            <div v-if="activeTab === 'users'" key="users" class="flex items-center gap-3">
              <div class="relative group">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
                  <Search class="w-4 h-4" />
                </span>
                <Input
                  v-model="searchUsers"
                  @input="handleSearchUsers"
                  placeholder="Tìm nhân sự..."
                  class="pl-9 pr-4 h-10 w-full md:w-[260px] bg-white border-zinc-200 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 rounded-full font-medium transition-all shadow-sm shadow-black/[0.02]"
                />
              </div>
            </div>
            
            <div v-else key="tasks" class="flex items-center gap-3">
              <!-- Placeholder for task actions if any -->
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <!-- Users Tab -->
    <main v-if="activeTab === 'users'" class="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
      <div v-if="loadingUsers" class="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
        <Loader2 class="w-8 h-8 animate-spin text-blue-500" />
        <span class="text-sm font-medium animate-pulse">Đang tải dữ liệu...</span>
      </div>

      <div v-else-if="users.length === 0" class="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
        <div class="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-2">
          <UserIcon class="w-8 h-8 text-zinc-300" />
        </div>
        <span class="text-sm font-medium">Không có nhân sự nào trong phòng ban này</span>
      </div>

      <div v-else class="bg-white border border-zinc-200/70 rounded-2xl shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
        <div class="flex-1 min-h-0 relative [&>div]:max-h-full custom-scrollbar-wrapper">
          <Table class="w-full text-sm text-left">
            <TableHeader class="bg-zinc-50 border-b border-zinc-100 text-[10px] uppercase font-bold text-zinc-400 tracking-wider sticky top-0 z-10">
              <TableRow class="!border-0 hover:bg-transparent shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <TableHead class="px-4 py-2 font-bold text-zinc-500">Nhân sự</TableHead>
                <TableHead class="px-4 py-2 font-bold hidden md:table-cell text-zinc-500">Liên hệ</TableHead>
                <TableHead class="px-4 py-2 font-bold text-zinc-500">Trạng thái</TableHead>
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

                <!-- Column 3: Status -->
                <TableCell class="px-4 py-2">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold" :class="user.status === 'ACTIVE' ? 'text-emerald-600' : 'text-zinc-400'">
                      {{ user.status === 'ACTIVE' ? 'Đang hoạt động' : 'Ngưng hoạt động' }}
                    </span>
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

    <!-- Tasks Tab -->
    <main v-if="activeTab === 'tasks'" class="flex-1 overflow-auto p-6 bg-zinc-50/50">
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div class="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
          <p class="text-[11px] font-bold uppercase text-zinc-400">Tổng việc</p>
          <p class="mt-2 text-2xl font-extrabold text-zinc-900">{{ taskStats.total }}</p>
        </div>
        <div class="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p class="text-[11px] font-bold uppercase text-blue-400">Đang xử lý</p>
          <p class="mt-2 text-2xl font-extrabold text-blue-700">{{ taskStats.active }}</p>
        </div>
        <div class="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
          <p class="text-[11px] font-bold uppercase text-violet-400">Chờ duyệt</p>
          <p class="mt-2 text-2xl font-extrabold text-violet-700">{{ taskStats.review }}</p>
        </div>
        <div class="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
          <p class="text-[11px] font-bold uppercase text-emerald-400">Hoàn thành</p>
          <p class="mt-2 text-2xl font-extrabold text-emerald-700">{{ taskStats.done }}</p>
        </div>
        <div class="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
          <p class="text-[11px] font-bold uppercase text-rose-400">Quá hạn</p>
          <p class="mt-2 text-2xl font-extrabold text-rose-700">{{ taskStats.overdue }}</p>
        </div>
      </div>

      <div class="bg-white border border-zinc-200/70 rounded-2xl shadow-sm overflow-hidden">
        <div v-if="loadingTasks" class="flex items-center justify-center py-16 gap-2 text-zinc-400">
          <Loader2 class="w-5 h-5 animate-spin text-blue-500" />
          <span class="text-sm font-medium">Đang tải công việc...</span>
        </div>

        <div v-else-if="tasks.length === 0" class="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
          <div class="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-2">
            <Briefcase class="w-8 h-8 text-zinc-300" />
          </div>
          <span class="text-sm font-medium">Phòng ban chưa có công việc nào</span>
        </div>

        <Table v-else class="w-full text-sm text-left">
          <TableHeader class="bg-zinc-50 border-b border-zinc-100 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
            <TableRow class="!border-0 hover:bg-transparent">
              <TableHead class="px-4 py-3 font-bold text-zinc-500">Công việc</TableHead>
              <TableHead class="px-4 py-3 font-bold text-zinc-500 hidden md:table-cell">Chuyên viên</TableHead>
              <TableHead class="px-4 py-3 font-bold text-zinc-500">Tiến độ</TableHead>
              <TableHead class="px-4 py-3 font-bold text-zinc-500 hidden lg:table-cell">Hạn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody class="divide-y divide-zinc-100">
            <TableRow v-for="task in tasks" :key="task._id" class="border-0 hover:bg-zinc-50/50 transition-colors">
              <TableCell class="px-4 py-3 min-w-[260px]">
                <p class="text-sm font-bold text-zinc-900 leading-tight">{{ task.title }}</p>
                <p class="mt-1 text-xs text-zinc-500 line-clamp-1">{{ task.description || task.type }}</p>
                <p v-if="task.sourceDocument" class="mt-1 text-[11px] font-semibold text-indigo-500">
                  VB: {{ task.sourceDocument.documentNumber }}
                </p>
              </TableCell>
              <TableCell class="px-4 py-3 hidden md:table-cell">
                <span class="text-sm font-semibold text-zinc-700">{{ taskAssigneeName(task) }}</span>
              </TableCell>
              <TableCell class="px-4 py-3">
                <Badge class="rounded-full border px-2.5 py-1 text-[11px] font-bold" :class="statusMeta[task.status]?.class">
                  {{ statusMeta[task.status]?.label ?? task.status }}
                </Badge>
                <Badge v-if="isOverdue(task)" class="ml-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">
                  Quá hạn
                </Badge>
              </TableCell>
              <TableCell class="px-4 py-3 hidden lg:table-cell">
                <span class="text-xs font-semibold" :class="isOverdue(task) ? 'text-rose-600' : 'text-zinc-500'">
                  {{ formatDate(task.dueAt) }}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </main>
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
