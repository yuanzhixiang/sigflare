type SigflareTrackerWindow = Window & {
  __sigflareTrackerLoaded?: boolean
  SIGFLARE_COLLECT_ENDPOINT?: string
}

function resolveEndpoint(script: HTMLScriptElement | null): string {
  const fromAttr = script?.getAttribute('data-sigflare-endpoint')?.trim()
  if (fromAttr && fromAttr.length > 0) {
    return fromAttr
  }

  const fromWindow = (window as SigflareTrackerWindow).SIGFLARE_COLLECT_ENDPOINT
  if (typeof fromWindow === 'string' && fromWindow.trim().length > 0) {
    return fromWindow.trim()
  }

  const fromScriptSrc = script?.src?.trim()
  if (fromScriptSrc && fromScriptSrc.length > 0) {
    try {
      return new URL('/collect', fromScriptSrc).toString()
    } catch {
      return '/collect'
    }
  }

  return '/collect'
}

export function trackPageview(endpoint: string): void {
  const payload = {
    event: 'pv',
    url: location.href,
    title: document.title,
    referrer: document.referrer,
    created_at: Date.now(),
  }
  const body = JSON.stringify(payload)

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(endpoint, body)
    return
  }

  if (typeof fetch === 'function') {
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body,
    })
  }
}

function bootTracker(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const trackerWindow = window as SigflareTrackerWindow
  if (trackerWindow.__sigflareTrackerLoaded) {
    return
  }
  trackerWindow.__sigflareTrackerLoaded = true

  const currentScript = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null
  trackPageview(resolveEndpoint(currentScript))
}

bootTracker()
