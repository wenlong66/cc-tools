// desktop/src/api/hahaOAuth.ts

import { api } from './client'

export const OAUTH_DISABLED_MESSAGE =
  'OAuth login is disabled in CC-Tools; configure an API provider instead.'

export type HahaOAuthStatus = {
  loggedIn: false
  disabled: true
  message: string
}

export const hahaOAuthApi = {
  start() {
    return api.post<{ disabled: true; message: string }>('/api/haha-oauth/start', {})
  },

  status() {
    return api.get<HahaOAuthStatus>('/api/haha-oauth')
  },

  logout() {
    return api.delete<{ ok: true; disabled: true; message: string }>(
      '/api/haha-oauth',
    )
  },
}
