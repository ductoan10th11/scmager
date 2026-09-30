<script setup>
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'

const props = defineProps({
  metrics: {
    type: Array,
    default: () => [],
  },
  summary: {
    type: Object,
    default: () => ({}),
  },
})

// Bóc tách 4 chỉ tiêu cốt lõi
const budgetMetric = computed(() => props.metrics.find((m) => m.code === 'KT-01') || {
  name: 'Thu ngân sách địa bàn',
  actualValue: 14.85,
  targetValue: 15.2,
  unit: 'Tỷ đồng',
  completionRate: 97.7,
})

const povertyMetric = computed(() => props.metrics.find((m) => m.code === 'XH-01') || {
  name: 'Tỷ lệ hộ nghèo đa chiều',
  actualValue: 1.12,
  targetValue: 1.5,
  unit: '%',
  completionRate: 100,
})

const healthMetric = computed(() => props.metrics.find((m) => m.code === 'XH-02') || {
  name: 'Bao phủ BHYT toàn dân',
  actualValue: 96.4,
  targetValue: 95.0,
  unit: '%',
  completionRate: 101.4,
})

const adminMetric = computed(() => props.metrics.find((m) => m.code === 'HC-01') || {
  name: 'Giải quyết TTHC đúng hạn',
  actualValue: 99.4,
  targetValue: 98.0,
  unit: '%',
  completionRate: 101.4,
})

const statCards = computed(() => [
  {
    label: budgetMetric.value.name,
    value: budgetMetric.value.actualValue,
    unit: budgetMetric.value.unit,
    target: `KH: ${budgetMetric.value.targetValue} ${budgetMetric.value.unit}`,
    rate: `${budgetMetric.value.completionRate}%`,
    rateColor: budgetMetric.value.completionRate >= 95 ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-amber-700 bg-amber-50 border-amber-200',
    progress: Math.min(budgetMetric.value.completionRate, 100),
  },
  {
    label: povertyMetric.value.name,
    value: povertyMetric.value.actualValue,
    unit: povertyMetric.value.unit,
    target: `Mục tiêu: < ${povertyMetric.value.targetValue}%`,
    rate: 'Đạt chỉ tiêu',
    rateColor: 'text-blue-700 bg-blue-50 border-blue-200',
    progress: 100,
  },
  {
    label: healthMetric.value.name,
    value: healthMetric.value.actualValue,
    unit: healthMetric.value.unit,
    target: `Chỉ tiêu: ${healthMetric.value.targetValue}%`,
    rate: `${healthMetric.value.completionRate}%`,
    rateColor: 'text-blue-700 bg-blue-50 border-blue-200',
    progress: Math.min(healthMetric.value.completionRate, 100),
  },
  {
    label: adminMetric.value.name,
    value: adminMetric.value.actualValue,
    unit: adminMetric.value.unit,
    target: `Tối thiểu: ${adminMetric.value.targetValue}%`,
    rate: 'Đạt chuẩn',
    rateColor: 'text-blue-700 bg-blue-50 border-blue-200',
    progress: Math.min(adminMetric.value.completionRate, 100),
  },
])
</script>

<template>
  <div class="w-full min-w-0 space-y-3">
    <!-- Grid 4 thẻ số liệu tông Trắng - Xanh dương thân thiện -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full min-w-0">
      <Card
        v-for="(card, idx) in statCards"
        :key="idx"
        class="border border-blue-100/90 shadow-none hover:border-blue-300 transition-colors bg-white rounded-xl w-full min-w-0"
      >
        <CardContent class="p-4 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-slate-500 truncate" :title="card.label">
              {{ card.label }}
            </span>
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0" :class="card.rateColor">
              {{ card.rate }}
            </span>
          </div>

          <div class="flex items-baseline gap-1.5">
            <span class="text-2xl font-bold tracking-tight text-blue-950 tabular-nums">
              {{ card.value }}
            </span>
            <span class="text-xs text-blue-600/80 font-medium">{{ card.unit }}</span>
          </div>

          <div class="space-y-1.5">
            <div class="w-full bg-blue-50 rounded-full h-1.5 overflow-hidden">
              <div
                class="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                :style="{ width: `${card.progress}%` }"
              ></div>
            </div>
            <div class="text-[11px] text-slate-400 truncate">
              {{ card.target }}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
