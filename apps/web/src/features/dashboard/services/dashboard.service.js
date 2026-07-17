import { http } from '@/shared/api/http'

export const DashboardService = {
  async getTaskSummary() {
    const response = await http('/api/dashboard/summary')
    return response?.data?.tasks ?? {
      total: 0,
      todo: 0,
      inProgress: 0,
      pendingReview: 0,
      done: 0,
      overdue: 0,
    }
  },

  async getSummary() {
    return http('/api/dashboard/summary')
  },

  async getWorkload() {
    return http('/api/dashboard/workload')
  },

  async getDeadlines() {
    return http('/api/dashboard/deadlines')
  },
}
