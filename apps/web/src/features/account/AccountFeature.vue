<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, LogOut, Shield, SlidersHorizontal, UserRound } from 'lucide-vue-next'
import { useAuth } from '@/features/auth/composables/useAuth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const route = useRoute()
const router = useRouter()
const { user, logout } = useAuth()

const activeTab = computed({
  get() {
    return route.query.tab === 'settings' ? 'settings' : 'profile'
  },
  set(value) {
    router.replace({
      path: '/settings',
      query: value === 'profile' ? {} : { tab: value },
    })
  },
})

const initials = computed(() => {
  const name = user.value?.fullName || user.value?.email || 'U'
  return name.split(' ').map((part) => part[0]).join('').substring(0, 2).toUpperCase()
})

const roleBadge = computed(() => user.value?.role?.code || 'USER')

const handleLogout = async () => {
  await logout()
  router.push('/login')
}

const isUserActive = computed({
  get: () => user.value?.status === 'ACTIVE',
  set: () => {}
})
</script>

<template>
  <section class="h-full overflow-auto bg-zinc-50/40">
    <div class="max-w-5xl mx-auto p-6 md:p-8 flex flex-col gap-6">
      <header class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900 tracking-tight">Tài khoản</h1>
          <p class="mt-2 text-sm font-medium text-zinc-500">Thông tin cá nhân và tùy chọn hệ thống của bạn.</p>
        </div>
      </header>

      <Tabs v-model="activeTab" class="flex flex-col gap-6">
        <TabsList class="w-fit max-w-full rounded-full bg-zinc-100 p-1 flex-nowrap overflow-x-auto">
          <TabsTrigger value="profile" class="rounded-full px-5 gap-2 whitespace-nowrap shrink-0">
            <UserRound class="w-4 h-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="settings" class="rounded-full px-5 gap-2 whitespace-nowrap shrink-0">
            <SlidersHorizontal class="w-4 h-4" />
            Setting
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" class="mt-0">
          <div class="bg-white border border-zinc-200/70 !rounded-[32px] shadow-sm overflow-hidden">
            <div class="p-4 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div class="flex h-[60px] w-full max-w-[420px] items-center gap-3 rounded-full p-2 min-w-0">
                <div class="h-11 w-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-base font-bold shadow-sm shrink-0">
                  {{ initials }}
                </div>
                <div class="min-w-0 flex flex-col justify-center gap-1.5">
                  <h2 class="text-base font-bold text-zinc-900 truncate leading-none">{{ user?.fullName || user?.username || 'Người dùng' }}</h2>
                  <Badge class="w-fit max-w-full rounded-full bg-zinc-100 text-zinc-600 border-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-wider leading-none truncate">{{ roleBadge }}</Badge>
                </div>
              </div>
              <Button
                variant="outline"
                class="rounded-full border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-bold gap-2 shrink-0"
                @click="handleLogout"
              >
                <LogOut class="w-4 h-4" />
                Đăng xuất
              </Button>
            </div>

            <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Họ tên</label>
                <Input :model-value="user?.fullName" readonly class="h-11 rounded-full bg-zinc-50 px-4" />
              </div>
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Tên đăng nhập</label>
                <Input :model-value="user?.username" readonly class="h-11 rounded-full bg-zinc-50 px-4" />
              </div>
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Email</label>
                <Input :model-value="user?.email" readonly class="h-11 rounded-full bg-zinc-50 px-4" />
              </div>
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-500 uppercase tracking-wider">Trạng thái</label>
                <div class="flex items-center gap-3 h-11">
                  <div 
                    class="inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors pointer-events-none"
                    :class="user?.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-zinc-200'"
                  >
                    <span 
                      class="block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform"
                      :class="user?.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'"
                    />
                  </div>
                  <span class="text-sm font-bold text-zinc-700">{{ user?.status === 'ACTIVE' ? 'Đang hoạt động' : user?.status }}</span>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings" class="mt-0">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <article class="bg-white border border-zinc-200/70 !rounded-[32px] p-6 shadow-sm">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Bell class="w-5 h-5" />
                </div>
                <div>
                  <h2 class="font-bold text-zinc-900">Thông báo</h2>
                  <p class="text-sm text-zinc-500 font-medium mt-1">Tùy chọn nhận thông báo trong hệ thống.</p>
                </div>
              </div>
              <div class="mt-5 flex flex-col gap-3">
                <label class="flex items-center justify-between gap-4 text-sm font-semibold text-zinc-700">
                  In-app
                  <input type="checkbox" checked class="h-4 w-4" disabled />
                </label>
                <label class="flex items-center justify-between gap-4 text-sm font-semibold text-zinc-700">
                  Email
                  <input type="checkbox" class="h-4 w-4" disabled />
                </label>
              </div>
            </article>

            <article class="bg-white border border-zinc-200/70 !rounded-[32px] p-6 shadow-sm">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Shield class="w-5 h-5" />
                </div>
                <div>
                  <h2 class="font-bold text-zinc-900">Bảo mật</h2>
                  <p class="text-sm text-zinc-500 font-medium mt-1">Phiên đăng nhập dùng cookie HTTP-only.</p>
                </div>
              </div>
              <Button class="mt-5 rounded-full font-bold" variant="outline" disabled>Đổi mật khẩu</Button>
            </article>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  </section>
</template>
