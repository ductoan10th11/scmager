import { http } from '@/shared/api/http'

export const AuthService = {
  async login({ login, password, remember }) {
    return http('/api/auth/me', {
      method: 'POST',
      body: { login, password, remember },
    })
  },

  async logout() {
    return http('/api/auth/me', { method: 'DELETE' })
  },

  async me() {
    return http('/api/auth/me')
  },
}
