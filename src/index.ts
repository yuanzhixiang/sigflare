type AssetFetcher = {
  fetch: (request: Request | string, init?: RequestInit) => Promise<Response>
}

export type SigflareEnv = {
  ASSETS?: AssetFetcher
}

type RuntimeContext = {
  waitUntil: (promise: Promise<unknown>) => void
}

const jsonHeaders = { 'content-type': 'application/json' }
const trackerJsHeaders = {
  'content-type': 'application/javascript; charset=utf-8',
  'cache-control': 'no-store',
}

const localTrackerDevUrl = 'http://127.0.0.1:8788/sigflare-tracker.js'
const trackerPath = '/sigflare-tracker.js'
const collectPath = '/collect'
const errorPath = '/error'
const localHosts = new Set(['127.0.0.1', 'localhost'])

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  })
}

function safeTextHeaders(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function isLocalRequest(request: Request): boolean {
  const requestUrl = new URL(request.url)
  return localHosts.has(requestUrl.hostname)
}

async function trackerScriptResponse(request: Request, env: SigflareEnv): Promise<Response> {
  if (isLocalRequest(request)) {
    try {
      const response = await fetch(localTrackerDevUrl)
      if (!response.ok) {
        return safeTextHeaders(`tracker_script_upstream_${response.status}`, 502)
      }

      return new Response(await response.text(), {
        status: 200,
        headers: trackerJsHeaders,
      })
    } catch {
      return safeTextHeaders('tracker_script_upstream_network_error', 502)
    }
  }

  if (!env.ASSETS) {
    return safeTextHeaders('tracker_script_asset_binding_not_found', 500)
  }

  const assetRequest = new Request(new URL(trackerPath, request.url).toString(), request)
  const assetResponse = await env.ASSETS.fetch(assetRequest)

  if (assetResponse.ok) {
    return assetResponse
  }

  if (assetResponse.status === 404) {
    return safeTextHeaders('tracker_script_not_found', 404)
  }

  return safeTextHeaders(`tracker_script_asset_${assetResponse.status}`, 502)
}

export async function collect(request: Request, env: SigflareEnv, _ctx?: RuntimeContext): Promise<Response> {
  const requestUrl = new URL(request.url)

  if (requestUrl.pathname === trackerPath) {
    return trackerScriptResponse(request, env)
  }

  if (requestUrl.pathname !== collectPath && requestUrl.pathname !== errorPath) {
    return safeTextHeaders('not_found', 404)
  }

  if (request.method !== 'POST') {
    return safeTextHeaders('method_not_allowed', 405)
  }

  let bodyText = ''
  try {
    bodyText = await request.text()
  } catch {
    return safeTextHeaders('invalid_body', 400)
  }

  if (bodyText.length === 0) {
    return safeTextHeaders('empty_body', 400)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(bodyText)
  } catch {
    return safeTextHeaders('invalid_json', 400)
  }

  if (!payload || typeof payload !== 'object') {
    return safeTextHeaders('invalid_payload', 400)
  }

  const eventType = payload.event
  if (eventType !== 'pv' && eventType !== 'fe_error') {
    return jsonResponse({ ok: false, error: 'only_pv_and_fe_error_supported' }, 400)
  }

  if (eventType === 'pv' && requestUrl.pathname !== collectPath) {
    return jsonResponse({ ok: false, error: 'pv_must_use_collect' }, 400)
  }

  if (eventType === 'fe_error' && requestUrl.pathname !== errorPath) {
    return jsonResponse({ ok: false, error: 'fe_error_must_use_error' }, 400)
  }

  if (eventType === 'fe_error') {
    console.error(`[sigflare] fe_error_received method=${request.method} path=${requestUrl.pathname} body=${bodyText}`)
    return jsonResponse({ ok: true, event: String(eventType) }, 200)
  }

  console.log(`[sigflare] pv_received method=${request.method} path=${requestUrl.pathname} body=${bodyText}`)

  return jsonResponse({ ok: true, event: String(eventType) }, 200)
}

export const handler = { fetch: collect }
export default handler
