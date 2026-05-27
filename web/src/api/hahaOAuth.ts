// desktop/src/api/hahaOAuth.ts

import { api } from './client'

export const OAUTH_DISABLED_MESSAGE =
  'OAuth login is disabled in CC-Tools; configure an API provider instead.'

export type CCToolsOAuthStatus = {
  loggedIn: false
  disabled: true
  message: string
}

export const cctoolsOAuthApi = {
  start() {
    return api.post<{ disabled: true; message: string }>('/api/cctools-oauth/start', {})
  },

  status() {
    return api.get<CCToolsOAuthStatus>('/api/cctools-oauth')
  },

  logout() {
    return api.delete<{ ok: true; disabled: true; message: string }>(
      '/api/cctools-oauth',
    )
  },
}
