import { beforeEach, describe, expect, it, vi } from 'vitest'

const { statusMock, logoutMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  logoutMock: vi.fn(),
}))

vi.mock('../api/hahaOAuth', () => ({
  OAUTH_DISABLED_MESSAGE:
    'OAuth login is disabled in CC-Tools; configure an API provider instead.',
  cctoolsOAuthApi: {
    status: statusMock,
    logout: logoutMock,
  },
}))

import { useCCToolsOAuthStore } from './hahaOAuthStore'

const initialState = useCCToolsOAuthStore.getState()

describe('cctoolsOAuthStore', () => {
  beforeEach(() => {
    statusMock.mockReset()
    logoutMock.mockReset()
    useCCToolsOAuthStore.setState({
      ...initialState,
      isPolling: false,
      isLoading: false,
      error: null,
    })
  })

  it('login fails with the API-only disabled message', async () => {
    await expect(useCCToolsOAuthStore.getState().login()).rejects.toThrow(
      'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    )

    expect(useCCToolsOAuthStore.getState().isPolling).toBe(false)
    expect(useCCToolsOAuthStore.getState().error).toBe(
      'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    )
    expect(useCCToolsOAuthStore.getState().status).toMatchObject({
      loggedIn: false,
      disabled: true,
    })
  })

  it('fetchStatus preserves the disabled status from the API', async () => {
    statusMock.mockResolvedValue({
      loggedIn: false,
      disabled: true,
      message:
        'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    })

    await useCCToolsOAuthStore.getState().fetchStatus()

    expect(useCCToolsOAuthStore.getState().status).toMatchObject({
      loggedIn: false,
      disabled: true,
    })
    expect(useCCToolsOAuthStore.getState().isPolling).toBe(false)
  })
})
