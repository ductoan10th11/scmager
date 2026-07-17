import { http } from '@/shared/api/http'

export const PerformanceService = {
  overview() {
    return http('/api/performance/overview')
  },
}
