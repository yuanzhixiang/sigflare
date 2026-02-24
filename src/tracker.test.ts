// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalConsoleError = console.error

async function importFreshTracker(): Promise<void> {
  vi.resetModules()
  await import('./tracker')
}

function mockCurrentScript(script: HTMLScriptElement): void {
  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get: () => script,
  })
}

describe('tracker', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    delete (window as { __sigflareTrackerLoaded?: boolean }).__sigflareTrackerLoaded
    delete (window as { SIGFLARE_COLLECT_ENDPOINT?: string }).SIGFLARE_COLLECT_ENDPOINT
    delete (window as { SIGFLARE_ERROR_ENDPOINT?: string }).SIGFLARE_ERROR_ENDPOINT
    console.error = originalConsoleError
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    console.error = originalConsoleError
  })

  it('sends a pageview event to /collect on boot', async () => {
    const sendBeaconMock = vi.fn().mockReturnValue(true)
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const script = document.createElement('script')
    script.src = 'https://sigflare.yuanzhixiang.com/sigflare-tracker.js'
    mockCurrentScript(script)

    await importFreshTracker()

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const [endpoint, body] = sendBeaconMock.mock.calls[0] as [string, string]
    expect(endpoint).toBe('https://sigflare.yuanzhixiang.com/collect')

    const payload = JSON.parse(body) as Record<string, unknown>
    expect(payload.event).toBe('pageview')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to fetch when sendBeacon returns false', async () => {
    const sendBeaconMock = vi.fn().mockReturnValue(false)
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    })

    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const script = document.createElement('script')
    script.src = 'https://sigflare.yuanzhixiang.com/sigflare-tracker.js'
    script.setAttribute('data-sigflare-endpoint', 'https://collector.example.com/custom-collect')
    mockCurrentScript(script)

    await importFreshTracker()

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('https://collector.example.com/custom-collect')
    expect(init.method).toBe('POST')

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.event).toBe('pageview')
  })
})
