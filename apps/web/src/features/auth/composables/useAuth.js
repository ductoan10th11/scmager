import { computed, reactive } from 'vue'
import { AuthService } from '@/features/auth/services/auth.service'

const state = reactive({
  user: null,
  isLoading: false,
  isBootstrapped: false,
})

const toUser = (payload) => payload?.data?.user || null
let bootstrapPromise = null

export function useAuth() {
  const isAuthenticated = computed(() => Boolean(state.user))

  const loadMe = async ({ force = false } = {}) => {
    if (state.isBootstrapped && !force) return state.user
    if (bootstrapPromise && !force) return bootstrapPromise

    bootstrapPromise = (async () => {
      state.isLoading = true
      try {
        const payload = await AuthService.me()
        state.user = toUser(payload)
        return state.user
      } catch (error) {
        if (error.status === 401) {
          state.user = null
          return null
        }
        throw error
      } finally {
        state.isBootstrapped = true
        state.isLoading = false
        bootstrapPromise = null
      }
    })()

    return bootstrapPromise
  }

  const login = async (credentials) => {
    state.isLoading = true
    try {
      const payload = await AuthService.login(credentials)
      state.user = payload?.data?.user || null
      state.isBootstrapped = true
      bootstrapPromise = null
      return state.user
    } finally {
      state.isLoading = false
    }
  }

  const logout = async () => {
    try {
      await AuthService.logout()
    } finally {
      state.user = null
      state.isBootstrapped = true
      bootstrapPromise = null
    }
  }

  return {
    user: computed(() => state.user),
    isAuthenticated,
    isLoading: computed(() => state.isLoading),
    loadMe,
    login,
    logout,
  }
}
