type AssetFetcher = {
  fetch: (request: Request | string, init?: RequestInit) => Promise<Response>
}

export type SigflareEnv = {
  ASSETS?: AssetFetcher
  CLICKHOUSE_URL?: string
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
const sessionWindowMs = 30 * 60 * 1000
const fnv64Offset = 0xcbf29ce484222325n
const fnv64Prime = 0x100000001b3n
const fnv64Mask = 0xffffffffffffffffn
const safeIntMask = 0x1fffffffffffffn

type UserAgentInfo = {
  device: string
  os: string
  osVersion: string
  browser: string
  browserVersion: string
}

type ClickHouseEventRow = {
  event_time: string
  event: string
  visitor_id: number
  session_id: number
  hostname: string
  pathname: string
  referrer: string
  referrer_source: string
  country: string
  device: string
  os: string
  os_version: string
  browser: string
  browser_version: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
}

type ClickHouseInsertResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: 'clickhouse_url_not_configured' | 'clickhouse_url_invalid' | 'clickhouse_insert_failed' | 'clickhouse_network_error'
      status?: number
      detail?: string
    }

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

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
  }

  return Date.now()
}

function parseUrlOrNull(value: string): URL | null {
  if (value.length === 0) {
    return null
  }

  try {
    return new URL(value)
  } catch {
    return null
  }
}

function resolveReferrerSource(referrer: string): string {
  if (referrer.length === 0) {
    return 'direct'
  }

  const referrerUrl = parseUrlOrNull(referrer)
  if (!referrerUrl) {
    return 'unknown'
  }

  return referrerUrl.hostname || 'unknown'
}

function extractClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp && cfConnectingIp.trim().length > 0) {
    return cfConnectingIp.trim()
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  if (!forwardedFor) {
    return ''
  }

  const firstIp = forwardedFor.split(',')[0]
  return firstIp ? firstIp.trim() : ''
}

function fnv1a53(input: string): number {
  let hash = fnv64Offset

  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * fnv64Prime) & fnv64Mask
  }

  return Number(hash & safeIntMask)
}

function asUInt53(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed
    }
  }

  return fallback
}

function parseUserAgent(userAgent: string): UserAgentInfo {
  const ua = userAgent.trim()
  let device = 'desktop'
  if (/bot|spider|crawl/i.test(ua)) {
    device = 'bot'
  } else if (/ipad|tablet/i.test(ua)) {
    device = 'tablet'
  } else if (/mobile|iphone|ipod|android/i.test(ua)) {
    device = 'mobile'
  }

  let os = 'unknown'
  let osVersion = ''

  const windows = ua.match(/Windows NT ([0-9.]+)/i)
  const android = ua.match(/Android ([0-9.]+)/i)
  const ios = ua.match(/(?:iPhone|iPad|iPod).*OS ([0-9_]+)/i)
  const macos = ua.match(/Mac OS X ([0-9_]+)/i)

  if (windows) {
    os = 'Windows'
    osVersion = windows[1] ?? ''
  } else if (android) {
    os = 'Android'
    osVersion = android[1] ?? ''
  } else if (ios) {
    os = 'iOS'
    osVersion = (ios[1] ?? '').replace(/_/g, '.')
  } else if (macos) {
    os = 'macOS'
    osVersion = (macos[1] ?? '').replace(/_/g, '.')
  } else if (/Linux/i.test(ua)) {
    os = 'Linux'
  }

  let browser = 'unknown'
  let browserVersion = ''

  const edge = ua.match(/Edg\/([0-9.]+)/i)
  const opera = ua.match(/OPR\/([0-9.]+)/i)
  const chrome = ua.match(/Chrome\/([0-9.]+)/i)
  const safari = ua.match(/Version\/([0-9.]+).*Safari/i)
  const firefox = ua.match(/Firefox\/([0-9.]+)/i)

  if (edge) {
    browser = 'Edge'
    browserVersion = edge[1] ?? ''
  } else if (opera) {
    browser = 'Opera'
    browserVersion = opera[1] ?? ''
  } else if (chrome) {
    browser = 'Chrome'
    browserVersion = chrome[1] ?? ''
  } else if (safari) {
    browser = 'Safari'
    browserVersion = safari[1] ?? ''
  } else if (firefox) {
    browser = 'Firefox'
    browserVersion = firefox[1] ?? ''
  }

  return { device, os, osVersion, browser, browserVersion }
}

function padStart(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function toDateTime64Utc(timestampMs: number): string {
  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) {
    return toDateTime64Utc(Date.now())
  }

  const year = date.getUTCFullYear()
  const month = padStart(date.getUTCMonth() + 1, 2)
  const day = padStart(date.getUTCDate(), 2)
  const hour = padStart(date.getUTCHours(), 2)
  const minute = padStart(date.getUTCMinutes(), 2)
  const second = padStart(date.getUTCSeconds(), 2)
  const millis = padStart(date.getUTCMilliseconds(), 3)

  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${millis}`
}

function resolveCountryCode(request: Request): string {
  const requestWithCf = request as Request & { cf?: { country?: unknown } }
  const country = requestWithCf.cf?.country

  if (typeof country === 'string' && /^[a-z]{2}$/i.test(country)) {
    return country.toUpperCase()
  }

  return 'ZZ'
}

function resolveClickHouseInsertRequest(clickhouseUrl: string): { insertUrl: string; headers: Record<string, string> } {
  const url = new URL(clickhouseUrl)
  const databaseName = url.pathname.replace(/^\/+|\/+$/g, '')
  const username = url.username
  const password = url.password

  url.username = ''
  url.password = ''
  url.pathname = '/'
  if (databaseName.length > 0 && !url.searchParams.has('database')) {
    url.searchParams.set('database', databaseName)
  }
  url.searchParams.set('query', 'INSERT INTO events FORMAT JSONEachRow')

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (username.length > 0 || password.length > 0) {
    headers.authorization = `Basic ${btoa(`${username}:${password}`)}`
  }

  return { insertUrl: url.toString(), headers }
}

function buildEventRow(payload: Record<string, unknown>, request: Request, eventType: string): ClickHouseEventRow {
  const pageUrlRaw = asNonEmptyString(payload.url)
  const pageUrl = parseUrlOrNull(pageUrlRaw)
  const referrer = asNonEmptyString(payload.referrer)
  const eventTimeMs = asTimestampMs(payload.created_at)
  const userAgent = request.headers.get('user-agent')?.trim() ?? ''
  const userAgentInfo = parseUserAgent(userAgent)

  const clientIp = extractClientIp(request)
  const fallbackVisitorId = fnv1a53(`${clientIp}|${userAgent}`)
  const sessionBucket = Math.floor(eventTimeMs / sessionWindowMs)
  const fallbackSessionId = fnv1a53(`${fallbackVisitorId}|${sessionBucket}`)
  const visitorId = asUInt53(payload.visitor_id, fallbackVisitorId)
  const sessionId = asUInt53(payload.session_id, fallbackSessionId)

  return {
    event_time: toDateTime64Utc(eventTimeMs),
    event: eventType,
    visitor_id: visitorId,
    session_id: sessionId,
    hostname: pageUrl?.hostname || '',
    pathname: pageUrl?.pathname || '/',
    referrer,
    referrer_source: resolveReferrerSource(referrer),
    country: resolveCountryCode(request),
    device: userAgentInfo.device,
    os: userAgentInfo.os,
    os_version: userAgentInfo.osVersion,
    browser: userAgentInfo.browser,
    browser_version: userAgentInfo.browserVersion,
    utm_source: pageUrl?.searchParams.get('utm_source') ?? '',
    utm_medium: pageUrl?.searchParams.get('utm_medium') ?? '',
    utm_campaign: pageUrl?.searchParams.get('utm_campaign') ?? '',
  }
}

async function insertEventToClickHouse(
  payload: Record<string, unknown>,
  request: Request,
  env: SigflareEnv,
  eventType: string,
): Promise<ClickHouseInsertResult> {
  const clickhouseUrl = env.CLICKHOUSE_URL?.trim()
  if (!clickhouseUrl) {
    return { ok: false, error: 'clickhouse_url_not_configured' }
  }

  let insertUrl = ''
  let headers: Record<string, string> = {}

  try {
    const requestInfo = resolveClickHouseInsertRequest(clickhouseUrl)
    insertUrl = requestInfo.insertUrl
    headers = requestInfo.headers
  } catch {
    return { ok: false, error: 'clickhouse_url_invalid' }
  }

  const row = buildEventRow(payload, request, eventType)
  const insertBody = `${JSON.stringify(row)}\n`

  try {
    const response = await fetch(insertUrl, {
      method: 'POST',
      headers,
      body: insertBody,
    })

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 300)
      return {
        ok: false,
        error: 'clickhouse_insert_failed',
        status: response.status,
        detail,
      }
    }

    return { ok: true }
  } catch {
    return { ok: false, error: 'clickhouse_network_error' }
  }
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

  const eventType = asNonEmptyString(payload.event)
  if (eventType.length === 0) {
    return jsonResponse({ ok: false, error: 'event_required' }, 400)
  }

  if (requestUrl.pathname === errorPath) {
    console.error(`[sigflare] error_event_received method=${request.method} path=${requestUrl.pathname} event=${eventType} body=${bodyText}`)
    return jsonResponse({ ok: true, event: eventType }, 200)
  }

  const insertResult = await insertEventToClickHouse(payload, request, env, eventType)
  if (!insertResult.ok) {
    console.error(
      `[sigflare] event_insert_failed method=${request.method} path=${requestUrl.pathname} event=${eventType} error=${insertResult.error} status=${String(
        insertResult.status ?? '',
      )} detail=${insertResult.detail ?? ''}`,
    )
    return jsonResponse({ ok: false, error: insertResult.error }, 502)
  }

  console.log(`[sigflare] event_saved method=${request.method} path=${requestUrl.pathname} event=${eventType} body=${bodyText}`)

  return jsonResponse({ ok: true, event: eventType }, 200)
}

export const handler = { fetch: collect }
export default handler
