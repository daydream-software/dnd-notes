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
}

function makeWatcher(opts: WatcherStubOptions) {
  const calls: string[] = []
  const watcher = {
    start: () => {},
    stop: () => {},
    getReplicas: async () => opts.replicas,
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
    config: { coldStartTimeoutMs: 60_000 },
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
    await handler(makeReq(), res)
    // Let the fire-and-forget markReady microtask settle.
    await Promise.resolve()

    assert.deepEqual(watcherCalls, ['patchReplicas', 'waitForReadyEndpoint'])
    assert.deepEqual(proxyCalls, [COORDS.upstreamUrl])
    assert.ok(storeCalls.includes('markReady'), 'a successful wake must mark the tenant ready (#385)')
  })

  it('replicas 0 + never ready: answers 503 cold_start_timeout, no proxy', async () => {
    const { watcher } = makeWatcher({ replicas: 0, ready: false })
    const { store } = makeActivityStore()
    const { metrics, calls: metricCalls } = makeMetrics()
    const { handler, proxyCalls } = buildHandler({ watcher, activityStore: store, metrics })

    const res = makeRes()
    await handler(makeReq(), res)

    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['Retry-After'], '10')
    assert.match(res.body, /cold_start_timeout/)
    assert.deepEqual(proxyCalls, [])
    assert.ok(metricCalls.includes('error:cold_start_timeout'))
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
    const p1 = handler(makeReq(), res1)
    const p2 = handler(makeReq(), res2)

    resolveReady(true)
    await Promise.all([p1, p2])

    const patchCount = watcherCalls.filter((c) => c === 'patchReplicas').length
    assert.equal(patchCount, 1, 'concurrent wakes must coalesce to one patchReplicas')
    assert.deepEqual(proxyCalls, [COORDS.upstreamUrl, COORDS.upstreamUrl])
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
      config: { coldStartTimeoutMs: 60_000 },
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
