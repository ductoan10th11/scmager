<script setup>
import { ChevronRight } from 'lucide-vue-next'

defineProps({
  items: { type: Array, default: () => [] },
})
</script>

<template>
  <nav aria-label="Breadcrumb" class="mb-2 flex min-w-0 items-center gap-1 text-xs font-semibold text-zinc-500">
    <template v-for="(item, index) in items" :key="`${item.label}-${index}`">
      <ChevronRight v-if="index" class="h-3.5 w-3.5 shrink-0 text-zinc-300" />
      <RouterLink v-if="item.to" :to="item.to" class="truncate transition-colors hover:text-zinc-900">{{ item.label }}</RouterLink>
      <span v-else class="truncate text-zinc-800">{{ item.label }}</span>
    </template>
  </nav>
</template>
