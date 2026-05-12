// desktop/src/stores/hahaOAuthStore.ts

import { create } from 'zustand'
import {
  hahaOAuthApi,
  OAUTH_DISABLED_MESSAGE,
  type HahaOAuthStatus,
} from '../api/hahaOAuth'

type HahaOAuthState = {
  status: HahaOAuthStatus | null
  isPolling: boolean
  isLoading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  login: () => Promise<never>
  logout: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

const disabledStatus: HahaOAuthStatus = {
  loggedIn: false,
  disabled: true,
  message: OAUTH_DISABLED_MESSAGE,
}

export const useHahaOAuthStore = create<HahaOAuthState>(set => ({
  status: disabledStatus,
  isPolling: false,
  isLoading: false,
  error: null,

  fetchStatus: async () => {
    try {
      const status = await hahaOAuthApi.status()
      set({ status, error: null })
    } catch (err) {
      set({
        status: disabledStatus,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  login: async () => {
    set({ isLoading: true, error: null })
    const error = new Error(OAUTH_DISABLED_MESSAGE)
    set({
      isLoading: false,
      status: disabledStatus,
      error: error.message,
    })
    throw error
  },

  logout: async () => {
    set({ isLoading: true, error: null })
    try {
      await hahaOAuthApi.logout()
      set({
        status: disabledStatus,
        isLoading: false,
      })
    } catch (err) {
      set({
        status: disabledStatus,
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  startPolling: () => {
    set({ isPolling: false })
  },

  stopPolling: () => {
    set({ isPolling: false })
  },
}))
