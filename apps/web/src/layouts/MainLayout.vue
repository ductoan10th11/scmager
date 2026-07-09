<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import { preloadProtectedRouteComponents, preloadRouteComponent } from '@/router/page-loaders'
import { Bell, Building2, FileText, LayoutDashboard, Calendar, CheckSquare, ChevronLeft, ChevronRight, UserPlus, Users, Clock } from 'lucide-vue-next'

const route = useRoute()
const { user } = useAuth()
const isCollapsed = ref(false)
const pendingPath = ref(null)
let pendingTimer = null
let idleHandle = null

const avatarInitials = computed(() => {
  const name = user.value?.fullName || user.value?.email || 'U'
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
})

const roleBadge = computed(() => user.value?.role?.code || 'USER')

const navItems = computed(() => {
  const roleCode = user.value?.role?.code
  if (roleCode === 'DEPARTMENT_LEADER') {
    return [
      { name: 'Tổng quan',       path: '/dashboard',      icon: LayoutDashboard },
      { name: 'Văn bản phòng',   path: '/documents',      icon: FileText },
      { name: 'Giao chuyên viên', path: '/assignments',    icon: UserPlus },
      { name: 'Theo dõi tiến độ', path: '/tasks',          icon: CheckSquare },
      { name: 'Phòng của tôi',   path: '/my-department',  icon: Building2 },
      { name: 'Thông báo',       path: '/notifications',  icon: Bell },
    ]
  }
  if (roleCode === 'SPECIALIST') {
    return [
      { name: 'Tổng quan',       path: '/dashboard',     icon: LayoutDashboard },
      { name: 'Lịch làm việc',   path: '/schedule',      icon: Calendar },
      { name: 'Nhiệm vụ của tôi', path: '/tasks',         icon: CheckSquare },
      { name: 'Thông báo',       path: '/notifications', icon: Bell },
    ]
  }

  const allItems = [
    // --- Công việc ---
    { name: 'Tổng quan',     path: '/dashboard',      icon: LayoutDashboard, roles: ['OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Lịch công tác', path: '/schedule',       icon: Calendar,        roles: ['COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Nhiệm vụ',      path: '/tasks',          icon: CheckSquare,     roles: ['COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Giao việc',     path: '/assignments',    icon: UserPlus,        roles: ['COMMUNE_LEADER', 'DEPARTMENT_LEADER'] },
    { name: 'Văn bản',       path: '/documents',      icon: FileText,        roles: ['OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    { name: 'Thông báo',     path: '/notifications',  icon: Bell,            roles: ['COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
    // --- Quản trị ---
    { name: 'Phòng ban',     path: '/my-department',  icon: Building2,       roles: ['DEPARTMENT_LEADER'] },
    { name: 'Tổ chức',       path: '/organizations',  icon: Building2,       roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'] },
    { name: 'Nhân sự',       path: '/users',          icon: Users,           roles: ['ADMIN'] },
  ]
  return allItems.filter(item => roleCode && item.roles.includes(roleCode))
})

const clearPendingPath = () => {
  pendingPath.value = null
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
}

const isPathActive = (path) => {
  return route.path === path || (path !== '/' && route.path.startsWith(`${path}/`))
}

const isNavPathActive = (path) => {
  return pendingPath.value ? pendingPath.value === path : isPathActive(path)
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
         
      <!-- Desktop Logo Area -->
      <div class="hidden md:flex items-center ml-4 mb-8 mt-2 overflow-hidden px-1.5 w-full">
        <div class="flex items-center gap-2.5 overflow-hidden w-full">
          <!-- <img src="/icon.png" alt="SCMager Logo" class="w-11 h-11 shrink-0 object-cover" /> -->
          <div class="flex flex-col shrink-0 transition-opacity duration-300" :class="isCollapsed ? 'opacity-0' : 'opacity-100'">
            <span class="font-bold text-lg tracking-tight text-zinc-900 leading-none">eWork</span>
            <span class="text-[9px] uppercase tracking-wider font-bold text-zinc-400 mt-0.5">Workspace</span>
          </div>
        </div>
      </div>

      <!-- Main Navigation -->
      <div class="flex md:flex-col gap-1.5 w-full justify-around md:justify-start flex-1 mt-4 md:mt-0">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="w-full"
          @mouseenter="preloadPath(item.path)"
          @focus="preloadPath(item.path)"
          @click="markPendingPath(item.path)"
        >
          <div
            :class="[
              'flex items-center gap-3 px-3 h-[44px] w-full rounded-full transition-colors duration-200 select-none cursor-pointer overflow-hidden',
              isNavPathActive(item.path)
                ? 'text-zinc-900 bg-white font-semibold shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-zinc-900/5' 
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium'
            ]"
          >
            <component :is="item.icon" :size="20" :stroke-width="isNavPathActive(item.path) ? 2.5 : 2" :class="isNavPathActive(item.path) ? 'text-blue-600 shrink-0' : 'shrink-0'" />
            <span class="text-[10px] md:text-sm tracking-tight whitespace-nowrap transition-opacity duration-200 shrink-0" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">{{ item.name }}</span>
          </div>
        </router-link>
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
              'flex h-[52px] w-full items-center gap-3 overflow-hidden shrink-0 rounded-full border border-transparent p-2 transition-colors duration-200 select-none cursor-pointer text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium',
              isNavPathActive('/settings') ? 'text-zinc-900 bg-white border-zinc-200/70 font-semibold shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]' : '',
              isCollapsed ? 'justify-center' : ''
            ]"
          >
            <div class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
              {{ avatarInitials }}
            </div>
            <div class="min-w-0 flex-1 flex flex-col justify-center gap-1.5 transition-opacity duration-200" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">
              <span class="text-sm font-bold text-zinc-900 truncate leading-none">{{ user.fullName || user.email }}</span>
              <span class="w-fit max-w-full rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-extrabold text-zinc-500 uppercase tracking-wider truncate leading-none">{{ roleBadge }}</span>
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
    <main class="flex-1 h-full overflow-hidden bg-white relative order-1 md:order-2 flex flex-col rounded-l-2xl border-l border-zinc-200/40 shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.05)] min-w-0 min-h-0">
      <router-view />
    </main>
    
  </div>
</template>
