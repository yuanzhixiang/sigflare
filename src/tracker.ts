type SigflareTrackerWindow = Window & {
  __sigflareTrackerLoaded?: boolean
  SIGFLARE_COLLECT_ENDPOINT?: string
  SIGFLARE_ERROR_ENDPOINT?: string
  sigflare?: SigflarePublicApi
}

type SigflarePublicApi = {
  setUserId: (userId: string) => void
  track: (event: string) => void
}

type TrackerRuntimeState = {
  userId?: string
}

type SigflareEventPayload = {
  event: string
  url: string
  title: string
  referrer: string
  created_at: number
  user_id?: string
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

function createBasePayload(event: string, state: TrackerRuntimeState): SigflareEventPayload {
  return {
    event,
    url: location.href,
    title: document.title,
    referrer: document.referrer,
    created_at: Date.now(),
    user_id: state.userId,
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

export function trackPageview(endpoint: string, state?: TrackerRuntimeState): void {
  const runtimeState = state ?? {}
  sendPayload(endpoint, createBasePayload('pageview', runtimeState))
}

function trackEvent(endpoint: string, event: string, state?: TrackerRuntimeState): void {
  const normalizedEvent = event.trim()
  if (normalizedEvent.length === 0) {
    return
  }

  const runtimeState = state ?? {}
  sendPayload(endpoint, createBasePayload(normalizedEvent, runtimeState))
}

function bindErrorReporting(endpoint: string, state: TrackerRuntimeState): void {
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
      ...createBasePayload('fe_error', state),
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
      ...createBasePayload('fe_error', state),
      error_type: 'unhandledrejection',
      message: stringifyReason(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      reason: stringifyReason(reason),
    })
  })
}

function bindConsoleErrorReporting(endpoint: string, state: TrackerRuntimeState): void {
  const originalConsoleError = console.error.bind(console)

  console.error = (...args: unknown[]) => {
    try {
      const firstError = args.find((arg) => arg instanceof Error)
      const message = args.length > 0 ? args.map((arg) => stringifyReason(arg)).join(' ') : 'console_error'

      sendPayload(endpoint, {
        ...createBasePayload('fe_error', state),
        error_type: 'console_error',
        message,
        stack: firstError instanceof Error ? firstError.stack : undefined,
        reason: message,
      })
    } catch {}

    originalConsoleError(...(args as Parameters<typeof console.error>))
  }
}

function bindPublicApi(trackerWindow: SigflareTrackerWindow, endpoints: { pvEndpoint: string }, state: TrackerRuntimeState): void {
  const existingApi = trackerWindow.sigflare
  const sigflareApi: SigflarePublicApi =
    existingApi && typeof existingApi === 'object'
      ? existingApi
      : ({ setUserId: () => {}, track: () => {} } as SigflarePublicApi)

  sigflareApi.setUserId = (userId: string) => {
    const normalizedUserId = userId.trim()
    if (normalizedUserId.length === 0) {
      return
    }

    if (state.userId === normalizedUserId) {
      return
    }

    state.userId = normalizedUserId
    trackPageview(endpoints.pvEndpoint, state)
  }

  sigflareApi.track = (event: string) => {
    trackEvent(endpoints.pvEndpoint, event, state)
  }

  trackerWindow.sigflare = sigflareApi
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
  const state: TrackerRuntimeState = {}

  bindPublicApi(trackerWindow, endpoints, state)
  bindConsoleErrorReporting(endpoints.errorEndpoint, state)
  bindErrorReporting(endpoints.errorEndpoint, state)
  trackPageview(endpoints.pvEndpoint, state)
}

bootTracker()
