import { beforeEach, describe, expect, it, vi } from 'vitest'

const { statusMock, logoutMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  logoutMock: vi.fn(),
}))

vi.mock('../api/hahaOAuth', () => ({
  OAUTH_DISABLED_MESSAGE:
    'OAuth login is disabled in CC-Tools; configure an API provider instead.',
  hahaOAuthApi: {
    status: statusMock,
    logout: logoutMock,
  },
}))

import { useHahaOAuthStore } from './hahaOAuthStore'

const initialState = useHahaOAuthStore.getState()

describe('hahaOAuthStore', () => {
  beforeEach(() => {
    statusMock.mockReset()
    logoutMock.mockReset()
    useHahaOAuthStore.setState({
      ...initialState,
      isPolling: false,
      isLoading: false,
      error: null,
    })
  })

  it('login fails with the API-only disabled message', async () => {
    await expect(useHahaOAuthStore.getState().login()).rejects.toThrow(
      'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    )

    expect(useHahaOAuthStore.getState().isPolling).toBe(false)
    expect(useHahaOAuthStore.getState().error).toBe(
      'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    )
    expect(useHahaOAuthStore.getState().status).toMatchObject({
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

    await useHahaOAuthStore.getState().fetchStatus()

    expect(useHahaOAuthStore.getState().status).toMatchObject({
      loggedIn: false,
      disabled: true,
    })
    expect(useHahaOAuthStore.getState().isPolling).toBe(false)
  })
})
