import { ScheduleService } from '@/features/schedule/services/schedule.service'
import { http } from '@/shared/api/http'

export const DashboardService = {
  async getTodayEvents() {
    return ScheduleService.listEvents()
  },

  async getTaskSummary() {
    const response = await http('/api/tasks?limit=1')
    return response?.summary ?? {
      total: 0,
      todo: 0,
      inProgress: 0,
      pendingReview: 0,
      done: 0,
      overdue: 0,
    }
  },
}
