export type SigflareEnv = {
  TRACKER_SCRIPT_URL?: string
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

function resolveTrackerScriptUrl(request: Request, env: SigflareEnv): string | null {
  const fromEnv = env.TRACKER_SCRIPT_URL?.trim()
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }

  const requestUrl = new URL(request.url)
  if (localHosts.has(requestUrl.hostname)) {
    return localTrackerDevUrl
  }

  return null
}

async function trackerScriptResponse(request: Request, env: SigflareEnv): Promise<Response> {
  const trackerScriptUrl = resolveTrackerScriptUrl(request, env)
  if (!trackerScriptUrl) {
    return safeTextHeaders('tracker_script_url_not_configured', 500)
  }

  try {
    const response = await fetch(trackerScriptUrl)
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

export async function collect(request: Request, env: SigflareEnv, _ctx?: RuntimeContext): Promise<Response> {
  const requestUrl = new URL(request.url)

  if (requestUrl.pathname === '/sigflare-tracker.js') {
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
