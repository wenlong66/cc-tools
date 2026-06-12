import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  defaultBaseUrl: 'http://127.0.0.1:3456',
  explicitDefaultBaseUrl: false,
  setBaseUrl: vi.fn(),
  setAuthToken: vi.fn(),
  postVerify: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: {
    post: clientMocks.postVerify,
  },
  getDefaultBaseUrl: () => clientMocks.defaultBaseUrl,
  hasExplicitDefaultBaseUrl: () => clientMocks.explicitDefaultBaseUrl,
  setAuthToken: clientMocks.setAuthToken,
  setBaseUrl: clientMocks.setBaseUrl,
}))

import { initializeDesktopServerUrl } from './desktopRuntime'

function healthOkResponse() {
  return Response.json({ status: 'ok' })
}

describe('desktopRuntime healthcheck fallback regression', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.defaultBaseUrl = 'http://127.0.0.1:3456'
    clientMocks.explicitDefaultBaseUrl = false
    window.localStorage.clear()
    window.history.pushState({}, '', '/')
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('falls back to the desktop backend when same-origin health returns Vite HTML', async () => {
    // Regression: ISSUE-001 — browser startup used Vite origin /health and crashed on HTML
    // Found by /qa on 2026-06-12
    // Report: .gstack/qa-reports/qa-report-localhost-2026-06-12.md
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url === `${window.location.origin}/health`) {
        return new Response('<!doctype html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }

      if (url === 'http://127.0.0.1:3456/health') {
        return healthOkResponse()
      }

      if (url === 'http://127.0.0.1:3456/api/status') {
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    await expect(initializeDesktopServerUrl()).resolves.toBe('http://127.0.0.1:3456')

    expect(clientMocks.setBaseUrl).toHaveBeenLastCalledWith('http://127.0.0.1:3456')
    expect(clientMocks.setAuthToken).toHaveBeenLastCalledWith(null)
    expect(globalThis.fetch).toHaveBeenCalledWith(`${window.location.origin}/health`, {
      cache: 'no-store',
    })
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:3456/health', {
      cache: 'no-store',
    })
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:3456/api/status', {
      cache: 'no-store',
    })
  })
})
