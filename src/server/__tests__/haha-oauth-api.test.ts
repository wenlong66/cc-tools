/**
 * Integration tests for /api/haha-oauth/* endpoints.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { handleHahaOAuthApi } from '../api/haha-oauth.js'
import { hahaOAuthService } from '../services/hahaOAuthService.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'haha-oauth-api-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function buildReq(
  method: string,
  pathname: string,
  body?: unknown,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(`http://localhost:3456${pathname}`)
  const req = new Request(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

describe('POST /api/haha-oauth/start', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns 410 when OAuth login is disabled', async () => {
    const { req, url, segments } = buildReq('POST', '/api/haha-oauth/start', {
      serverPort: 54321,
    })
    const res = await handleHahaOAuthApi(req, url, segments)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({
      loggedIn: false,
      disabled: true,
      message: 'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    })
  })

  test('returns 410 even when serverPort is missing', async () => {
    const { req, url, segments } = buildReq('POST', '/api/haha-oauth/start', {})
    const res = await handleHahaOAuthApi(req, url, segments)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({
      loggedIn: false,
      disabled: true,
      message: 'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    })
  })
})

describe('GET /api/haha-oauth/status', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns disabled status when no token file exists', async () => {
    const { req, url, segments } = buildReq('GET', '/api/haha-oauth/status')
    const res = await handleHahaOAuthApi(req, url, segments)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({
      loggedIn: false,
      disabled: true,
      message: 'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    })
  })

  test('returns disabled status even when tokens were previously saved', async () => {
    await hahaOAuthService.saveTokens({
      accessToken: 'sk-ant-oat01-xxx',
      refreshToken: 'sk-ant-ort01-xxx',
      expiresAt: Date.now() + 3600_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })

    const { req, url, segments } = buildReq('GET', '/api/haha-oauth/status')
    const res = await handleHahaOAuthApi(req, url, segments)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({
      loggedIn: false,
      disabled: true,
      message: 'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    })
  })

  test('returns disabled status even when a stored token is expired', async () => {
    await hahaOAuthService.saveTokens({
      accessToken: 'expired-token',
      refreshToken: 'revoked-refresh-token',
      expiresAt: Date.now() - 1_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })
    hahaOAuthService.setRefreshFn(async () => {
      throw new Error('refresh revoked')
    })

    const { req, url, segments } = buildReq('GET', '/api/haha-oauth/status')
    const res = await handleHahaOAuthApi(req, url, segments)

    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({
      loggedIn: false,
      disabled: true,
      message: 'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    })
  })
})

describe('DELETE /api/haha-oauth', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns disabled response without deleting stored tokens', async () => {
    await hahaOAuthService.saveTokens({
      accessToken: 'a',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      subscriptionType: null,
    })

    const { req, url, segments } = buildReq('DELETE', '/api/haha-oauth')
    const res = await handleHahaOAuthApi(req, url, segments)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      disabled: true,
      message: 'OAuth login is disabled in CC-Tools; configure an API provider instead.',
    })
    expect(await hahaOAuthService.loadTokens()).toEqual({
      accessToken: 'a',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      subscriptionType: null,
    })
  })
})
