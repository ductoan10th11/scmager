<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import { preloadProtectedRouteComponents, preloadRouteComponent } from '@/router/page-loaders'
import { 
  Activity, 
  AlertTriangle, 
  BarChart3, 
  Building2, 
  CalendarRange, 
  FileText, 
  LayoutDashboard, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown, 
  Users, 
  TrendingUp, 
  Target,
  FileSpreadsheet,
  Clock3
} from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import NotificationPopover from '@/features/notifications/NotificationPopover.vue'

const route = useRoute()
const { user } = useAuth()
const isCollapsed = ref(false)
const pendingPath = ref(null)
const isKpiOpen = ref(false)
const isKpiPopoverOpen = ref(false)
let pendingTimer = null
let idleHandle = null

const avatarInitials = computed(() => {
  const name = user.value?.fullName || user.value?.email || 'U'
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
})

const roleBadge = computed(() => user.value?.role?.code || 'USER')
const roleCode = computed(() => user.value?.role?.code)

// 1. Menu Cấp cao (Hiển thị trực tiếp)
const topLevelNavItems = computed(() => {
  const items = [
    { name: 'Điều hành', path: '/dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Báo cáo', path: '/commune-reports', icon: FileSpreadsheet, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
  ]
  return items.filter(item => roleCode.value && item.roles.includes(roleCode.value))
})

// 2. Phân hệ gom nhóm: Dropdown KPI
const kpiSubItems = computed(() => {
  const items = [
    { name: 'Văn bản', path: '/office-documents', icon: FileText, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Hiệu suất', path: '/performance', icon: BarChart3, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Lịch công việc', path: '/assignments', icon: CalendarRange, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Báo cáo quá hạn', path: '/reports', icon: AlertTriangle, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER'] },
    { name: 'Giao việc muộn', path: '/late-assignments', icon: Clock3, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER'] },
  ]
  return items.filter(item => roleCode.value && item.roles.includes(roleCode.value))
})

// 3. Quản trị & Hệ thống
const adminNavItems = computed(() => {
  const items = [
    { name: 'Ingest cron', path: '/ingest-monitor', icon: Activity, roles: ['ADMIN'] },
    { name: 'Connector ingest', path: '/connectors', icon: Activity, roles: ['ADMIN'] },
    { name: 'Phòng ban', path: '/my-department', icon: Building2, roles: ['DEPARTMENT_LEADER'] },
    { name: 'Tổ chức', path: '/organizations', icon: Building2, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'] },
    { name: 'Nhân sự', path: '/users', icon: Users, roles: ['ADMIN'] },
  ]
  return items.filter(item => roleCode.value && item.roles.includes(roleCode.value))
})

const isPathActive = (path) => {
  if (path === '/my-department' && ['MyDepartment', 'DepartmentDetail'].includes(String(route.name))) return true
  return route.path === path || (path !== '/' && route.path.startsWith(`${path}/`))
}

const isNavPathActive = (path) => {
  return pendingPath.value ? pendingPath.value === path : isPathActive(path)
}

// Kiểm tra xem trang hiện tại có thuộc nhóm dropdown KPI không
const isKpiActive = computed(() => {
  return kpiSubItems.value.some(sub => isPathActive(sub.path))
})

// Các trang tự quản lý header và scrolling (full-bleed, không bị padding top/left từ MainLayout)
const isFullBleedPage = computed(() => {
  return isKpiActive.value || ['/users', '/organizations', '/my-department', '/connectors', '/ingest-monitor'].some(path => isPathActive(path))
})

// Tự động mở dropdown nếu đang ở 1 trang con của KPI
watch(
  () => route.path,
  () => {
    if (isKpiActive.value) {
      isKpiOpen.value = true
    }
  },
  { immediate: true }
)

const clearPendingPath = () => {
  pendingPath.value = null
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
}

const preloadPath = (path) => {
  preloadRouteComponent(path)
}

const markPendingPath = (path) => {
  preloadPath(path)
  if (isPathActive(path)) return

  pendingPath.value = path
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(clearPendingPath, 1500)
}

const toggleKpiDropdown = () => {
  if (isCollapsed.value) {
    isCollapsed.value = false
    isKpiOpen.value = true
  } else {
    isKpiOpen.value = !isKpiOpen.value
  }
}

watch(() => route.fullPath, clearPendingPath)

onMounted(() => {
  const preload = () => preloadProtectedRouteComponents()

  if ('requestIdleCallback' in window) {
    idleHandle = window.requestIdleCallback(preload, { timeout: 1200 })
    return
  }

  idleHandle = window.setTimeout(preload, 250)
})

onUnmounted(() => {
  clearPendingPath()
  if (idleHandle && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(idleHandle)
  } else if (idleHandle) {
    clearTimeout(idleHandle)
  }
})
</script>

<template>
  <div class="h-dvh w-dvw flex flex-col md:flex-row overflow-hidden bg-white selection:bg-blue-100 selection:text-blue-900 relative">
    
    <!-- Sidebar Navigation -->
    <nav class="shrink-0 h-[60px] md:h-full border-t md:border-t-0 md:border-r border-zinc-200/50 bg-zinc-50/50 flex md:flex-col justify-around md:justify-start items-center md:items-stretch py-2 md:pt-4 md:pb-3 z-40 order-2 md:order-1 transition-all duration-300 ease-in-out px-2 md:px-3"
         :style="{ width: isCollapsed ? '68px' : '260px' }">
         
      <!-- Desktop Brand Area -->
      <div class="hidden md:flex flex-col justify-center mb-5 mt-2 overflow-hidden px-3 w-full">
        <div class="transition-opacity duration-300" :class="isCollapsed ? 'opacity-0' : 'opacity-100'">
          <span class="font-bold text-base tracking-tight text-zinc-900 block leading-tight">Xã Thiện Tân</span>
          <span class="text-[9px] uppercase tracking-wider font-semibold text-zinc-400 block mt-0.5">Hệ thống Điều hành</span>
        </div>
      </div>

      <!-- Main Navigation -->
      <div class="flex md:flex-col gap-1 w-full justify-around md:justify-start flex-1 mt-2 md:mt-0 overflow-y-auto overflow-x-hidden no-scrollbar">
        
        <!-- 1. Menu Cấp cao: Tổng quan & Thống kê Xã -->
        <router-link
          v-for="item in topLevelNavItems"
          :key="item.path"
          :to="item.path"
          class="w-full"
          @mouseenter="preloadPath(item.path)"
          @focus="preloadPath(item.path)"
          @click="markPendingPath(item.path)"
        >
          <div
            :class="[
              'relative flex items-center gap-3 px-3 h-[42px] w-full rounded-full transition-colors duration-200 select-none cursor-pointer overflow-hidden',
              isNavPathActive(item.path)
                ? 'text-zinc-900 bg-white font-semibold shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-zinc-900/5' 
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium'
            ]"
          >
            <component :is="item.icon" :size="19" :stroke-width="isNavPathActive(item.path) ? 2.5 : 2" :class="isNavPathActive(item.path) ? 'text-blue-600 shrink-0' : 'shrink-0'" />
            <span class="text-[10px] md:text-sm tracking-tight whitespace-nowrap transition-opacity duration-200 shrink-0" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">{{ item.name }}</span>
          </div>
        </router-link>

        <!-- 2. Dropdown KPI -->
        <div v-if="kpiSubItems.length > 0" class="w-full">
          <!-- Desktop Mode: Collapsible Accordion khi expanded -->
          <div v-if="!isCollapsed" class="hidden md:block w-full">
            <button
              type="button"
              :class="[
                'relative flex items-center justify-between px-3 h-[42px] w-full rounded-full transition-colors duration-200 select-none cursor-pointer overflow-hidden',
                isKpiActive
                  ? 'text-blue-700 bg-blue-50/50 font-semibold ring-1 ring-blue-500/10'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium'
              ]"
              @click="toggleKpiDropdown"
            >
              <div class="flex items-center gap-3">
                <Target :size="19" :stroke-width="isKpiActive ? 2.5 : 2" :class="isKpiActive ? 'text-blue-600' : 'text-zinc-500'" />
                <span class="text-sm tracking-tight whitespace-nowrap">KPI</span>
              </div>
              <ChevronDown
                :size="15"
                :class="[
                  'text-zinc-400 transition-transform duration-200',
                  isKpiOpen ? 'rotate-180 text-zinc-700' : ''
                ]"
              />
            </button>

            <!-- Menu con xổ xuống -->
            <div
              v-show="isKpiOpen"
              class="flex flex-col gap-1 pl-4 pr-1 py-1 mt-0.5 space-y-0.5 transition-all duration-200"
            >
              <router-link
                v-for="sub in kpiSubItems"
                :key="sub.path"
                :to="sub.path"
                class="w-full"
                @mouseenter="preloadPath(sub.path)"
                @focus="preloadPath(sub.path)"
                @click="markPendingPath(sub.path)"
              >
                <div
                  :class="[
                    'relative flex items-center gap-2.5 px-3 h-[36px] w-full rounded-full transition-colors duration-150 select-none cursor-pointer',
                    isNavPathActive(sub.path)
                      ? 'text-zinc-900 bg-white font-semibold shadow-xs ring-1 ring-zinc-900/5'
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/40 font-medium'
                  ]"
                >
                  <component :is="sub.icon" :size="15" :class="isNavPathActive(sub.path) ? 'text-blue-600' : 'text-zinc-400'" />
                  <span class="text-xs tracking-tight whitespace-nowrap">{{ sub.name }}</span>
                </div>
              </router-link>
            </div>
          </div>

          <!-- Mini Sidebar / Mobile Mode: Popover Floating Menu -->
          <div :class="[isCollapsed ? 'block' : 'md:hidden block', 'w-full']">
            <Popover v-model:open="isKpiPopoverOpen">
              <PopoverTrigger as-child>
                <button
                  type="button"
                  :class="[
                    'relative flex items-center justify-center md:px-3 h-[42px] w-full rounded-full transition-colors duration-200 cursor-pointer',
                    isKpiActive
                      ? 'text-blue-600 bg-white shadow-xs ring-1 ring-zinc-900/5'
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50'
                  ]"
                >
                  <Target :size="19" :stroke-width="isKpiActive ? 2.5 : 2" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" class="w-52 p-2 rounded-2xl shadow-xl bg-white border border-zinc-200/80">
                <div class="px-2.5 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  KPI
                </div>
                <div class="space-y-1 mt-1">
                  <router-link
                    v-for="sub in kpiSubItems"
                    :key="sub.path"
                    :to="sub.path"
                    class="block"
                    @click="isKpiPopoverOpen = false; markPendingPath(sub.path)"
                  >
                    <div
                      :class="[
                        'flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-colors',
                        isNavPathActive(sub.path)
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                      ]"
                    >
                      <component :is="sub.icon" :size="15" />
                      <span>{{ sub.name }}</span>
                    </div>
                  </router-link>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <!-- Phân cách danh mục quản trị -->
        <div v-if="adminNavItems.length > 0 && !isCollapsed" class="hidden md:block pt-3 pb-1 px-3">
          <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Quản trị hệ thống</span>
        </div>

        <!-- 3. Quản trị -->
        <router-link
          v-for="item in adminNavItems"
          :key="item.path"
          :to="item.path"
          class="hidden md:block w-full"
          @mouseenter="preloadPath(item.path)"
          @focus="preloadPath(item.path)"
          @click="markPendingPath(item.path)"
        >
          <div
            :class="[
              'relative flex items-center gap-3 px-3 h-[42px] w-full rounded-full transition-colors duration-200 select-none cursor-pointer overflow-hidden',
              isNavPathActive(item.path)
                ? 'text-zinc-900 bg-white font-semibold shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-zinc-900/5' 
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium'
            ]"
          >
            <component :is="item.icon" :size="18" :stroke-width="isNavPathActive(item.path) ? 2.5 : 2" :class="isNavPathActive(item.path) ? 'text-blue-600 shrink-0' : 'shrink-0'" />
            <span class="text-xs tracking-tight whitespace-nowrap transition-opacity duration-200 shrink-0" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">{{ item.name }}</span>
          </div>
        </router-link>

        <NotificationPopover class="md:mt-auto" :collapsed="isCollapsed" />
      </div>

      <!-- Bottom Settings & Profile -->
      <div class="hidden md:flex flex-col gap-1.5 mt-auto overflow-hidden w-full">
        <router-link
          v-if="user"
          to="/settings"
          class="block w-full"
          @mouseenter="preloadPath('/settings')"
          @focus="preloadPath('/settings')"
          @click="markPendingPath('/settings')"
        >
          <div
            :class="[
              'flex h-[50px] w-full items-center gap-3 overflow-hidden shrink-0 rounded-full border border-transparent p-2 transition-colors duration-200 select-none cursor-pointer text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium',
              isNavPathActive('/settings') ? 'text-zinc-900 bg-white border-zinc-200/70 font-semibold shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]' : '',
              isCollapsed ? 'justify-center' : ''
            ]"
          >
            <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br from-blue-600 to-indigo-600 shadow-xs">
              {{ avatarInitials }}
            </div>
            <div class="min-w-0 flex-1 flex flex-col justify-center gap-0.5 transition-opacity duration-200" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">
              <span class="text-xs font-bold text-zinc-900 truncate leading-none">{{ user.fullName || user.email }}</span>
              <span class="w-fit max-w-full rounded-full bg-zinc-100 px-1.5 py-0.5 text-[8.5px] font-extrabold text-zinc-500 uppercase tracking-wider truncate leading-none">{{ roleBadge }}</span>
            </div>
          </div>
        </router-link>
      </div>
    </nav>

    <!-- Sidebar Toggle Hotzone -->
    <div 
      class="hidden md:flex absolute top-0 bottom-0 z-50 w-6 cursor-pointer items-center justify-center transition-all duration-300 ease-in-out group"
      :style="{ left: isCollapsed ? '68px' : '260px', transform: 'translateX(-50%)' }"
      @click="isCollapsed = !isCollapsed"
    >
      <div 
        class="h-12 w-5 flex items-center justify-center rounded-full border border-zinc-200/80 shadow-md bg-white text-zinc-500 group-hover:text-zinc-900 group-hover:scale-105 transition-all pointer-events-none z-10"
      >
        <ChevronRight v-if="isCollapsed" class="h-3.5 w-3.5" />
        <ChevronLeft v-else class="h-3.5 w-3.5" />
      </div>
    </div>

    <!-- Main Content Area -->
    <main
      class="flex-1 h-full relative order-1 md:order-2 flex flex-col min-w-0 min-h-0"
      :class="[
        isFullBleedPage
          ? 'p-0 overflow-hidden bg-white'
          : 'overflow-y-auto bg-white rounded-l-2xl border-l border-zinc-200/40 shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.05)] p-3 sm:p-5 md:p-8'
      ]"
    >
      <router-view />
    </main>
    
  </div>
</template>
