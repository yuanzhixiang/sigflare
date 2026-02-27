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
    delete (window as { sigflare?: unknown }).sigflare
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

  it('binds setUserId and sends one more pageview with user_id', async () => {
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

    const sigflareApi = (window as { sigflare?: { setUserId?: (userId: string) => void } }).sigflare
    expect(sigflareApi?.setUserId).toBeTypeOf('function')

    sigflareApi?.setUserId?.('user-123')

    expect(sendBeaconMock).toHaveBeenCalledTimes(2)
    const [firstEndpoint, firstBody] = sendBeaconMock.mock.calls[0] as [string, string]
    const [secondEndpoint, secondBody] = sendBeaconMock.mock.calls[1] as [string, string]
    expect(firstEndpoint).toBe('https://sigflare.yuanzhixiang.com/collect')
    expect(secondEndpoint).toBe('https://sigflare.yuanzhixiang.com/collect')

    const firstPayload = JSON.parse(firstBody) as Record<string, unknown>
    const secondPayload = JSON.parse(secondBody) as Record<string, unknown>
    expect(firstPayload.event).toBe('pageview')
    expect(secondPayload.event).toBe('pageview')
    expect(firstPayload.user_id).toBeUndefined()
    expect(secondPayload.user_id).toBe('user-123')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses user_id from setUserId for following error reports', async () => {
    const sendBeaconMock = vi.fn().mockReturnValue(true)
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    console.error = vi.fn() as unknown as typeof console.error

    const script = document.createElement('script')
    script.src = 'https://sigflare.yuanzhixiang.com/sigflare-tracker.js'
    mockCurrentScript(script)

    await importFreshTracker()

    const sigflareApi = (window as { sigflare?: { setUserId?: (userId: string) => void } }).sigflare
    sigflareApi?.setUserId?.('user-123')
    console.error('boom')

    expect(sendBeaconMock).toHaveBeenCalledTimes(3)
    const [, secondBody] = sendBeaconMock.mock.calls[1] as [string, string]
    const [thirdEndpoint, thirdBody] = sendBeaconMock.mock.calls[2] as [string, string]

    const secondPayload = JSON.parse(secondBody) as Record<string, unknown>
    const thirdPayload = JSON.parse(thirdBody) as Record<string, unknown>
    expect(thirdEndpoint).toBe('https://sigflare.yuanzhixiang.com/error')
    expect(thirdPayload.event).toBe('fe_error')
    expect(secondPayload.user_id).toBe('user-123')
    expect(thirdPayload.user_id).toBe('user-123')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
