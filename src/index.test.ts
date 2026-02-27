import { afterEach, describe, expect, it, vi } from 'vitest'
import { collect } from './index'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createCollectRequest(body: Record<string, unknown>): Request {
  return new Request('https://sigflare.yuanzhixiang.com/collect', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'cf-connecting-ip': '203.0.113.10',
    },
    body: JSON.stringify(body),
  })
}

describe('collect', () => {
  it('writes event from /collect to ClickHouse', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = createCollectRequest({
      event: 'pv',
      url: 'https://example.com/docs?utm_source=test&utm_medium=manual&utm_campaign=launch',
      title: 'Docs',
      referrer: 'https://google.com/search?q=sigflare',
      created_at: 1719250000000,
      user_id: 'biz-user-001',
    })

    const response = await collect(request, {
      CLICKHOUSE_URL: 'http://user:pass@clickhouse.example:8123/sigflare',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, event: 'pv' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsedUrl = new URL(calledUrl)
    expect(parsedUrl.searchParams.get('database')).toBe('sigflare')
    expect(parsedUrl.searchParams.get('query')).toBe('INSERT INTO events FORMAT JSONEachRow')

    const initHeaders = init.headers as Record<string, string>
    expect(initHeaders.authorization).toMatch(/^Basic /)
    expect(initHeaders['content-type']).toBe('application/json')

    const row = JSON.parse(String(init.body).trim()) as Record<string, unknown>
    expect(row.event).toBe('pv')
    expect(row.user_id).toBe('biz-user-001')
    expect(row.visitor_id).toBeTypeOf('number')
    expect(row.hostname).toBe('example.com')
    expect(row.pathname).toBe('/docs')
    expect(row.utm_source).toBe('test')
    expect(row.utm_medium).toBe('manual')
    expect(row.utm_campaign).toBe('launch')
  })

  it('returns 502 when ClickHouse insert fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('insert failed', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = createCollectRequest({
      event: 'pv',
      url: 'https://example.com',
      title: 'Home',
      referrer: '',
      created_at: 1719250000000,
    })

    const response = await collect(request, {
      CLICKHOUSE_URL: 'http://user:pass@clickhouse.example:8123/sigflare',
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'clickhouse_insert_failed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not insert when path is /error', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request('https://sigflare.yuanzhixiang.com/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'fe_error',
        url: 'https://example.com',
        title: 'Home',
        referrer: '',
        created_at: Date.now(),
      }),
    })

    const response = await collect(request, {
      CLICKHOUSE_URL: 'http://user:pass@clickhouse.example:8123/sigflare',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, event: 'fe_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
