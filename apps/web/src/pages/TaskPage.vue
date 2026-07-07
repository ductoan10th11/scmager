<script setup>
import { ref, computed } from 'vue'
import { Plus, MoreHorizontal, MessageSquare, Paperclip, Calendar, Clock, CheckCircle2, Circle, AlertCircle, Filter, Search, List, LayoutGrid, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { globalMockDocuments } from '@/mocks/document'
import TaskAssignmentModal from '@/components/features/TaskAssignmentModal.vue'

const activeTab = ref('todo')
const isTaskModalOpen = ref(false)

const handleCreateTask = (taskData) => {
  // Thêm task mới vào dữ liệu giả (hiển thị vào ngày hiện tại đang xem)
  const newTask = {
    _id: { $oid: 'new-' + Math.random().toString(36).substr(2, 9) },
    title: taskData.title,
    description: taskData.description,
    status: 'todo',
    priority: taskData.category === 'deadline' ? 'high' : 'medium',
    assignee: {
      id: taskData.assignee,
      name: 'Chuyên viên',
      avatar: 'https://i.pravatar.cc/150?img=11'
    },
    startTime: { $date: currentDate.value.toISOString() },
    endTime: { $date: new Date(currentDate.value.getTime() + (taskData.estimatedHours || 1) * 3600000).toISOString() },
    tags: [taskData.category],
    attachments: 0,
    comments: 0,
    isOverload: (taskData.estimatedHours || 0) > 3 // Giả định cộng dồn > 8h sẽ overload, mock >3h overload cho demo
  }
  globalMockDocuments.value.unshift(newTask)
}

// Date Management: Default to today, allowing it to navigate the 300 documents across July 2026
const currentDate = ref(new Date())

const formattedDate = computed(() => {
  const day = String(currentDate.value.getDate()).padStart(2, '0')
  const month = String(currentDate.value.getMonth() + 1).padStart(2, '0')
  const year = currentDate.value.getFullYear()
  return `${day}/${month}/${year}`
})

const columns = computed(() => {
  // Format the current date strictly to YYYY-MM-DD
  const tYear = currentDate.value.getFullYear();
  const tMonth = String(currentDate.value.getMonth() + 1).padStart(2, '0');
  const tDay = String(currentDate.value.getDate()).padStart(2, '0');
  
  // Lọc lấy danh sách văn bản ĐÚNG cho ngày đang chọn
  const dailyDocs = globalMockDocuments.value.filter(d => {
    if (!d.startTime || !d.startTime.$date) return false;
    const dDate = new Date(d.startTime.$date);
    return dDate.getFullYear() === tYear && 
           (dDate.getMonth() + 1) === (currentDate.value.getMonth() + 1) && 
           dDate.getDate() === currentDate.value.getDate();
  });
  
  // Define time display helper
  const getTimeDisplay = (isoDateStr) => {
    const d = new Date(isoDateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const today = new Date();
  const getRelativeDate = (isoDateStr) => {
    const d = new Date(isoDateStr);
    const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    const isTomorrow = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate() + 1;
    const isYesterday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate() - 1;
    if (isToday) return 'Hôm nay';
    if (isTomorrow) return 'Ngày mai';
    if (isYesterday) return 'Hôm qua';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  // Transform to the UI schema
  const mapDoc = (doc) => ({
    id: doc._id.$oid,
    title: doc.title,
    desc: doc.description,
    tags: doc.tags,
    date: getRelativeDate(doc.startTime.$date),
    time: getTimeDisplay(doc.startTime.$date),
    comments: doc.comments,
    attachments: doc.attachments,
    avatar: doc.assignee.avatar,
    priority: doc.priority,
    isOverload: doc.isOverload
  });

  const tasksTodo = dailyDocs.filter(d => d.status === 'todo').map(mapDoc);
  const tasksInProgress = dailyDocs.filter(d => d.status === 'in-progress').map(mapDoc);
  const tasksReview = dailyDocs.filter(d => d.status === 'review').map(mapDoc);
  const tasksDone = dailyDocs.filter(d => d.status === 'done').map(mapDoc);
  
  return [
    { id: 'todo', title: 'Cần làm', count: tasksTodo.length, color: 'bg-zinc-100 text-zinc-600', tasks: tasksTodo },
    { id: 'in-progress', title: 'Đang xử lý', count: tasksInProgress.length, color: 'bg-sky-100 text-sky-700', tasks: tasksInProgress },
    { id: 'review', title: 'Chờ thẩm định', count: tasksReview.length, color: 'bg-amber-100 text-amber-700', tasks: tasksReview },
    { id: 'done', title: 'Hoàn thành', count: tasksDone.length, color: 'bg-emerald-100 text-emerald-700', tasks: tasksDone }
  ];
})

const previousDay = () => {
  const d = new Date(currentDate.value)
  d.setDate(d.getDate() - 1)
  currentDate.value = d
}

const nextDay = () => {
  const d = new Date(currentDate.value)
  d.setDate(d.getDate() + 1)
  currentDate.value = d
}
</script>

<template>
  <div class="h-full flex flex-col bg-zinc-50/50 relative overflow-hidden min-w-0">
    <!-- Header with Glassmorphism -->
    <header class="px-6 md:px-10 pt-8 pb-6 shrink-0 flex flex-col md:flex-row md:items-end justify-between gap-4 sticky top-0 z-20 bg-white/70 backdrop-blur-2xl border-b border-zinc-200/50">
      <div class="space-y-1.5">
        <h1 class="text-3xl font-extrabold tracking-normal text-zinc-900 drop-shadow-sm text-left">Nhiệm vụ</h1>
        <p class="text-sm font-medium text-zinc-500 text-left">Quản lý, phân công và thẩm định công việc toàn cơ quan.</p>
      </div>
    </header>

    <!-- Tabs Layout -->
    <Tabs v-model="activeTab" class="flex-1 flex flex-col h-full overflow-hidden min-h-0">
      
      <!-- Tab Triggers Area -->
      <div class="px-6 md:px-10 py-3 bg-white/80 backdrop-blur-md shrink-0 border-b border-zinc-200/60 flex items-center justify-between gap-2 overflow-hidden">
        
        <div class="flex items-center gap-2 overflow-hidden">
          <!-- Search / Filter Box -->
          <div class="flex items-center bg-zinc-100/80 rounded-full p-1 h-9 md:h-10 shrink-0 transition-[width] focus-within:bg-zinc-100 focus-within:ring-2 focus-within:ring-zinc-200 w-24 md:w-32 focus-within:!w-48 lg:w-40 lg:focus-within:!w-56 duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden group">
            <div class="bg-white rounded-full h-full aspect-square flex items-center justify-center shadow-sm shrink-0">
              <Search class="w-3.5 h-3.5 text-zinc-600" />
            </div>
            <input type="text" placeholder="Tìm kiếm..." class="bg-transparent border-none outline-none text-xs w-full px-2.5 text-zinc-700 placeholder:text-zinc-500 font-medium" />
          </div>

          <!-- Date Selector -->
          <div class="flex items-center justify-between bg-zinc-100/80 rounded-full h-9 md:h-10 px-2 shrink-0 text-xs md:text-sm font-bold text-zinc-900 gap-1 md:gap-2 w-36 md:w-40">
            <button @click="previousDay" class="text-zinc-400 hover:text-zinc-900 transition-colors flex items-center justify-center h-full px-1.5">
              <ChevronLeft class="w-4 h-4" />
            </button>
            <span class="tabular-nums tracking-tight">{{ formattedDate }}</span>
            <button @click="nextDay" class="text-zinc-400 hover:text-zinc-900 transition-colors flex items-center justify-center h-full px-1.5">
              <ChevronRight class="w-4 h-4" />
            </button>
          </div>

          <!-- Segmented Tabs -->
          <TabsList class="relative grid grid-cols-4 h-9 md:h-10 items-center justify-center rounded-full bg-zinc-100/80 p-1 text-zinc-500 shrink-0 overflow-hidden isolate select-none min-w-[360px] md:min-w-[420px] shadow-inner">
            <div class="absolute left-1 top-1 bottom-1 w-[calc(25%-2px)] bg-white shadow-[0_4px_12px_-4px_rgba(0,0,0,0.1)] ring-1 ring-zinc-900/5 rounded-full z-0 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] pointer-events-none"
                 :style="{ transform: `translateX(${columns.findIndex(c => c.id === activeTab) * 100}%)` }"></div>
            <TabsTrigger 
              v-for="col in columns" 
              :key="col.id" 
              :value="col.id"
              class="relative z-10 inline-flex h-full items-center justify-center whitespace-nowrap rounded-full px-1.5 md:px-3 text-[11px] md:text-xs font-semibold transition-colors duration-200 data-[state=active]:text-zinc-950 text-zinc-500 hover:text-zinc-700 bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none border-0"
            >
              {{ col.title }}
              <span class="ml-1.5 md:ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors duration-300" :class="activeTab === col.id ? col.color : 'bg-zinc-200/60 text-zinc-500'">{{ col.count }}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <!-- View Switcher -->
        <div class="flex items-center bg-zinc-100/80 rounded-full p-1 h-9 md:h-10 shrink-0 hidden lg:flex">
          <button class="h-full aspect-square flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-700 transition-colors w-10">
            <List class="w-4 h-4" />
          </button>
          <button class="h-full aspect-square flex items-center justify-center rounded-full bg-white shadow-[0_4px_12px_-4px_rgba(0,0,0,0.1)] text-zinc-900 transition-colors w-10">
            <LayoutGrid class="w-4 h-4" />
          </button>
        </div>

      </div>

      <!-- Tab Content Area -->
      <div class="flex-1 overflow-y-auto p-6 md:p-10 hide-scrollbar bg-zinc-50/50">
        <TabsContent v-for="col in columns" :key="col.id" :value="col.id" class="m-0 border-0 outline-none h-full">
          
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-zinc-900 text-left">Danh sách: {{ col.title }}</h2>
          </div>

          <!-- Task Grid -->
          <div :key="'grid-' + col.id + '-' + currentDate.getTime()" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 content-start animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            
            <!-- Add Task Card (First item in grid) -->
            <div @click="isTaskModalOpen = true" class="flex flex-col items-center justify-center p-6 bg-white/40 border border-dashed border-zinc-200/80 rounded-3xl cursor-pointer hover:border-zinc-300 hover:bg-white/80 transition-all duration-300 min-h-[220px] group">
              <div class="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400 group-hover:text-zinc-600 group-hover:bg-zinc-200 transition-colors mb-3">
                <Plus class="w-6 h-6" />
              </div>
              <h3 class="text-sm font-bold text-zinc-700">Tạo công việc mới</h3>
              <p class="text-xs font-medium text-zinc-500 mt-1">Giao việc cho thành viên</p>
            </div>

            <!-- Task Card -->
            <div v-for="task in col.tasks" :key="task.id" 
                 class="group rounded-[32px] p-6 shadow-sm hover:shadow-xl border-[1px] cursor-pointer relative flex flex-col gap-4 min-h-[220px] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1.5"
                 :class="{
                   'bg-rose-50/50 border-rose-200/60 hover:border-rose-300': task.priority === 'high',
                   'bg-amber-50/50 border-amber-200/60 hover:border-amber-300': task.priority === 'medium',
                   'bg-emerald-50/50 border-emerald-200/60 hover:border-emerald-300': task.priority === 'low',
                   'bg-white border-zinc-200/50 hover:border-zinc-300': !task.priority
                 }"
            >
              <div class="flex items-start justify-between gap-2 w-full">
                <div class="flex flex-wrap gap-1.5 flex-1 pr-2">
                  <Badge v-for="tag in task.tags" :key="tag" variant="secondary" 
                         class="text-xs capitalize font-semibold px-2.5 py-1 border-0"
                         :class="{
                           'bg-rose-100/70 text-rose-700 hover:bg-rose-200/80': task.priority === 'high',
                           'bg-amber-100/70 text-amber-700 hover:bg-amber-200/80': task.priority === 'medium',
                           'bg-emerald-100/70 text-emerald-700 hover:bg-emerald-200/80': task.priority === 'low',
                           'bg-zinc-100 text-zinc-600 hover:bg-zinc-200': !task.priority
                         }">
                    {{ tag }}
                  </Badge>
                </div>
                <button class="text-zinc-400 hover:text-zinc-600 !cursor-pointer shrink-0 mt-0.5">
                  <MoreHorizontal class="w-5 h-5" />
                </button>
              </div>

              <div class="flex-1 mt-1">
                <h3 class="text-[18px] font-extrabold text-zinc-900 leading-snug text-left line-clamp-2">{{ task.title }}</h3>
                <div v-if="task.isOverload" class="mt-3 bg-rose-50/50 border border-rose-200/60 rounded-xl p-2.5 flex items-start gap-2">
                  <AlertCircle class="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <p class="text-[13px] font-bold text-rose-600 leading-snug">{{ task.desc }}</p>
                </div>
                <p v-else class="text-[14px] leading-relaxed mt-2.5 text-left line-clamp-2 font-medium"
                   :class="{
                     'text-rose-700/90': task.priority === 'high',
                     'text-amber-800/90': task.priority === 'medium',
                     'text-emerald-800/90': task.priority === 'low',
                     'text-zinc-500': !task.priority
                   }">
                  {{ task.desc }}
                </p>
              </div>

              <!-- Separator Line -->
              <div class="w-full h-[1px] bg-gradient-to-r from-transparent via-zinc-200 to-transparent mt-auto mb-3"></div>

              <div class="flex items-center justify-between gap-2 overflow-hidden">
                <!-- Left: Date/Time Pill -->
                <div class="flex items-center shrink-0">
                  <div class="flex items-center gap-1.5 md:gap-2 text-[11px] md:text-xs font-bold bg-white/80 backdrop-blur-sm px-2.5 md:px-3 py-1.5 rounded-[12px] shadow-sm text-zinc-700 whitespace-nowrap">
                    <Calendar class="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    <div class="flex items-center gap-1 md:gap-1.5">
                      <span>{{ task.date }}</span>
                      <span v-if="task.time" class="text-zinc-300 font-black">•</span>
                      <span v-if="task.time" class="text-zinc-500">{{ task.time }}</span>
                    </div>
                  </div>
                </div>
                
                <!-- Right: Stats and Avatar -->
                <div class="flex items-center gap-2 md:gap-3 shrink-0">
                  <div v-if="task.comments > 0" class="flex items-center gap-1 text-[12px] md:text-[13px] font-bold text-zinc-400 whitespace-nowrap hidden sm:flex">
                    <MessageSquare class="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span>{{ task.comments }}</span>
                  </div>
                  <div v-if="task.attachments > 0" class="flex items-center gap-1 text-[12px] md:text-[13px] font-bold text-zinc-400 whitespace-nowrap">
                    <Paperclip class="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span>{{ task.attachments }}</span>
                  </div>
                  
                  <Avatar class="w-7 h-7 md:w-8 md:h-8 border border-white/60 shadow-sm ring-1 ring-black/5 shrink-0 ml-0.5">
                    <AvatarImage :src="task.avatar" />
                    <AvatarFallback>U</AvatarFallback>
                  </Avatar>
                </div>
              </div>
            </div>

          </div>
        </TabsContent>
      </div>
    </Tabs>

    <!-- Task Assignment Modal -->
    <TaskAssignmentModal 
      v-model:open="isTaskModalOpen" 
      @submit="handleCreateTask" 
    />
  </div>
</template>

<style scoped>
.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
