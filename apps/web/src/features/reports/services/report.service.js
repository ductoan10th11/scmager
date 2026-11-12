import { http } from '@/shared/api/http'

const buildQuery = (filters) => {
  const params = new URLSearchParams()
  if (filters.departmentId) params.set('departmentId', filters.departmentId)
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.deadlineStatus) params.set('deadlineStatus', filters.deadlineStatus)
  if (filters.pageType) params.set('pageType', filters.pageType)
  if (filters.slaHours !== undefined && filters.slaHours !== null) params.set('slaHours', filters.slaHours)
  if (filters.filterType) params.set('filterType', filters.filterType)
  if (filters.search) params.set('search', filters.search)
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder)
  return params
}

export const ReportService = {
  overdue(filters) {
    return http(`/api/reports/overdue?${buildQuery(filters).toString()}`)
  },
  async downloadOverdueReport(filters) {
    const response = await fetch(`/api/reports/overdue/export?${buildQuery(filters).toString()}`, { credentials: 'include' })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error?.message || payload?.message || 'Không thể tạo báo cáo.')
    }
    const disposition = response.headers.get('content-disposition') || ''
    const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    return {
      blob: await response.blob(),
      filename: encodedFileName ? decodeURIComponent(encodedFileName) : 'bao-cao-qua-han.xlsx',
    }
  },
  lateAssignments(filters) {
    return http(`/api/reports/late-assignments?${buildQuery(filters).toString()}`)
  },
  async downloadLateAssignmentsReport(filters) {
    const response = await fetch(`/api/reports/late-assignments/export?${buildQuery(filters).toString()}`, { credentials: 'include' })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error?.message || payload?.message || 'Không thể tải báo cáo giao việc muộn.')
    }
    const disposition = response.headers.get('content-disposition') || ''
    const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    return {
      blob: await response.blob(),
      filename: encodedFileName ? decodeURIComponent(encodedFileName) : 'bao-cao-giao-viec-muon.xlsx',
    }
  },
}
