import { http } from '@/shared/api/http'

export const UserService = {
  getUsers(params = {}) {
    const query = new URLSearchParams(params).toString()
    return http(`/api/users${query ? '?' + query : ''}`)
  },

  getUserById(id) {
    return http(`/api/users/${id}`)
  },

  createUser(data) {
    return http('/api/users', { body: data })
  },

  updateUser(id, data) {
    return http(`/api/users/${id}`, {
      method: 'PATCH',
      body: data,
    })
  },

  deleteUser(id) {
    return http(`/api/users/${id}`, { method: 'DELETE' })
  },
}
