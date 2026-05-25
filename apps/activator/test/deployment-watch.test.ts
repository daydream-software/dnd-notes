/**
 * Tests for the DeploymentWatcher getReplicas cache-miss → API GET fallback
 * (acceptance criterion from issue #340).
 *
 * Uses injected fake clients — does not import @kubernetes/client-node.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeReconnectDelay,
  createDeploymentWatcher,
  type AppsV1ApiLike,
  type CoreV1ApiLike,
  type WatchLike,
} from '../src/deployment-watch.js'

/**
 * Capturing Watch fake: records the event + done callbacks per path so a test
 * can feed Watch events by hand. watch() returns a never-resolving promise,
 * which parks the watch loop on a live stream so it does not re-loop.
 */
function makeCapturingWatch(): WatchLike & {
  emit(path: string, type: string, obj: unknown): void
} {
  const handlers = new Map<string, (type: string, obj: unknown) => void>()
  return {
    watch(path, _params, callback) {
      handlers.set(path, callback)
      return new Promise<unknown>(() => {})
    },
    emit(path, type, obj) {
      const cb = handlers.get(path)
      if (!cb) throw new Error(`no watch registered for ${path}`)
      cb(type, obj)
    },
  }
}

const DEPLOYMENTS_PATH = '/apis/apps/v1/deployments'
const ENDPOINTS_PATH = '/api/v1/endpoints'

/** Yield to the microtask queue so the watch loops reach their watch() call. */
function flush(): Promise<void> {
  return Promise.resolve()
}

/** Minimal CoreV1Api fake — the getReplicas tests don't exercise it */
function makeCoreFake(): CoreV1ApiLike {
  return {
    async listNamespacedPod() {
      return { items: [] }
    },
    async readNamespacedEndpoints() {
      return { subsets: [] }
    },
  }
}

/** Minimal AppsV1Api fake — the getReadyAddresses tests don't exercise it. */
function makeAppsFake(): AppsV1ApiLike {
  return {
    async readNamespacedDeployment() {
      return { spec: { replicas: 1 } }
    },
    async patchNamespacedDeployment() {
      return {}
    },
  }
}

describe('DeploymentWatcher.getReplicas', () => {
  it('cache miss calls readNamespacedDeployment once and returns spec.replicas', async () => {
    let callCount = 0
    const appsApi: AppsV1ApiLike = {
      async readNamespacedDeployment({ name, namespace }) {
        callCount += 1
        assert.equal(name, 'dnd-notes')
        assert.equal(namespace, 'tenant-abc')
        return { spec: { replicas: 0 } }
      },
      async patchNamespacedDeployment() {
        return {}
      },
    }

    const watcher = createDeploymentWatcher({ appsApi, coreApi: makeCoreFake(), readinessPollIntervalMs: 10 })

    const replicas = await watcher.getReplicas('tenant-abc', 'dnd-notes')
    assert.equal(replicas, 0)
    assert.equal(callCount, 1)

    watcher.stop()
  })

  it('second call for the same tenant returns from cache without a second API call', async () => {
    let callCount = 0
    const appsApi: AppsV1ApiLike = {
      async readNamespacedDeployment() {
        callCount += 1
        return { spec: { replicas: 2 } }
      },
      async patchNamespacedDeployment() {
        return {}
      },
    }

    const watcher = createDeploymentWatcher({ appsApi, coreApi: makeCoreFake(), readinessPollIntervalMs: 10 })

    const first = await watcher.getReplicas('tenant-xyz', 'dnd-notes')
    const second = await watcher.getReplicas('tenant-xyz', 'dnd-notes')

    assert.equal(first, 2)
    assert.equal(second, 2)
    assert.equal(callCount, 1, 'API should only be called once; second result comes from cache')

    watcher.stop()
  })

  it('different tenants populate independent cache entries', async () => {
    const replicasByNs: Record<string, number> = {
      'tenant-alpha': 1,
      'tenant-beta': 3,
    }
    const callsByNs: Record<string, number> = {}

    const appsApi: AppsV1ApiLike = {
      async readNamespacedDeployment({ namespace }) {
        callsByNs[namespace] = (callsByNs[namespace] ?? 0) + 1
        return { spec: { replicas: replicasByNs[namespace] ?? 0 } }
      },
      async patchNamespacedDeployment() {
        return {}
      },
    }

    const watcher = createDeploymentWatcher({ appsApi, coreApi: makeCoreFake(), readinessPollIntervalMs: 10 })

    const alpha1 = await watcher.getReplicas('tenant-alpha', 'dnd-notes')
    const beta1 = await watcher.getReplicas('tenant-beta', 'dnd-notes')
    // Second reads should hit cache
    const alpha2 = await watcher.getReplicas('tenant-alpha', 'dnd-notes')
    const beta2 = await watcher.getReplicas('tenant-beta', 'dnd-notes')

    assert.equal(alpha1, 1)
    assert.equal(beta1, 3)
    assert.equal(alpha2, 1)
    assert.equal(beta2, 3)
    assert.equal(callsByNs['tenant-alpha'], 1)
    assert.equal(callsByNs['tenant-beta'], 1)

    watcher.stop()
  })

  it('patchReplicas updates the cache so the next getReplicas returns the patched value without an API call', async () => {
    let getCalls = 0
    const appsApi: AppsV1ApiLike = {
      async readNamespacedDeployment() {
        getCalls += 1
        return { spec: { replicas: 0 } }
      },
      async patchNamespacedDeployment() {
        return {}
      },
    }

    const watcher = createDeploymentWatcher({ appsApi, coreApi: makeCoreFake(), readinessPollIntervalMs: 10 })

    // Populate the cache with 0
    await watcher.getReplicas('tenant-p', 'dnd-notes')
    assert.equal(getCalls, 1)

    // Patch to 1 — should update the local cache
    await watcher.patchReplicas('tenant-p', 'dnd-notes', 1)

    // Next read should come from cache, not the API
    const replicas = await watcher.getReplicas('tenant-p', 'dnd-notes')
    assert.equal(replicas, 1)
    assert.equal(getCalls, 1, 'patchReplicas must update the cache; no extra API GET should occur')

    watcher.stop()
  })

  it('getReplicas rejects when the API throws (tenant does not exist in K8s)', async () => {
    const appsApi: AppsV1ApiLike = {
      async readNamespacedDeployment({ namespace }) {
        const err = new Error(`deployments.apps "dnd-notes" not found in namespace ${namespace}`)
        Object.assign(err, { statusCode: 404 })
        throw err
      },
      async patchNamespacedDeployment() {
        return {}
      },
    }

    const watcher = createDeploymentWatcher({ appsApi, coreApi: makeCoreFake(), readinessPollIntervalMs: 10 })

    await assert.rejects(
      () => watcher.getReplicas('tenant-missing', 'dnd-notes'),
      /not found/,
    )

    watcher.stop()
  })
})

describe('DeploymentWatcher cache prune on DELETED (#382)', () => {
  it('a DELETED Deployment event removes the key from replicaCache', async () => {
    let getCalls = 0
    const appsApi: AppsV1ApiLike = {
      async readNamespacedDeployment() {
        getCalls += 1
        return { spec: { replicas: 5 } }
      },
      async patchNamespacedDeployment() {
        return {}
      },
    }
    const fakeWatch = makeCapturingWatch()
    const watcher = createDeploymentWatcher({
      appsApi,
      coreApi: makeCoreFake(),
      watch: fakeWatch,
      sleep: async () => {},
    })
    watcher.start()
    await flush()

    // ADDED populates the cache: getReplicas serves it without an API GET.
    fakeWatch.emit(DEPLOYMENTS_PATH, 'ADDED', {
      metadata: { namespace: 'tenant-d', name: 'dnd-notes' },
      spec: { replicas: 2 },
    })
    assert.equal(await watcher.getReplicas('tenant-d', 'dnd-notes'), 2)
    assert.equal(getCalls, 0, 'value came from the cache, not the API')

    // DELETED prunes the key: the next read misses and falls back to the API.
    fakeWatch.emit(DEPLOYMENTS_PATH, 'DELETED', {
      metadata: { namespace: 'tenant-d', name: 'dnd-notes' },
    })
    assert.equal(await watcher.getReplicas('tenant-d', 'dnd-notes'), 5)
    assert.equal(getCalls, 1, 'DELETED must have pruned the cache, forcing an API fallback')

    watcher.stop()
  })

  it('a DELETED Endpoints event removes the key from readyAddressCache', async () => {
    let epCalls = 0
    const coreApi: CoreV1ApiLike = {
      async listNamespacedPod() {
        return { items: [] }
      },
      async readNamespacedEndpoints() {
        epCalls += 1
        return { subsets: [] } // not ready
      },
    }
    const appsApi: AppsV1ApiLike = {
      async readNamespacedDeployment() {
        return { spec: { replicas: 1 } }
      },
      async patchNamespacedDeployment() {
        return {}
      },
    }
    const fakeWatch = makeCapturingWatch()
    const watcher = createDeploymentWatcher({
      appsApi,
      coreApi,
      watch: fakeWatch,
      sleep: async () => {},
      readinessPollIntervalMs: 5,
    })
    watcher.start()
    await flush()

    // ADDED with a ready address: waitForReadyEndpoint resolves from the cache.
    fakeWatch.emit(ENDPOINTS_PATH, 'ADDED', {
      metadata: { namespace: 'tenant-e', name: 'dnd-notes' },
      subsets: [{ addresses: [{ ip: '10.0.0.1' }] }],
    })
    assert.equal(
      await watcher.waitForReadyEndpoint('tenant-e', 'dnd-notes', 'dnd-notes', 1000, () => {}),
      true,
    )
    assert.equal(epCalls, 0, 'readiness came from the cache, not the API')

    // DELETED prunes the key: readiness now misses and falls back to the API,
    // which reports not-ready, so the wait times out.
    fakeWatch.emit(ENDPOINTS_PATH, 'DELETED', {
      metadata: { namespace: 'tenant-e', name: 'dnd-notes' },
    })
    assert.equal(
      await watcher.waitForReadyEndpoint('tenant-e', 'dnd-notes', 'dnd-notes', 20, () => {}),
      false,
    )
    assert.ok(epCalls > 0, 'DELETED must have pruned the cache, forcing an API fallback')

    watcher.stop()
  })
})

describe('computeReconnectDelay (#355)', () => {
  const noJitter = () => 0.5 // jitter factor 1.0 → exact base values

  it('returns the base delay at zero or one consecutive failures', () => {
    assert.equal(computeReconnectDelay(0, { baseMs: 1000, capMs: 30_000, random: noJitter }), 1000)
    assert.equal(computeReconnectDelay(1, { baseMs: 1000, capMs: 30_000, random: noJitter }), 1000)
  })

  it('doubles on each further consecutive failure', () => {
    assert.equal(computeReconnectDelay(2, { baseMs: 1000, capMs: 30_000, random: noJitter }), 2000)
    assert.equal(computeReconnectDelay(3, { baseMs: 1000, capMs: 30_000, random: noJitter }), 4000)
    assert.equal(computeReconnectDelay(4, { baseMs: 1000, capMs: 30_000, random: noJitter }), 8000)
  })

  it('caps the delay at capMs', () => {
    assert.equal(computeReconnectDelay(50, { baseMs: 1000, capMs: 30_000, random: noJitter }), 30_000)
  })

  it('applies +/-20% jitter within band for any random value', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const d = computeReconnectDelay(2, { baseMs: 1000, capMs: 30_000, random: () => r })
      assert.ok(d >= 1600 && d <= 2400, `delay ${d} must be within +/-20% of 2000`)
    }
    // Extremes map to the band edges.
    assert.equal(computeReconnectDelay(2, { baseMs: 1000, capMs: 30_000, random: () => 0 }), 1600)
    assert.equal(computeReconnectDelay(2, { baseMs: 1000, capMs: 30_000, random: () => 1 }), 2400)
  })
})

describe('DeploymentWatcher reconnect backoff loop (#355)', () => {
  it('escalates the delay on consecutive connect failures and resets on a successful connect', async () => {
    // Scripted outcomes for the Deployments watch loop; the Endpoints loop
    // parks on a never-resolving promise so only one loop drives the delays.
    const outcomes = ['fail', 'fail', 'fail', 'ok']
    let i = 0
    const delays: number[] = []
    let resolveDone!: () => void
    const done = new Promise<void>((r) => {
      resolveDone = r
    })

    const fakeWatch: WatchLike = {
      watch(path, _params, _callback, doneCb) {
        if (path !== DEPLOYMENTS_PATH) return new Promise<unknown>(() => {})
        const outcome = outcomes[Math.min(i, outcomes.length - 1)]
        i += 1
        if (outcome === 'fail') doneCb(new Error('connect refused'))
        return Promise.resolve(undefined)
      },
    }

    const watcher = createDeploymentWatcher({
      appsApi: { async readNamespacedDeployment() { return {} }, async patchNamespacedDeployment() { return {} } },
      coreApi: makeCoreFake(),
      watch: fakeWatch,
      watchReconnectDelayMs: 1000,
      reconnectCapMs: 30_000,
      random: () => 0.5, // jitter factor 1.0 → exact values
      sleep: async (ms) => {
        delays.push(ms)
        if (delays.length >= 5) {
          watcher.stop()
          resolveDone()
        }
      },
    })
    watcher.start()
    await done

    // Three failures escalate, then the successful connect resets to base.
    assert.deepEqual(delays.slice(0, 4), [1000, 2000, 4000, 1000])
    // The reset delay is strictly below the pre-reset peak.
    assert.ok(delays[3] < delays[2], 'a successful connect must reset the backoff')

    watcher.stop()
  })
})

describe('DeploymentWatcher.getReadyAddresses (peek)', () => {
  it('cache miss: one API GET, returns the ready-address count', async () => {
    let calls = 0
    const coreApi: CoreV1ApiLike = {
      async listNamespacedPod() {
        return { items: [] }
      },
      async readNamespacedEndpoints() {
        calls += 1
        return { subsets: [{ addresses: [{}, {}] }] }
      },
    }
    const watcher = createDeploymentWatcher({ appsApi: makeAppsFake(), coreApi })

    assert.equal(await watcher.getReadyAddresses('tenant-r', 'dnd-notes'), 2)
    // Second call is served from cache — no second API GET.
    assert.equal(await watcher.getReadyAddresses('tenant-r', 'dnd-notes'), 2)
    assert.equal(calls, 1, 'ready-address count must be cached after the first GET')

    watcher.stop()
  })

  it('returns 0 when the Endpoints object is missing (tenant not up yet)', async () => {
    const coreApi: CoreV1ApiLike = {
      async listNamespacedPod() {
        return { items: [] }
      },
      async readNamespacedEndpoints() {
        throw Object.assign(new Error('not found'), { statusCode: 404 })
      },
    }
    const watcher = createDeploymentWatcher({ appsApi: makeAppsFake(), coreApi })

    assert.equal(await watcher.getReadyAddresses('tenant-missing', 'dnd-notes'), 0)

    watcher.stop()
  })
})
