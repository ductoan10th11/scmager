import { http } from '@/shared/api/http'

export const PerformanceService = {
  overview(period) {
    const query = period ? `?period=${encodeURIComponent(period)}` : ''
    return http(`/api/performance/overview${query}`)
  },
  leadershipAssessments(period) {
    return http(`/api/performance/leadership-assessments?period=${encodeURIComponent(period)}`)
  },
  saveLeadershipAssessment(payload) {
    return http('/api/performance/leadership-assessments', { method: 'POST', body: payload })
  },
  async download({ userId, startDate, endDate }) {
    const query = new URLSearchParams()
    if (userId) query.set('userId', userId)
    if (startDate) query.set('startDate', startDate)
    if (endDate) query.set('endDate', endDate)
    const response = await fetch(`/api/performance/download?${query.toString()}`, { credentials: 'include' })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error?.message || payload?.message || 'Không thể tạo file KPI.')
    }
    const disposition = response.headers.get('content-disposition') || ''
    const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    return {
      blob: await response.blob(),
      filename: encodedFileName ? decodeURIComponent(encodedFileName) : 'bang-ket-qua-thuc-hien-nhiem-vu.xlsx',
    }
  },
  async downloadImportTemplate() {
    const response = await fetch('/api/performance/import-template', { credentials: 'include' })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error?.message || payload?.message || 'Không tải được file mẫu.')
    }
    const disposition = response.headers.get('content-disposition') || ''
    const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    return {
      blob: await response.blob(),
      filename: encodedFileName ? decodeURIComponent(encodedFileName) : 'mau-nhap-hang-loat-PL4.xlsx',
    }
  },
  async previewWorkbook(file) {
    const form = new FormData()
    form.set('file', file)
    const response = await fetch('/api/performance/import/preview', {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || 'Không kiểm tra được file.')
      error.details = payload?.error?.details
      throw error
    }
    return payload
  },
  async importWorkbook(file) {
    const form = new FormData()
    form.set('file', file)
    const response = await fetch('/api/performance/import', {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || 'Không thể nhập bảng KPI.')
      error.details = payload?.error?.details
      throw error
    }
    return payload
  },
}
