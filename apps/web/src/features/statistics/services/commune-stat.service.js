import { http } from '@/shared/api/http'

export const CommuneStatService = {
  // 1. Lấy dữ liệu tổng quan cho Trung tâm Điều hành IOC
  async getIocOverview({ year = 2026, period = 'Tháng 9/2026', category = 'ALL' } = {}) {
    const query = new URLSearchParams()
    if (year) query.append('year', year)
    if (period) query.append('period', period)
    if (category && category !== 'ALL') query.append('category', category)
    return await http(`/api/commune-stats/overview?${query.toString()}`)
  },

  // 2. Lấy danh sách văn bản báo cáo nguồn
  async getReportsList({ category, search, year, page = 1, limit = 50 } = {}) {
    const query = new URLSearchParams()
    if (category && category !== 'ALL') query.append('category', category)
    if (search) query.append('search', search)
    if (year) query.append('year', year)
    if (page) query.append('page', page)
    if (limit) query.append('limit', limit)
    return await http(`/api/commune-stats/reports?${query.toString()}`)
  },

  // 3. Lấy chi tiết báo cáo và danh sách chỉ tiêu trích xuất từ nó
  async getReportDetail(reportId) {
    if (!reportId) return { report: null, metrics: [] }
    return await http(`/api/commune-stats/reports/${reportId}`)
  },

  // Xóa báo cáo nguồn
  async deleteReport(reportId) {
    if (!reportId) return null
    return await http(`/api/commune-stats/reports/${reportId}`, {
      method: 'DELETE',
    })
  },

  // 4. Bóc tách số liệu từ tệp văn bản báo cáo (.docx, .pdf)
  async extractReport({ file, reportTitle, code, period, year, category }) {
    const formData = new FormData()
    if (file) formData.append('file', file)
    if (reportTitle) formData.append('reportTitle', reportTitle)
    if (code) formData.append('code', code)
    if (period) formData.append('period', period)
    if (year) formData.append('year', year)
    if (category) formData.append('category', category)

    const response = await fetch('/api/commune-stats/extract', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData?.error?.message || 'Lỗi bóc tách tệp báo cáo.')
    }
    return await response.json()
  },

  // 5. Ghi nhận toàn bộ chỉ tiêu đã thẩm định vào CSDL
  async commitMetrics(confirmedMetrics, report) {
    return await http('/api/commune-stats/commit', {
      method: 'POST',
      body: {
        metrics: confirmedMetrics,
        report,
      },
    })
  },

  // 6. Bật/tắt switch thẩm định chỉ tiêu
  async toggleMetricStatus(metricId, isConfirmed) {
    return await http(`/api/commune-stats/metrics/${metricId}/status`, {
      method: 'PATCH',
      body: { isConfirmed },
    })
  },

  // 7. Nhập chỉ tiêu thủ công
  async createManualMetric(metricData) {
    return await http('/api/commune-stats/metrics', {
      method: 'POST',
      body: metricData,
    })
  },

  // 8. Tự động đồng bộ số liệu từ hệ thống eWork
  async syncFromEwork(year = 2026, period = 'Tháng 9/2026') {
    return await http('/api/commune-stats/sync-ework', {
      method: 'POST',
      body: { year, period },
    })
  },

  // 9. Tra cứu báo cáo nguồn của một chỉ tiêu (hoặc lấy báo cáo gần nhất của khối/hệ thống)
  async getSourceReportForMetric(metric, recentReports = []) {
    if (!metric) return null
    if (metric.sourceReportId && typeof metric.sourceReportId === 'object' && metric.sourceReportId.code) {
      return metric.sourceReportId
    }
    const reportId = typeof metric.sourceReportId === 'string' ? metric.sourceReportId : metric.sourceReportId?._id
    if (reportId) {
      try {
        const detail = await this.getReportDetail(reportId)
        if (detail?.report) return detail.report
      } catch {
        // Fallback
      }
    }
    if (Array.isArray(recentReports) && recentReports.length > 0) {
      const catReport = recentReports.find((r) => r.category === metric.category)
      if (catReport) return catReport
      return recentReports[0]
    }
    return null
  },
}

export default CommuneStatService
