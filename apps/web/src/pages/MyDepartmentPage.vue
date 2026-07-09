<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import { Loader2 } from 'lucide-vue-next'

const router = useRouter()
const { user } = useAuth()

const error = ref('')

onMounted(() => {
  const orgId = typeof user.value?.organization === 'object' ? user.value?.organization?._id : user.value?.organization
  const deptId = typeof user.value?.department === 'object' ? user.value?.department?._id : user.value?.department

  if (orgId && deptId) {
    router.replace(`/organizations/${orgId}/departments/${deptId}`)
  } else {
    error.value = 'Tài khoản của bạn chưa được gắn với phòng ban nào!'
  }
})
</script>

<template>
  <div class="flex-1 h-full flex flex-col items-center justify-center text-zinc-400 gap-3">
    <div v-if="error" class="text-rose-500 font-medium text-center">
      {{ error }}
      <div class="mt-4">
        <button @click="router.push('/dashboard')" class="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm transition-colors">
          Về trang chủ
        </button>
      </div>
    </div>
    <div v-else class="flex flex-col items-center gap-3">
      <Loader2 class="w-8 h-8 animate-spin text-blue-500" />
      <span class="text-sm font-medium animate-pulse">Đang chuyển hướng đến phòng ban của bạn...</span>
    </div>
  </div>
</template>
