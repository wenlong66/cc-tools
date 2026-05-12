/**
 * Haha OAuth REST API
 *
 * OAuth login is disabled in CC-Tools.
 */

import { errorResponse } from '../middleware/errorHandler.js'

const OAUTH_DISABLED_MESSAGE = 'OAuth login is disabled in CC-Tools; configure an API provider instead.'

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function disabledJson(): Response {
  return Response.json({
    loggedIn: false,
    disabled: true,
    message: OAUTH_DISABLED_MESSAGE,
  }, { status: 410 })
}

export async function handleHahaOAuthApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (action === 'start' && req.method === 'POST') {
      return disabledJson()
    }

    if (action === 'callback' && req.method === 'GET') {
      return handleHahaOAuthCallback()
    }

    if ((action === undefined || action === 'status') && req.method === 'GET') {
      return disabledJson()
    }

    if (action === undefined && req.method === 'DELETE') {
      return Response.json({ ok: true, disabled: true, message: OAUTH_DISABLED_MESSAGE })
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function handleHahaOAuthCallback(_url?: URL): Promise<Response> {
  return html(renderCallbackPage())
}

function renderCallbackPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>OAuth Disabled</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#333}.card{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.06);max-width:560px}h1{color:#dc2626;margin:0 0 12px}p{color:#666;line-height:1.5}</style>
</head><body><div class="card"><h1>OAuth Disabled in CC-Tools</h1><p>CC-Tools no longer supports Claude OAuth login in this build.</p><p>Please close this window and configure an API provider instead.</p></div></body></html>`
}
