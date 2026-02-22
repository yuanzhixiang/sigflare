type SigflareTrackerWindow = Window & {
  __sigflareTrackerLoaded?: boolean
  SIGFLARE_COLLECT_ENDPOINT?: string
  SIGFLARE_ERROR_ENDPOINT?: string
}

type SigflareEventPayload = {
  event: 'pv' | 'fe_error'
  url: string
  title: string
  referrer: string
  created_at: number
  error_type?: 'error' | 'unhandledrejection' | 'console_error'
  message?: string
  stack?: string
  filename?: string
  lineno?: number
  colno?: number
  reason?: string
}

function resolveEndpoints(script: HTMLScriptElement | null): { pvEndpoint: string; errorEndpoint: string } {
  const fromAttrPv = script?.getAttribute('data-sigflare-endpoint')?.trim()
  const fromAttrError = script?.getAttribute('data-sigflare-error-endpoint')?.trim()

  const trackerWindow = window as SigflareTrackerWindow
  const fromWindowPv = trackerWindow.SIGFLARE_COLLECT_ENDPOINT?.trim()
  const fromWindowError = trackerWindow.SIGFLARE_ERROR_ENDPOINT?.trim()

  const fromScriptSrc = script?.src?.trim()
  if (fromScriptSrc && fromScriptSrc.length > 0) {
    try {
      return {
        pvEndpoint: fromAttrPv || fromWindowPv || new URL('/collect', fromScriptSrc).toString(),
        errorEndpoint: fromAttrError || fromWindowError || new URL('/error', fromScriptSrc).toString(),
      }
    } catch {
      return {
        pvEndpoint: fromAttrPv || fromWindowPv || '/collect',
        errorEndpoint: fromAttrError || fromWindowError || '/error',
      }
    }
  }

  return {
    pvEndpoint: fromAttrPv || fromWindowPv || '/collect',
    errorEndpoint: fromAttrError || fromWindowError || '/error',
  }
}

function createBasePayload(event: 'pv' | 'fe_error'): SigflareEventPayload {
  return {
    event,
    url: location.href,
    title: document.title,
    referrer: document.referrer,
    created_at: Date.now(),
  }
}

function stringifyReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message
  }
  if (typeof reason === 'string') {
    return reason
  }
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function sendPayload(endpoint: string, payload: SigflareEventPayload): void {
  const body = JSON.stringify(payload)

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon(endpoint, body)
    if (sent) {
      return
    }
  }

  if (typeof fetch === 'function') {
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body,
    }).catch(() => {})
  }
}

export function trackPageview(endpoint: string): void {
  sendPayload(endpoint, createBasePayload('pv'))
}

function bindErrorReporting(endpoint: string): void {
  window.addEventListener('error', (event: Event) => {
    const errorEvent = event as ErrorEvent
    const errorObject = errorEvent.error
    const message =
      typeof errorEvent.message === 'string' && errorEvent.message.length > 0
        ? errorEvent.message
        : errorObject instanceof Error
          ? errorObject.message
          : 'unknown_error'

    sendPayload(endpoint, {
      ...createBasePayload('fe_error'),
      error_type: 'error',
      message,
      stack: errorObject instanceof Error ? errorObject.stack : undefined,
      filename: errorEvent.filename || undefined,
      lineno: errorEvent.lineno || undefined,
      colno: errorEvent.colno || undefined,
    })
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason
    sendPayload(endpoint, {
      ...createBasePayload('fe_error'),
      error_type: 'unhandledrejection',
      message: stringifyReason(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      reason: stringifyReason(reason),
    })
  })
}

function bindConsoleErrorReporting(endpoint: string): void {
  const originalConsoleError = console.error.bind(console)

  console.error = (...args: unknown[]) => {
    try {
      const firstError = args.find((arg) => arg instanceof Error)
      const message = args.length > 0 ? args.map((arg) => stringifyReason(arg)).join(' ') : 'console_error'

      sendPayload(endpoint, {
        ...createBasePayload('fe_error'),
        error_type: 'console_error',
        message,
        stack: firstError instanceof Error ? firstError.stack : undefined,
        reason: message,
      })
    } catch {}

    originalConsoleError(...(args as Parameters<typeof console.error>))
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
  const endpoints = resolveEndpoints(currentScript)
  bindConsoleErrorReporting(endpoints.errorEndpoint)
  bindErrorReporting(endpoints.errorEndpoint)
  trackPageview(endpoints.pvEndpoint)
}

bootTracker()
