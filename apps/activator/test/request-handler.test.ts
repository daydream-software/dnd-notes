/**
 * Behavior tests for the activator request handler (extracted from index.ts so
 * the wake/proxy hot path is testable). These lock the pre-existing behavior:
 * warm passthrough, cold-start wake + proxy, cold-start timeout 503, wake
 * coalescing, and unroutable host.
 */
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it } from 'node:test'
import { createRequestHandler, type RequestHandlerDeps } from '../src/request-handler.js'
import { FONT_PATH, WAKE_STATUS_PATH } from '../src/interstitial.js'
import type { DeploymentWatcher } from '../src/deployment-watch.js'
import type { ActivatorMetrics } from '../src/metrics.js'
import type { TenantActivityStore } from '../src/tenant-activity.js'

const COORDS = {
  namespace: 'tenant-acme',
  deploymentName: 'dnd-notes',
  serviceName: 'dnd-notes',
  upstreamUrl: 'http://dnd-notes.tenant-acme.svc.cluster.local:3000',
  subdomain: 'acme',
}

function makeReq(overrides: Partial<{ method: string; url: string; headers: Record<string, string> }> = {}): IncomingMessage {
  return {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '/',
    headers: overrides.headers ?? { host: 'acme.notes.example.com' },
  } as unknown as IncomingMessage
}

/** A top-level browser navigation (Sec-Fetch-Mode: navigate). */
function navReq(): IncomingMessage {
  return makeReq({ headers: { host: 'acme.notes.example.com', 'sec-fetch-mode': 'navigate' } })
}

/** A non-navigation XHR/API request (Sec-Fetch-Mode: cors). */
function apiReq(): IncomingMessage {
  return makeReq({ headers: { host: 'acme.notes.example.com', 'sec-fetch-mode': 'cors' } })
}

const TEST_CONFIG = { coldStartTimeoutMs: 60_000, graceHoldMs: 2_500, warmingRetryAfterSeconds: 2 }
/** A sleep that never resolves — lets the wake promise win the grace race. */
const neverSleep = () => new Promise<void>(() => {})

interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: string
  headersSent: boolean
  writeHead(status: number, headers?: Record<string, string>): FakeRes
  end(chunk?: string): FakeRes
}

function makeRes(): FakeRes & ServerResponse {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      res.statusCode = status
      if (headers) Object.assign(res.headers, headers)
      res.headersSent = true
      return res
    },
    end(chunk) {
      if (chunk) res.body += chunk
      return res
    },
  }
  return res as unknown as FakeRes & ServerResponse
}

function makeMetrics() {
  const calls: string[] = []
  const metrics = {
    wakeTotal: { inc: () => calls.push('wakeTotal') },
    heldConnections: { inc: () => calls.push('held+'), dec: () => calls.push('held-') },
    coldStartDuration: { observe: () => calls.push('coldStartDuration') },
    podScheduleDeadlineExceeded: { inc: () => calls.push('scheduleDeadline') },
    errorTotal: { inc: (labels: { reason: string }) => calls.push(`error:${labels.reason}`) },
    warmingResponsesTotal: { inc: () => calls.push('warming503') },
    interstitialResponsesTotal: { inc: () => calls.push('interstitial') },
    contentType: 'text/plain',
    metrics: () => 'metrics-text',
  }
  return { metrics: metrics as unknown as ActivatorMetrics, calls }
}

function makeActivityStore() {
  const calls: string[] = []
  const store = {
    recordActivity: async () => {
      calls.push('recordActivity')
    },
    markReady: async () => {
      calls.push('markReady')
    },
    close: async () => {},
  }
  return { store: store as unknown as TenantActivityStore, calls }
}

interface WatcherStubOptions {
  replicas: number
  ready?: boolean
  waitFor?: () => Promise<boolean>
  readyAddresses?: number
}

function makeWatcher(opts: WatcherStubOptions) {
  const calls: string[] = []
  const watcher = {
    start: () => {},
    stop: () => {},
    getReplicas: async () => opts.replicas,
    getReadyAddresses: async () => {
      calls.push('getReadyAddresses')
      return opts.readyAddresses ?? 0
    },
    patchReplicas: async () => {
      calls.push('patchReplicas')
    },
    waitForReadyEndpoint: opts.waitFor
      ? async () => {
          calls.push('waitForReadyEndpoint')
          return opts.waitFor!()
        }
      : async () => {
          calls.push('waitForReadyEndpoint')
          return opts.ready ?? true
        },
  }
  return { watcher: watcher as unknown as DeploymentWatcher, calls }
}

function buildHandler(deps: Partial<RequestHandlerDeps> & {
  watcher: DeploymentWatcher
  activityStore: TenantActivityStore
  metrics: ActivatorMetrics
}) {
  const proxyCalls: string[] = []
  const proxyRequest = (async (_req: unknown, res: { writeHead: (n: number) => void; end: (c?: string) => void }, target: { url: string }) => {
    proxyCalls.push(target.url)
    res.writeHead(200)
    res.end('proxied')
  }) as unknown as RequestHandlerDeps['proxyRequest']

  const handler = createRequestHandler({
    resolver: { resolve: () => COORDS } as unknown as RequestHandlerDeps['resolver'],
    config: TEST_CONFIG,
    proxyRequest,
    ...deps,
  })
  return { handler, proxyCalls }
}

describe('createRequestHandler — warm path', () => {
  it('replicas >= 1: proxies directly, records activity, never patches replicas', async () => {
    const { watcher, calls: watcherCalls } = makeWatcher({ replicas: 1 })
    const { store, calls: storeCalls } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics })

    const res = makeRes()
    await handler(makeReq(), res)

    assert.deepEqual(proxyCalls, [COORDS.upstreamUrl])
    assert.ok(storeCalls.includes('recordActivity'))
    assert.ok(!watcherCalls.includes('patchReplicas'), 'warm tenant must not be patched')
  })
})

describe('createRequestHandler — cold start', () => {
  it('replicas 0 + becomes ready: patches to 1, waits, proxies, marks ready', async () => {
    const { watcher, calls: watcherCalls } = makeWatcher({ replicas: 0, ready: true })
    const { store, calls: storeCalls } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics })

    const res = makeRes()
    await handler(navReq(), res)
    // Let the fire-and-forget markReady microtask settle.
    await Promise.resolve()

    assert.deepEqual(watcherCalls, ['patchReplicas', 'waitForReadyEndpoint'])
    assert.deepEqual(proxyCalls, [COORDS.upstreamUrl])
    assert.ok(storeCalls.includes('markReady'), 'a successful wake must mark the tenant ready (#385)')
  })

  it('navigation, wake fails within grace: serves the branded interstitial, no proxy', async () => {
    const { watcher } = makeWatcher({ replicas: 0, ready: false })
    const { store } = makeActivityStore()
    const { metrics, calls: metricCalls } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics, sleep: neverSleep })

    const res = makeRes()
    await handler(navReq(), res)

    assert.equal(res.statusCode, 200)
    assert.match(res.headers['Content-Type'] ?? '', /text\/html/)
    assert.equal(res.headers['Cache-Control'], 'no-store')
    assert.match(res.body, /Waking your workspace/)
    assert.deepEqual(proxyCalls, [], 'interstitial is served instead of proxying')
    assert.ok(metricCalls.includes('interstitial'))
  })

  it('navigation, grace elapses before the wake resolves: serves the interstitial', async () => {
    // The primary real-world path: the wake is still in flight when the grace
    // window fires. Immediate sleep makes the grace timer win the race.
    const { watcher } = makeWatcher({
      replicas: 0,
      waitFor: () => new Promise<boolean>(() => {}), // never resolves during the test
    })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics, sleep: async () => {} })

    const res = makeRes()
    await handler(navReq(), res)

    assert.equal(res.statusCode, 200)
    assert.match(res.body, /Waking your workspace/)
    assert.deepEqual(proxyCalls, [])
  })

  it('coalesces concurrent cold-start requests into a single wake', async () => {
    let resolveReady!: (value: boolean) => void
    const gate = new Promise<boolean>((resolve) => {
      resolveReady = resolve
    })
    const { watcher, calls: watcherCalls } = makeWatcher({ replicas: 0, waitFor: () => gate })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics })

    const res1 = makeRes()
    const res2 = makeRes()
    const p1 = handler(navReq(), res1)
    const p2 = handler(navReq(), res2)

    resolveReady(true)
    await Promise.all([p1, p2])

    const patchCount = watcherCalls.filter((c) => c === 'patchReplicas').length
    assert.equal(patchCount, 1, 'concurrent wakes must coalesce to one patchReplicas')
    assert.deepEqual(proxyCalls, [COORDS.upstreamUrl, COORDS.upstreamUrl])
  })
})

describe('createRequestHandler — non-navigation grace + warming 503 (#395)', () => {
  it('ready within the grace window: proxies, no 503', async () => {
    const { watcher } = makeWatcher({ replicas: 0, ready: true })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    // neverSleep means the grace timer never fires, so the wake wins the race.
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics, sleep: neverSleep })

    const res = makeRes()
    await handler(apiReq(), res)

    assert.deepEqual(proxyCalls, [COORDS.upstreamUrl])
    assert.notEqual(res.statusCode, 503)
  })

  it('grace elapses before ready: returns a warming 503 marker, wake continues, no proxy', async () => {
    const { watcher, calls: watcherCalls } = makeWatcher({
      replicas: 0,
      waitFor: () => new Promise<boolean>(() => {}), // never ready during the test
    })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    // Immediate sleep makes the grace timer win the race.
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics, sleep: async () => {} })

    const res = makeRes()
    await handler(apiReq(), res)

    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['X-Activator-Wake'], 'warming')
    assert.equal(res.headers['Retry-After'], '2')
    assert.equal(res.headers['Cache-Control'], 'no-store')
    const body = JSON.parse(res.body)
    assert.equal(body.code, 'tenant_waking')
    assert.equal(body.retryable, true)
    assert.deepEqual(proxyCalls, [], 'warming 503 is emitted before proxying')
    assert.equal(watcherCalls.filter((c) => c === 'patchReplicas').length, 1, 'wake kicked exactly once')
  })

  it('wake fails (not ready) before grace: returns a warming 503, not cold_start_timeout', async () => {
    const { watcher } = makeWatcher({ replicas: 0, ready: false })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics, sleep: neverSleep })

    const res = makeRes()
    await handler(apiReq(), res)

    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['X-Activator-Wake'], 'warming')
    assert.match(res.body, /tenant_waking/)
    assert.doesNotMatch(res.body, /cold_start_timeout/)
    assert.deepEqual(proxyCalls, [])
  })

  it('wake error: answers a warming 503 but logs + counts the error (not swallowed)', async () => {
    const { watcher } = makeWatcher({
      replicas: 0,
      waitFor: () => Promise.reject(new Error('rbac denied')),
    })
    const { store } = makeActivityStore()
    const { metrics, calls: metricCalls } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics, sleep: neverSleep })

    const res = makeRes()
    await handler(apiReq(), res)

    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['X-Activator-Wake'], 'warming')
    assert.ok(metricCalls.includes('error:wake_error'), 'a wake exception must be counted, not swallowed')
    assert.deepEqual(proxyCalls, [])
  })
})

describe('createRequestHandler — interstitial support routes (#396)', () => {
  it('wake-status: cold tenant → {ready:false} and (re)kicks the wake', async () => {
    const { watcher, calls: watcherCalls } = makeWatcher({ replicas: 0, readyAddresses: 0 })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler } = buildHandler({ watcher, activityStore: store, metrics })

    const res = makeRes()
    await handler(makeReq({ url: WAKE_STATUS_PATH }), res)

    assert.equal(res.statusCode, 200)
    assert.match(res.headers['Content-Type'] ?? '', /application\/json/)
    assert.deepEqual(JSON.parse(res.body), { ready: false })
    assert.ok(watcherCalls.includes('patchReplicas'), 'a not-ready poll must keep the wake alive')
  })

  it('wake-status: ready tenant → {ready:true} and does not kick a wake', async () => {
    const { watcher, calls: watcherCalls } = makeWatcher({ replicas: 1, readyAddresses: 2 })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler } = buildHandler({ watcher, activityStore: store, metrics })

    const res = makeRes()
    await handler(makeReq({ url: WAKE_STATUS_PATH }), res)

    assert.deepEqual(JSON.parse(res.body), { ready: true })
    assert.ok(!watcherCalls.includes('patchReplicas'), 'a ready tenant must not be re-woken')
  })

  it('font route: serves the woff2 when present', async () => {
    const { watcher } = makeWatcher({ replicas: 1 })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const fontWoff2 = Buffer.from('fake-woff2-bytes')
    const { handler } = buildHandler({ watcher, activityStore: store, metrics, fontWoff2 })

    const res = makeRes()
    await handler(makeReq({ url: FONT_PATH }), res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Content-Type'], 'font/woff2')
    assert.match(res.headers['Cache-Control'] ?? '', /immutable/)
  })

  it('font route: 404 when the asset is absent', async () => {
    const { watcher } = makeWatcher({ replicas: 1 })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler } = buildHandler({ watcher, activityStore: store, metrics })

    const res = makeRes()
    await handler(makeReq({ url: FONT_PATH }), res)

    assert.equal(res.statusCode, 404)
  })
})

describe('createRequestHandler — routing and health', () => {
  it('unroutable host: 400 unroutable_host', async () => {
    const { watcher } = makeWatcher({ replicas: 1 })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const handler = createRequestHandler({
      resolver: { resolve: () => null } as unknown as RequestHandlerDeps['resolver'],
      watcher,
      activityStore: store,
      metrics,
      config: TEST_CONFIG,
    })

    const res = makeRes()
    await handler(makeReq({ headers: { host: 'unknown.example.com' } }), res)

    assert.equal(res.statusCode, 400)
    assert.match(res.body, /unroutable_host/)
  })

  it('GET /healthz returns 200 ok without touching the resolver', async () => {
    const { watcher } = makeWatcher({ replicas: 1 })
    const { store } = makeActivityStore()
    const { metrics } = makeMetrics()
    const { handler } = buildHandler({ watcher, activityStore: store, metrics })

    const res = makeRes()
    await handler(makeReq({ url: '/healthz' }), res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body, 'ok')
  })
})
