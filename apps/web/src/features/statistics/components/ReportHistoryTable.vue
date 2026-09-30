<script setup>
import { ref, computed } from 'vue'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  FileText, 
  Calendar, 
  User, 
  Search, 
  Download, 
  Eye, 
  CheckCircle2, 
  Layers 
} from 'lucide-vue-next'

const props = defineProps({
  reports: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['viewReport'])

const searchQuery = ref('')
const selectedCategory = ref('ALL')

const filteredReports = computed(() => {
  return props.reports.filter((r) => {
    const matchCat = selectedCategory.value === 'ALL' || r.category === selectedCategory.value
    const matchSearch = !searchQuery.value ||
      r.title?.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      r.fileName?.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      r.code?.toLowerCase().includes(searchQuery.value.toLowerCase())
    return matchCat && matchSearch
  })
})

const getCategoryBadge = (cat) => {
  switch (cat) {
    case 'CHUNG': return { label: 'Toàn xã', class: 'bg-sky-50 text-sky-700 border-sky-200' }
    case 'DANG_UY': return { label: 'Đảng ủy', class: 'bg-rose-50 text-rose-700 border-rose-200' }
    case 'UBND': return { label: 'UBND', class: 'bg-blue-50 text-blue-700 border-blue-200' }
    case 'MTTQ': return { label: 'MTTQ', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    default: return { label: 'Tổng hợp', class: 'bg-slate-50 text-slate-700 border-slate-200' }
  }
}
</script>

<template>
  <div class="w-full min-w-0 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
    <!-- Header & Bộ lọc -->
    <div class="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h3 class="text-sm sm:text-base font-bold text-slate-900 leading-tight flex items-center gap-2">
          <FileText :size="17" class="text-blue-600" />
          <span>Kho lưu trữ tài liệu & Báo cáo số hóa</span>
          <Badge variant="outline" class="rounded-full text-xs bg-blue-50 border-blue-200 text-blue-700 font-semibold">
            {{ filteredReports.length }} báo cáo
          </Badge>
        </h3>
        <p class="text-xs text-slate-500 mt-0.5">
          Danh mục các văn bản báo cáo kinh tế - xã hội, công tác Đảng, chính quyền đã nạp vào hệ thống.
        </p>
      </div>

      <!-- Controls: Tìm kiếm & Khối -->
      <div class="flex items-center gap-2">
        <div class="relative w-48 sm:w-56">
          <Search :size="13" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            v-model="searchQuery"
            placeholder="Tìm tên, số hiệu tệp..."
            class="h-8 pl-8 text-xs rounded-full border-slate-200"
          />
        </div>

        <select
          v-model="selectedCategory"
          class="text-xs h-8 rounded-full border border-slate-200 bg-white px-3 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="ALL">Tất cả khối</option>
          <option value="DANG_UY">Đảng ủy</option>
          <option value="UBND">UBND</option>
          <option value="MTTQ">MTTQ</option>
        </select>
      </div>
    </div>

    <!-- Danh sách báo cáo -->
    <div class="w-full min-w-0 overflow-x-auto">
      <Table class="w-full min-w-[720px] text-xs">
        <TableHeader class="bg-slate-50 border-b border-slate-200 text-slate-700">
          <TableRow>
            <TableHead class="font-bold pl-4">Văn bản / Tệp đính kèm</TableHead>
            <TableHead class="w-28 font-bold">Khối</TableHead>
            <TableHead class="w-28 font-bold">Kỳ báo cáo</TableHead>
            <TableHead class="w-40 font-bold">Cán bộ / Đơn vị nạp</TableHead>
            <TableHead class="w-32 font-bold font-mono">Thời gian</TableHead>
            <TableHead class="w-24 text-center font-bold">Số chỉ tiêu</TableHead>
            <TableHead class="w-24 text-center font-bold pr-4">Thao tác</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          <TableRow
            v-for="rep in filteredReports"
            :key="rep.id"
            class="hover:bg-blue-50/30 border-b border-slate-100 transition-colors"
          >
            <!-- Tên tài liệu -->
            <TableCell class="pl-4 py-3">
              <div class="flex items-start gap-2.5">
                <div class="h-8 w-8 rounded-lg bg-blue-100/70 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
                  <FileText :size="16" />
                </div>
                <div>
                  <div class="font-semibold text-slate-900 leading-snug">
                    {{ rep.title }}
                  </div>
                  <div class="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                    <span v-if="rep.code" class="text-blue-600 font-semibold font-mono">{{ rep.code }}</span>
                    <span>•</span>
                    <span>{{ rep.fileName }}</span>
                    <span>({{ rep.fileSize }})</span>
                  </div>
                </div>
              </div>
            </TableCell>

            <!-- Khối -->
            <TableCell>
              <span
                class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold border"
                :class="getCategoryBadge(rep.category).class"
              >
                {{ getCategoryBadge(rep.category).label }}
              </span>
            </TableCell>

            <!-- Kỳ báo cáo -->
            <TableCell class="text-slate-600 font-medium">
              <div class="flex items-center gap-1">
                <Calendar :size="11" class="text-slate-400" />
                <span>{{ rep.period }}</span>
              </div>
            </TableCell>

            <!-- Người nạp -->
            <TableCell class="text-slate-600">
              <div class="flex items-center gap-1">
                <User :size="11" class="text-slate-400" />
                <span class="truncate max-w-[130px]">{{ rep.uploadedBy }}</span>
              </div>
            </TableCell>

            <!-- Thời gian -->
            <TableCell class="text-slate-400 font-mono text-[11px]">
              {{ rep.uploadedAt }}
            </TableCell>

            <!-- Số lượng chỉ tiêu -->
            <TableCell class="text-center">
              <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 tabular-nums">
                {{ rep.extractedCount }} chỉ tiêu
              </span>
            </TableCell>

            <!-- Thao tác -->
            <TableCell class="text-center pr-4">
              <div class="flex items-center justify-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                  title="Xem chỉ tiêu trích xuất"
                  @click="$emit('viewReport', rep)"
                >
                  <Eye :size="13" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                  title="Tải tệp gốc"
                >
                  <Download :size="13" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="filteredReports.length === 0">
            <TableCell colspan="7" class="h-28 text-center text-xs text-slate-400">
              Không tìm thấy tài liệu phù hợp.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
