<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Eye, EyeOff, User, Lock, Loader2 } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const { login } = useAuth()

const loginIdentifier = ref('')
const password = ref('')
const rememberMe = ref(false)
const showPassword = ref(false)
const isLoading = ref(false)
const errorMessage = ref('')

const handleLogin = async () => {
  if (!loginIdentifier.value || !password.value) {
    errorMessage.value = 'Vui lòng điền đầy đủ tên đăng nhập/email và mật khẩu.'
    return
  }

  isLoading.value = true
  errorMessage.value = ''

  try {
    await login({
      login: loginIdentifier.value,
      password: password.value,
      remember: rememberMe.value,
    })
    router.push(route.query.redirect || '/dashboard')
  } catch (error) {
    errorMessage.value = error.message || 'Không thể kết nối đến máy chủ.'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh w-dvw bg-white text-zinc-900 flex select-none font-sans overflow-hidden">
    
    <!-- LEFT PANEL: Brand Image & Quote (Hidden on mobile/tablet) - Width reduced to 38% -->
    <div class="hidden lg:flex lg:w-[38%] relative overflow-hidden bg-zinc-950">
      
      <!-- Background Asset Image -->
      <img 
        src="/login_side_image.png" 
        alt="eWork Workspace" 
        class="absolute inset-0 w-full h-full object-cover opacity-85 scale-100 transition-transform duration-700 hover:scale-105" 
      />

      <!-- Dark Blue Overlay for HIG Material Realism -->
      <div class="absolute inset-0 bg-gradient-to-t from-blue-950/90 via-zinc-950/40 to-zinc-950/50 z-10"></div>
      
      <!-- Branding (Top-Left) - Removed borders/shadows and closed the gap -->
      <div class="absolute top-10 left-10 z-20 flex items-center gap-1.5">
        <img 
          src="/icon.png" 
          alt="eWork Logo" 
          class="w-10 h-10 object-contain select-none" 
        />
        <span class="font-bold text-xl tracking-tight text-white select-none">eWork</span>
      </div>

      <!-- Testimonial / Quote (Bottom-Left) -->
      <div class="absolute bottom-12 left-12 right-12 z-20 flex flex-col gap-3 max-w-lg">
        <p class="text-xl font-medium text-white leading-relaxed tracking-tight select-none">
          "Hệ thống điều phối lịch trình thông minh giúp cơ quan tối ưu hiệu suất."
        </p>
      </div>

    </div>

    <!-- RIGHT PANEL: Login Form Area (Centered vertically/horizontally, takes 62% width) -->
    <div class="w-full lg:w-[62%] flex flex-col justify-between items-center p-6 sm:p-12 md:p-16 relative bg-white z-20 min-h-dvh">
      
      <!-- Top placeholder for vertical alignment centering -->
      <div class="hidden lg:block h-6"></div>

      <!-- Inner Form container -->
      <div class="w-full max-w-[380px] my-auto flex flex-col gap-7">
        
        <!-- Header -->
        <div class="flex flex-col gap-3 items-start">
          <!-- Mobile logo (visible when left panel is hidden) - Removed border and shadow -->
          <img 
            src="/icon.png" 
            alt="eWork Logo" 
            class="w-12 h-12 lg:hidden object-contain select-none" 
          />
          <h2 class="text-3xl font-bold tracking-tight text-zinc-900 mt-2 select-none">
            Chào mừng quay trở lại
          </h2>
          <p class="text-zinc-500 text-sm font-medium leading-relaxed">
            Hệ thống Quản lý Lịch trình & Giao việc Cơ quan. Vui lòng đăng nhập để tiếp tục.
          </p>
        </div>

        <!-- Form -->
        <form @submit.prevent="handleLogin" class="flex flex-col gap-5">
          
          <!-- Login Input -->
          <div class="flex flex-col gap-2">
            <label for="login" class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Tên đăng nhập hoặc email</label>
            <div class="relative group">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
                <User class="w-4 h-4" />
              </span>
              <Input
                id="login"
                type="text"
                v-model="loginIdentifier"
                placeholder="nguyen@email.com"
                required
                class="pl-11 pr-4 h-11 bg-zinc-50/50 border-zinc-200 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none text-zinc-900 placeholder:text-zinc-400 rounded-full font-medium transition-all"
                :disabled="isLoading"
              />
            </div>
          </div>

          <!-- Password Input -->
          <div class="flex flex-col gap-2">
            <label for="password" class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Mật khẩu</label>
            <div class="relative group">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-600 transition-colors">
                <Lock class="w-4 h-4" />
              </span>
              <Input
                id="password"
                :type="showPassword ? 'text' : 'password'"
                v-model="password"
                placeholder="••••••••"
                required
                class="pl-11 pr-10 h-11 bg-zinc-50/50 border-zinc-200 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none text-zinc-900 placeholder:text-zinc-400 rounded-full font-medium transition-all"
                :disabled="isLoading"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-none transition-colors"
                :disabled="isLoading"
              >
                <EyeOff v-if="showPassword" class="w-4 h-4" />
                <Eye v-else class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Utilities Row: Forgot Password & Shadcn Checkbox -->
          <div class="flex justify-between items-center px-1">
            <div class="flex items-center gap-2 select-none">
              <Checkbox 
                id="remember" 
                v-model:checked="rememberMe" 
                :disabled="isLoading" 
              />
              <label for="remember" class="text-xs text-zinc-500 font-semibold cursor-pointer select-none">Ghi nhớ đăng nhập</label>
            </div>
            <a href="#" class="text-xs font-bold text-blue-600 hover:text-blue-500 transition-colors">Quên mật khẩu?</a>
          </div>

          <!-- Error Alert (Smooth transition height/opacity) -->
          <Transition name="fade-height">
            <div v-if="errorMessage" class="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-semibold px-4 py-2.5 rounded-2xl text-center">
              {{ errorMessage }}
            </div>
          </Transition>

          <!-- Submit Button (Tactile rounded full, blue color theme) -->
          <Button
            type="submit"
            class="h-11 rounded-full font-bold bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-lg shadow-blue-600/10 transition-all flex items-center justify-center gap-2 mt-2 select-none border-0 cursor-pointer"
            :disabled="isLoading"
          >
            <Loader2 v-if="isLoading" class="w-4 h-4 animate-spin text-white" />
            <span v-else>Đăng nhập</span>
          </Button>

        </form>

      </div>

      <!-- Footer Copyright (Perfect centered bottom: 32px layout) -->
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-[11px] text-zinc-400 font-medium select-none whitespace-nowrap">
        <span>Bản quyền © 2026 Expsolution.io</span>
      </div>

    </div>
  </div>
</template>

<style scoped>
.fade-height-enter-active,
.fade-height-leave-active {
  transition: all 0.2s ease-out;
}
.fade-height-enter-from,
.fade-height-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
