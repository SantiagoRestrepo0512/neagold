import { defineStore } from 'pinia'
import { authApi, usersApi } from '@/api'
import { ApiError, clearCsrf } from '@/api/client'
import type { Profile } from '@/api/types'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as Profile | null,
    loading: false
  }),
  getters: {
    authenticated: (state) => state.user !== null,
    permissions(state): string[] {
      return state.user?.permissions ?? []
    },
    roles(state): string[] {
      return state.user?.roles ?? []
    }
  },
  actions: {
    hasPerm(required: string | string[]): boolean {
      const perms = this.permissions
      const list = Array.isArray(required) ? required : [required]
      return list.some((p) => perms.includes(p))
    },

    async bootstrap(): Promise<boolean> {
      if (this.user) return true
      this.loading = true
      try {
        this.user = await usersApi.me()
        return true
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          this.user = null
          return false
        }
        throw err
      } finally {
        this.loading = false
      }
    },

    async login(email: string, password: string): Promise<Profile> {
      await authApi.login(email, password)
      clearCsrf()
      const user = await usersApi.me()
      this.user = user
      return user
    },

    async logout(): Promise<void> {
      try {
        await authApi.logout()
      } catch {
        // el servidor puede no responder; igual limpiamos el estado local
      }
      clearCsrf()
      this.user = null
    }
  }
})