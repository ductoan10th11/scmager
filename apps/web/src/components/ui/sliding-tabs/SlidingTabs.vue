<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps({
  tabs: { type: Array, required: true }, // [{ id, label, icon? }]
  modelValue: { type: String, required: true },
})

const emit = defineEmits(['update:modelValue'])

const containerRef = ref(null)
const indicator = ref({ left: 0, width: 0 })

const updateIndicator = () => {
  if (!containerRef.value) return
  const activeEl = containerRef.value.querySelector('[data-active="true"]')
  if (!activeEl) return
  indicator.value = { left: activeEl.offsetLeft, width: activeEl.offsetWidth }
}

watch(() => props.modelValue, async () => { await nextTick(); updateIndicator() })
onMounted(async () => { await nextTick(); updateIndicator() })
</script>

<template>
  <div ref="containerRef" class="relative inline-flex items-center rounded-full bg-zinc-100 p-1 gap-0.5">
    <!-- sliding pill indicator -->
    <div
      class="pointer-events-none absolute top-1 bottom-1 rounded-full bg-white shadow-md transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
      :style="{ left: `${indicator.left}px`, width: `${indicator.width}px` }"
    />

    <button
      v-for="tab in tabs"
      :key="tab.id"
      :data-active="String(modelValue === tab.id)"
      class="relative z-10 flex items-center gap-2 h-9 px-4 rounded-full text-sm font-bold whitespace-nowrap select-none transition-colors duration-200 focus-visible:outline-none"
      :class="modelValue === tab.id ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'"
      @click="emit('update:modelValue', tab.id)"
    >
      <component
        v-if="tab.icon"
        :is="tab.icon"
        class="w-4 h-4 shrink-0 transition-colors duration-200"
        :class="modelValue === tab.id ? 'text-blue-600' : 'text-zinc-400'"
      />
      <span>{{ tab.label }}</span>
    </button>
  </div>
</template>
