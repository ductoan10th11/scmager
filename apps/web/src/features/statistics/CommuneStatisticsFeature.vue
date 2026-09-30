<script setup>
import { ref, onMounted, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { 
  UploadCloud, 
  RefreshCw,
  CheckCircle2
} from 'lucide-vue-next'
import { CommuneStatService } from './services/commune-stat.service'
import StatMetricCards from './components/StatMetricCards.vue'
import MetricExtractionTable from './components/MetricExtractionTable.vue'
import ReportUploadDialog from './components/ReportUploadDialog.vue'
import ReportHistoryTable from './components/ReportHistoryTable.vue'

const isLoading = ref(true)
const isSubmitting = ref(false)
const isUploadOpen = ref(false)
const activeTab = ref('overview')
const toastMessage = ref(null)

const overviewData = ref({
  communeName: 'Xã Thiện Tân',
  year: 2026,
  totalMetrics: 8,
  confirmedMetrics: 7,
  pendingMetrics: 1,
  avgCompletionRate: 99,
  metrics: [],
  recentReports: [],
})

const lastExtractedReport = ref(null)

const metrics = computed(() => overviewData.value.metrics || [])
const reports = computed(() => overviewData.value.recentReports || [])

const loadData = async () => {
  isLoading.value = true
  try {
    const data = await CommuneStatService.getOverview()
    overviewData.value = data
  } catch (error) {
    console.error('Lỗi tải dữ liệu thống kê xã:', error)
  } finally {
    isLoading.value = false
  }
}

const showToast = (message) => {
  toastMessage.value = message
  setTimeout(() => {
    toastMessage.value = null
  }, 3500)
}

const handleExtracted = (result) => {
  if (result.extractedMetrics && result.extractedMetrics.length > 0) {
    overviewData.value.metrics = [...result.extractedMetrics, ...overviewData.value.metrics]
    overviewData.value.totalMetrics = overviewData.value.metrics.length
    lastExtractedReport.value = result.report

    activeTab.value = 'extract'
    showToast(`Đã trích xuất ${result.extractedMetrics.length} chỉ tiêu từ báo cáo.`)
  }
}

const handleReportSaved = async (data) => {
  showToast(`Đã ghi nhận thành công ${data?.metricsCount || 'các'} chỉ tiêu từ báo cáo vào CSDL!`)
  await loadData()
}

const handleToggleStatus = async (metricId, isConfirmed) => {
  await CommuneStatService.toggleMetricStatus(metricId, isConfirmed)
  const target = overviewData.value.metrics.find((m) => m.id === metricId)
  if (target) {
    target.isConfirmed = isConfirmed
  }
  overviewData.value.confirmedMetrics = overviewData.value.metrics.filter((m) => m.isConfirmed).length
  overviewData.value.pendingMetrics = overviewData.value.metrics.length - overviewData.value.confirmedMetrics
}

const handleCommitAll = async () => {
  isSubmitting.value = true
  try {
    const confirmed = overviewData.value.metrics.filter((m) => m.isConfirmed)
    await CommuneStatService.commitMetrics(confirmed, lastExtractedReport.value)
    
    showToast('Đã ghi nhận dữ liệu vào CSDL số hóa Xã Thiện Tân.')
    lastExtractedReport.value = null
    await loadData()
    activeTab.value = 'overview'
  } catch (error) {
    console.error('Lỗi ghi nhận chỉ tiêu:', error)
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="w-full min-w-0 space-y-4 max-w-7xl mx-auto">
    <!-- Toast notification tinh gọn phong cách xanh dương -->
    <transition
      enter-active-class="transform ease-out duration-200 transition"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="toastMessage"
        class="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 flex items-center gap-2.5 bg-blue-900 text-white border border-blue-800 px-3.5 py-2.5 rounded-xl shadow-lg shadow-blue-950/20 text-xs font-medium max-w-sm ml-auto"
      >
        <CheckCircle2 :size="15" class="text-blue-300 shrink-0" />
        <span>{{ toastMessage }}</span>
      </div>
    </transition>

    <!-- Header Tiêu đề: Phong cách hành chính công thân thiện Trắng - Xanh dương -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-blue-100">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
            Số liệu thống kê Xã Thiện Tân
          </h1>
          <span class="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            Năm 2026
          </span>
        </div>
        <p class="text-xs text-slate-500 mt-0.5">
          Theo dõi và số hóa các chỉ tiêu phát triển kinh tế - xã hội địa phương.
        </p>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
        <Button
          type="button"
          variant="outline"
          class="rounded-full text-xs h-8 px-3 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800 font-medium"
          :disabled="isLoading"
          @click="loadData"
        >
          <RefreshCw :size="12" :class="isLoading ? 'animate-spin' : ''" class="mr-1.5 text-blue-600" />
          Làm mới
        </Button>

        <Button
          type="button"
          class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3.5 font-medium shadow-xs"
          @click="isUploadOpen = true"
        >
          <UploadCloud :size="13" class="mr-1.5" />
          Tải lên báo cáo
        </Button>
      </div>
    </div>

    <!-- Tabs điều hướng: Cố định width, responsive mượt, tông màu Trắng - Xanh dương -->
    <Tabs v-model="activeTab" class="w-full min-w-0 space-y-3.5">
      <div class="w-full overflow-x-auto no-scrollbar -mx-1 px-1">
        <TabsList class="bg-blue-50/80 p-1 rounded-full inline-flex border border-blue-100 h-9">
          <TabsTrigger
            value="overview"
            class="rounded-full text-xs font-semibold px-3.5 sm:px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs text-slate-600 transition-all whitespace-nowrap"
          >
            Tổng quan chỉ tiêu
          </TabsTrigger>
          <TabsTrigger
            value="extract"
            class="rounded-full text-xs font-semibold px-3.5 sm:px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs text-slate-600 transition-all whitespace-nowrap"
          >
            Bóc tách & Ghi nhận
          </TabsTrigger>
          <TabsTrigger
            value="history"
            class="rounded-full text-xs font-semibold px-3.5 sm:px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs text-slate-600 transition-all whitespace-nowrap"
          >
            Lịch sử báo cáo
          </TabsTrigger>
        </TabsList>
      </div>

      <!-- Tab 1: Tổng quan chỉ tiêu (đảm bảo w-full min-w-0) -->
      <TabsContent value="overview" class="w-full min-w-0 space-y-4 focus-visible:outline-none">
        <StatMetricCards :metrics="metrics" :summary="overviewData" />
        <MetricExtractionTable
          :metrics="metrics"
          :is-submitting="isSubmitting"
          @toggle-status="handleToggleStatus"
          @commit-all="handleCommitAll"
        />
      </TabsContent>

      <!-- Tab 2: Bóc tách & Ghi nhận (đảm bảo w-full min-w-0) -->
      <TabsContent value="extract" class="w-full min-w-0 space-y-3.5 focus-visible:outline-none">
        <div v-if="lastExtractedReport" class="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="text-xs text-slate-700">
            <strong class="text-blue-900 font-semibold">Báo cáo vừa tải lên:</strong> {{ lastExtractedReport.title }} ({{ lastExtractedReport.period }})
          </div>
          <Button
            type="button"
            class="rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-7 px-3.5 shrink-0 self-start sm:self-auto font-medium shadow-xs"
            :disabled="isSubmitting"
            @click="handleCommitAll"
          >
            Ghi nhận toàn bộ
          </Button>
        </div>

        <MetricExtractionTable
          :metrics="metrics"
          :is-submitting="isSubmitting"
          @toggle-status="handleToggleStatus"
          @commit-all="handleCommitAll"
        />
      </TabsContent>

      <!-- Tab 3: Lịch sử báo cáo (đảm bảo w-full min-w-0) -->
      <TabsContent value="history" class="w-full min-w-0 focus-visible:outline-none">
        <ReportHistoryTable :reports="reports" />
      </TabsContent>
    </Tabs>

    <!-- Modal tải lên báo cáo -->
    <ReportUploadDialog
      v-model:open="isUploadOpen"
      @saved="handleReportSaved"
      @extracted="handleExtracted"
    />
  </div>
</template>
