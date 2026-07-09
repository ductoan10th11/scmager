<script setup>
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'

const router = useRouter()
</script>

<template>
  <div class="min-h-screen bg-white text-zinc-900 flex flex-col items-center justify-center p-4">
    <div class="max-w-md text-center space-y-6">
      <h1 class="text-4xl font-semibold tracking-tight text-zinc-900">
        eWork
      </h1>
      <p class="text-lg text-zinc-500 leading-relaxed">
        Hệ thống Quản lý Lịch công tác và Theo dõi Nhiệm vụ Cơ quan.
      </p>
      <div class="pt-4 flex gap-4 justify-center">
        <Button @click="router.push('/dashboard')" size="lg" class="font-medium px-8 cursor-pointer">
          Vào Dashboard
        </Button>
      </div>
    </div>
  </div>
</template>
