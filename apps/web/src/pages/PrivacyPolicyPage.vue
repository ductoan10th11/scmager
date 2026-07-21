<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/shared/api/http'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ShieldCheck,
  ArrowLeft,
  Clock,
  FileText,
  Lock,
  Server,
  KeyRound,
  Mail,
  Loader2,
  CheckCircle2
} from 'lucide-vue-next'

const router = useRouter()
const loading = ref(true)
const error = ref(null)
const policyData = ref({
  title: 'Chính sách quyền riêng tư — eWork Assistant',
  effectiveDate: '20/07/2026',
  content: ''
})

const fetchPrivacyPolicy = async () => {
  loading.value = true
  error.value = null
  try {
    const response = await http('/api/policy/privacy')
    if (response?.data) {
      policyData.value = response.data
    }
  } catch (err) {
    console.error('Failed to load privacy policy:', err)
    error.value = err.message || 'Không thể tải chính sách quyền riêng tư.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchPrivacyPolicy()
})

// Parse markdown sections for rich layout rendering
const parsedSections = computed(() => {
  if (!policyData.value.content) return []
  const text = policyData.value.content
  const rawSections = text.split(/^##\s+/m)
  
  const result = []
  
  for (let i = 0; i < rawSections.length; i++) {
    const block = rawSections[i].trim()
    if (!block) continue
    
    // First block might contain main # H1 title and meta line
    if (i === 0 && block.startsWith('#')) {
      continue
    }
    
    const lines = block.split('\n')
    const sectionTitle = lines[0].trim()
    const sectionBody = lines.slice(1).join('\n').trim()
    
    let icon = FileText
    if (sectionTitle.includes('Dữ liệu')) icon = Lock
    else if (sectionTitle.includes('Dịch vụ')) icon = Server
    else if (sectionTitle.includes('Quyền')) icon = KeyRound
    else if (sectionTitle.includes('Liên hệ')) icon = Mail
    
    result.push({
      title: sectionTitle,
      body: sectionBody,
      icon
    })
  }
  
  return result
})
</script>

<template>
  <div class="min-h-screen bg-slate-50 dark:bg-zinc-950 text-slate-900 dark:text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
    <div class="max-w-4xl mx-auto space-y-6">
      
      <!-- Top Navigation Bar -->
      <div class="flex items-center justify-between pb-2">
        <Button
          variant="default"
          size="sm"
          class="rounded-full gap-2 cursor-pointer bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-500 font-medium shadow-sm px-4"
          @click="router.back()"
        >
          <ArrowLeft class="w-4 h-4" />
          <span>Quay lại</span>
        </Button>

        <Badge variant="secondary" class="rounded-full px-3 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
          <CheckCircle2 class="w-3.5 h-3.5" />
          <span>Chính thức</span>
        </Badge>
      </div>

      <!-- Main Card Header -->
      <Card class="border-slate-200 dark:border-zinc-800 shadow-sm rounded-2xl overflow-hidden bg-white dark:bg-zinc-900">
        <CardHeader class="border-b border-slate-100 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/50 p-6 sm:p-8">
          <div class="flex items-start gap-4">
            <div class="p-3 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-2xl border border-blue-100 dark:border-blue-900/50 shrink-0">
              <ShieldCheck class="w-8 h-8" />
            </div>
            <div class="space-y-1.5">
              <CardTitle class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                {{ policyData.title }}
              </CardTitle>
              <CardDescription class="text-slate-500 dark:text-slate-400 flex items-center gap-2 text-sm">
                <Clock class="w-4 h-4" />
                <span>Ngày hiệu lực: {{ policyData.effectiveDate }}</span>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent class="p-6 sm:p-8 space-y-8">
          <!-- Loading State -->
          <div v-if="loading" class="py-12 flex flex-col items-center justify-center space-y-3 text-slate-500">
            <Loader2 class="w-8 h-8 animate-spin text-blue-600" />
            <p class="text-sm font-medium">Đang tải nội dung chính sách...</p>
          </div>

          <!-- Error State -->
          <div v-else-if="error" class="py-8 text-center space-y-3">
            <p class="text-rose-600 font-medium">{{ error }}</p>
            <Button variant="outline" class="rounded-full" @click="fetchPrivacyPolicy">Thử lại</Button>
          </div>

          <!-- Content State -->
          <div v-else class="space-y-8">
            <div v-for="(section, idx) in parsedSections" :key="idx" class="space-y-3">
              <div class="flex items-center gap-2.5 text-lg font-semibold text-slate-800 dark:text-slate-100">
                <component :is="section.icon" class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <h3>{{ section.title }}</h3>
              </div>
              <div class="pl-7 text-slate-600 dark:text-slate-300 leading-relaxed text-sm sm:text-base whitespace-pre-line space-y-2">
                {{ section.body }}
              </div>
              <Separator v-if="idx < parsedSections.length - 1" class="mt-6 border-slate-100 dark:border-zinc-800" />
            </div>

            <!-- Fallback raw content display if parsing yielded no sections -->
            <div v-if="parsedSections.length === 0" class="whitespace-pre-line text-slate-700 dark:text-slate-300 leading-relaxed">
              {{ policyData.content }}
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Footer Info -->
      <div class="text-center text-xs text-slate-400 dark:text-zinc-500 pt-4">
        &copy; 2026 eWork Assistant. Bảo lưu mọi quyền.
      </div>
    </div>
  </div>
</template>
