// desktop/src/stores/hahaOAuthStore.ts

import { create } from 'zustand'
import {
  cctoolsOAuthApi,
  OAUTH_DISABLED_MESSAGE,
  type CCToolsOAuthStatus,
} from '../api/hahaOAuth'

type CCToolsOAuthState = {
  status: CCToolsOAuthStatus | null
  isPolling: boolean
  isLoading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  login: () => Promise<never>
  logout: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

const disabledStatus: CCToolsOAuthStatus = {
  loggedIn: false,
  disabled: true,
  message: OAUTH_DISABLED_MESSAGE,
}

export const useCCToolsOAuthStore = create<CCToolsOAuthState>(set => ({
  status: disabledStatus,
  isPolling: false,
  isLoading: false,
  error: null,

  fetchStatus: async () => {
    try {
      const status = await cctoolsOAuthApi.status()
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
      await cctoolsOAuthApi.logout()
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
