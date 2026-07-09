import { http } from '@/shared/api/http'

export const ORGANIZATION_TYPES = [
  { value: 'DISTRICT', label: 'Cấp huyện' },
  { value: 'COMMUNE', label: 'Cấp xã' },
  { value: 'DEPARTMENT', label: 'Phòng ban' },
  { value: 'OTHER', label: 'Khác' },
]

export const OrganizationService = {
  getOrganizations(params = {}) {
    const query = new URLSearchParams(params).toString()
    return http(`/api/organizations${query ? '?' + query : ''}`)
  },

  getOrganizationById(id) {
    return http(`/api/organizations/${id}`)
  },

  createOrganization(data) {
    return http('/api/organizations', { body: data })
  },

  updateOrganization(id, data) {
    return http(`/api/organizations/${id}`, {
      method: 'PATCH',
      body: data,
    })
  },

  deleteOrganization(id) {
    return http(`/api/organizations/${id}`, { method: 'DELETE' })
  },
}
