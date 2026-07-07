import { ref } from 'vue';
import rawUnified from './raw_unified.json';

const colors = [
  { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-900', shadow: 'shadow-[inset_2px_0_0_0_#ef4444]', dot: 'bg-red-500' },
  { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-900', shadow: 'shadow-[inset_2px_0_0_0_#3b82f6]', dot: 'bg-blue-500' },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-900', shadow: 'shadow-[inset_2px_0_0_0_#10b981]', dot: 'bg-emerald-500' },
  { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-900', shadow: 'shadow-[inset_2px_0_0_0_#f59e0b]', dot: 'bg-amber-500' },
  { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-900', shadow: 'shadow-[inset_2px_0_0_0_#a855f7]', dot: 'bg-purple-500' }
];

// Lấy dữ liệu 100% từ JSON cứng tĩnh của Mongo, CÙNG BỘ DATA VỚI TASK
const processedSchedules = rawUnified.map((schedule, idx) => {
  const c = colors[idx % colors.length];
  const start = new Date(schedule.startTime.$date);
  const end = new Date(schedule.endTime.$date);
  
  const startHour = start.getHours();
  const startHourFloat = start.getHours() + start.getMinutes() / 60;
  const durationInHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  
  const dateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(startHour).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')} - ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  
  return {
    _id: schedule._id.$oid,
    title: schedule.title,
    type: schedule.type,
    description: schedule.description,
    startTime: schedule.startTime.$date,
    endTime: schedule.endTime.$date,
    location: schedule.location,
    organizer: schedule.reporter.fullName,
    createdAt: schedule.createdAt.$date,
    
    // UI Helpers
    dateStr: dateStr,
    startHour: startHourFloat,
    duration: durationInHours,
    timeStr: timeStr,
    time: timeStr,
    assignee: schedule.assignee,
    colorClass: `${c.bg} ${c.border} ${c.text} ${c.shadow}`,
    color: c.dot,
    avatars: [
      { id: schedule.assignee._id.$oid, url: schedule.assignee.avatar },
      { id: schedule.reporter._id.$oid, url: schedule.reporter.avatar }
    ],
    remainingCount: schedule.comments || 0
  };
});

export const globalMockEvents = ref(processedSchedules);
