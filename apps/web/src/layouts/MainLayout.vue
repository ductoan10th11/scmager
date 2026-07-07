<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { LayoutDashboard, Calendar, CheckSquare, Settings, LogOut, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const route = useRoute()
const isCollapsed = ref(false)

const navItems = [
  { name: 'Tổng quan', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Nhiệm vụ', path: '/task', icon: CheckSquare },
  { name: 'Lịch công tác', path: '/schedule', icon: Calendar },
]
</script>

<template>
  <div class="h-dvh w-dvw flex flex-col md:flex-row overflow-hidden bg-white selection:bg-blue-100 selection:text-blue-900 relative">
    
    <!-- Sidebar Navigation -->
    <nav class="shrink-0 h-[60px] md:h-full border-t md:border-t-0 md:border-r border-zinc-200/50 bg-zinc-50/50 flex md:flex-col justify-around md:justify-start items-center md:items-stretch py-2 md:py-4 z-40 order-2 md:order-1 transition-all duration-300 ease-in-out px-2 md:px-3"
         :style="{ width: isCollapsed ? '68px' : '260px' }">
         
      <!-- Desktop Logo Area -->
      <div class="hidden md:flex items-center ml-4 mb-8 mt-2 overflow-hidden px-1.5 w-full">
        <div class="flex items-center gap-2.5 overflow-hidden w-full">
          <!-- <img src="/icon.png" alt="SCMager Logo" class="w-11 h-11 shrink-0 object-cover" /> -->
          <div class="flex flex-col shrink-0 transition-opacity duration-300" :class="isCollapsed ? 'opacity-0' : 'opacity-100'">
            <span class="font-bold text-lg tracking-tight text-zinc-900 leading-none">SCMager</span>
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
          v-slot="{ isActive }"
          class="w-full"
        >
          <div
            :class="[
              'flex items-center gap-3 px-3 h-[44px] w-full rounded-full transition-colors duration-200 select-none cursor-pointer overflow-hidden',
              isActive 
                ? 'text-zinc-900 bg-white font-semibold shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-zinc-900/5' 
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium'
            ]"
          >
            <component :is="item.icon" :size="20" :stroke-width="isActive ? 2.5 : 2" :class="isActive ? 'text-blue-600 shrink-0' : 'shrink-0'" />
            <span class="text-[10px] md:text-sm tracking-tight whitespace-nowrap transition-opacity duration-200 shrink-0" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">{{ item.name }}</span>
          </div>
        </router-link>
      </div>

      <!-- Bottom Settings -->
      <div class="hidden md:flex flex-col gap-1.5 mt-auto pb-4 overflow-hidden w-full">
        <div class="h-px bg-zinc-200/50 mb-2 mx-1"></div>
        <router-link to="/">
          <div class="flex items-center gap-3 px-3 h-[44px] w-full rounded-full transition-colors duration-200 select-none cursor-pointer text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50 font-medium overflow-hidden">
            <Settings :size="20" :stroke-width="2" class="shrink-0" />
            <span class="text-sm tracking-tight whitespace-nowrap transition-opacity duration-200 shrink-0" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">Cài đặt</span>
          </div>
        </router-link>
        <router-link to="/">
          <div class="flex items-center gap-3 px-3 h-[44px] w-full rounded-full transition-colors duration-200 select-none cursor-pointer text-red-500 hover:text-red-600 hover:bg-red-50 font-medium overflow-hidden">
            <LogOut :size="20" :stroke-width="2" class="shrink-0" />
            <span class="text-sm tracking-tight whitespace-nowrap transition-opacity duration-200 shrink-0" :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">Đăng xuất</span>
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
