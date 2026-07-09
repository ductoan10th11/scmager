import { http } from '@/shared/api/http'

const base = (organizationId) => `/api/organizations/${organizationId}/departments`

export const DepartmentService = {
  getDepartments(organizationId, params = {}) {
    const query = new URLSearchParams(params).toString()
    return http(`${base(organizationId)}${query ? '?' + query : ''}`)
  },

  getDepartmentById(organizationId, id) {
    return http(`${base(organizationId)}/${id}`)
  },

  createDepartment(organizationId, data) {
    return http(base(organizationId), { body: data })
  },

  updateDepartment(organizationId, id, data) {
    return http(`${base(organizationId)}/${id}`, {
      method: 'PATCH',
      body: data,
    })
  },

  deleteDepartment(organizationId, id) {
    return http(`${base(organizationId)}/${id}`, { method: 'DELETE' })
  },
}
