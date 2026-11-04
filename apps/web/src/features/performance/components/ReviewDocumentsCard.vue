<script setup>
import { TriangleAlert } from 'lucide-vue-next'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

defineProps({
  documents: { type: Array, default: () => [] },
})
const emit = defineEmits(['open'])

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('vi-VN') : '—')
</script>

<template>
  <Card v-if="documents.length" class="rounded-2xl border border-amber-200 bg-amber-50/30 shadow-sm overflow-hidden">
    <div class="px-6 py-4 border-b border-amber-100">
      <h2 class="flex items-center gap-2 text-base font-bold text-zinc-900 tracking-tight">
        <TriangleAlert class="w-4 h-4 text-amber-600" />
        Công việc cần xem xét ({{ documents.length }})
      </h2>
      <p class="text-xs font-medium text-zinc-500 mt-0.5">
        Chuyên viên đề nghị là việc không cần làm. Chưa tính vào tổng điểm và các tỷ lệ cho đến khi lãnh đạo quyết định.
      </p>
    </div>
    <div class="overflow-x-auto">
      <Table class="min-w-[900px]">
        <TableHeader class="bg-white/60 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
          <TableRow class="border-b border-amber-100 hover:bg-transparent">
            <TableHead class="py-3 px-6 font-bold text-zinc-500">Thông tin văn bản</TableHead>
            <TableHead class="py-3 px-4 font-bold text-zinc-500">Người thực hiện</TableHead>
            <TableHead class="py-3 px-4 font-bold text-zinc-500">Hạn xử lý</TableHead>
            <TableHead class="py-3 px-4 font-bold text-zinc-500">Lý do</TableHead>
            <TableHead class="py-3 px-6 font-bold text-zinc-500">Đề nghị</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody class="divide-y divide-amber-100">
          <TableRow
            v-for="document in documents"
            :key="document.id"
            tabindex="0"
            role="button"
            class="cursor-pointer hover:bg-amber-50/60 transition-colors"
            @click="emit('open', document)"
            @keydown.enter="emit('open', document)"
            @keydown.space.prevent="emit('open', document)"
          >
            <TableCell class="py-3.5 px-6 max-w-[360px]">
              <p class="truncate font-bold text-sm text-zinc-900">{{ document.soKyHieu || document.documentId }}</p>
              <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600 font-medium">
                {{ document.trichYeu || 'Không có trích yếu nội dung.' }}
              </p>
            </TableCell>
            <TableCell class="py-3.5 px-4 text-xs font-bold text-zinc-800">
              {{ document.owner?.fullName || 'Chưa map người xử lý' }}
            </TableCell>
            <TableCell class="py-3.5 px-4 text-xs font-bold text-zinc-800">{{ formatDate(document.deadline) }}</TableCell>
            <TableCell class="py-3.5 px-4 max-w-[280px] text-xs text-zinc-700">
              <p class="line-clamp-3">{{ document.notRequired?.reason || '—' }}</p>
            </TableCell>
            <TableCell class="py-3.5 px-6 text-xs text-zinc-600">
              <p class="font-bold text-zinc-800">{{ document.notRequired?.requestedByName || '—' }}</p>
              <p class="mt-0.5 text-[11px] text-zinc-500">{{ formatDate(document.notRequired?.requestedAt) }}</p>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </Card>
</template>
