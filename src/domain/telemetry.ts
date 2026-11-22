export type TelemetryCategory = 'navigation' | 'interaction' | 'flow' | 'player' | 'api'

export type TelemetryEventPayload = {
  eventId: string
  sessionId: string
  profileId: string | null
  ts: string
  category: TelemetryCategory
  name: string
  flowId?: string
  flowName?: string
  status?: 'ok' | 'abandoned' | 'error' | 'timeout' | 'in_progress'
  durationMs?: number
  targetId?: string
  view?: string
  rapidCount?: number
  meta?: Record<string, unknown>
}

const SESSION_KEY = 'savano-cine-telemetry-session'
const FLUSH_INTERVAL_MS = 3000
const MAX_QUEUE_SIZE = 15

let currentProfileId: string | null = null
let currentView = typeof window !== 'undefined' ? window.location.pathname : '/'
let queue: TelemetryEventPayload[] = []
let flushTimer: number | null = null
let installed = false

const activeFlows = new Map<string, { flowName: string; startedAt: number; meta?: Record<string, unknown> }>()
const recentClickMap = new Map<string, { count: number; lastAt: number }>()

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function getTelemetrySessionId(): string {
  if (typeof window === 'undefined') return 'ssr'
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const created = nextId('sess')
    window.sessionStorage.setItem(SESSION_KEY, created)
    return created
  } catch {
    return nextId('sess')
  }
}

export function setTelemetryProfile(profileId: string | null) {
  currentProfileId = profileId || null
}

export function setTelemetryView(view: string) {
  currentView = view || '/'
}

function scheduleFlush() {
  if (typeof window === 'undefined' || flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushTelemetry(false)
  }, FLUSH_INTERVAL_MS)
}

export function flushTelemetry(useBeacon = false) {
  if (typeof window === 'undefined' || queue.length === 0) return
  const batch = queue.splice(0, 100)
  const body = JSON.stringify({ events: batch })

  if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon('/api/telemetry/events', blob)
    return
  }

  try {
    void window.fetch('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // non-fatal telemetry failure
  }
}

export function trackEvent(
  category: TelemetryCategory,
  name: string,
  fields: Omit<TelemetryEventPayload, 'eventId' | 'sessionId' | 'profileId' | 'ts' | 'category' | 'name'> = {},
) {
  if (typeof window === 'undefined') return
  queue.push({
    eventId: nextId('evt'),
    sessionId: getTelemetrySessionId(),
    profileId: currentProfileId,
    ts: new Date().toISOString(),
    category,
    name,
    view: fields.view ?? currentView,
    ...fields,
  })
  if (queue.length >= MAX_QUEUE_SIZE) {
    flushTelemetry(false)
  } else {
    scheduleFlush()
  }
}

export function trackNavigation(view: string, meta?: Record<string, unknown>) {
  setTelemetryView(view)
  trackEvent('navigation', 'route_view', { view, targetId: view, meta })
}

export function startFlow(flowName: string, meta?: Record<string, unknown>): string {
  const flowId = nextId('flow')
  activeFlows.set(flowId, { flowName, startedAt: performance.now(), meta })
  trackEvent('flow', 'flow_start', {
    flowId,
    flowName,
    status: 'in_progress',
    meta,
  })
  return flowId
}

export function endFlow(
  flowId: string | null | undefined,
  status: 'ok' | 'abandoned' | 'error' | 'timeout' = 'ok',
  meta?: Record<string, unknown>,
) {
  if (!flowId) return
  const active = activeFlows.get(flowId)
  if (!active) return
  activeFlows.delete(flowId)
  const durationMs = Math.max(0, Math.round(performance.now() - active.startedAt))
  const eventName = status === 'abandoned' ? 'flow_abandon' : status === 'error' || status === 'timeout' ? 'flow_error' : 'flow_end'
  trackEvent('flow', eventName, {
    flowId,
    flowName: active.flowName,
    status,
    durationMs,
    meta: { ...(active.meta || {}), ...(meta || {}) },
  })
}

export function trackPlayerEvent(
  name: string,
  fields: {
    durationMs?: number
    status?: 'ok' | 'abandoned' | 'error' | 'timeout'
    targetId?: string
    meta?: Record<string, unknown>
  } = {},
) {
  trackEvent('player', name, fields)
}

function extractTargetLabel(el: HTMLElement): string {
  const explicit = el.getAttribute('data-track-id') || el.getAttribute('aria-label') || el.getAttribute('title')
  if (explicit) return explicit.trim().slice(0, 80)
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 80)
  return el.tagName.toLowerCase()
}

/** Installs global click auto-capture, /api/* fetch latency tracking, and flow-abandon flush on exit. */
export function installGlobalTelemetry() {
  if (typeof window === 'undefined' || installed) return
  installed = true

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null
      const clickable = target?.closest?.('button, a, [role="button"], [data-track-id]') as HTMLElement | null
      if (!clickable) return
      const targetId = extractTargetLabel(clickable)
      const now = Date.now()
      const prev = recentClickMap.get(targetId)
      const rapidCount = prev && now - prev.lastAt < 2000 ? prev.count + 1 : 1
      recentClickMap.set(targetId, { count: rapidCount, lastAt: now })

      trackEvent('interaction', 'ui_click', {
        targetId,
        rapidCount,
        meta: {
          tag: clickable.tagName.toLowerCase(),
          isRepeated: rapidCount >= 2,
        },
      })
    },
    { capture: true },
  )

  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!rawUrl.startsWith('/api/') || rawUrl.startsWith('/api/telemetry')) {
      return nativeFetch(input, init)
    }
    const endpoint = rawUrl.split('?')[0]
    const method = (init?.method || 'GET').toUpperCase()
    const startedAt = performance.now()
    try {
      const res = await nativeFetch(input, init)
      const durationMs = Math.round(performance.now() - startedAt)
      trackEvent('api', 'api_timing', {
        targetId: `${method} ${endpoint}`,
        durationMs,
        status: res.ok ? 'ok' : 'error',
        meta: { statusCode: res.status },
      })
      return res
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt)
      trackEvent('api', 'api_timing', {
        targetId: `${method} ${endpoint}`,
        durationMs,
        status: 'error',
        meta: { message: err instanceof Error ? err.message : 'fetch_error' },
      })
      throw err
    }
  }

  window.addEventListener('pagehide', () => {
    for (const flowId of [...activeFlows.keys()]) {
      endFlow(flowId, 'abandoned', { reason: 'pagehide' })
    }
    flushTelemetry(true)
  })
}
