import { http } from '@/shared/api/http'

export const PerformanceService = {
  overview(period) {
    const query = period ? `?period=${encodeURIComponent(period)}` : ''
    return http(`/api/performance/overview${query}`)
  },
}
