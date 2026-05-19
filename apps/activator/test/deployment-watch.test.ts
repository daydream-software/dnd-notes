/**
 * Tests for the DeploymentWatcher getReplicas cache-miss → API GET fallback
 * (acceptance criterion from issue #340).
 *
 * Uses injected fake clients — does not import @kubernetes/client-node.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDeploymentWatcher, type AppsV1ApiLike, type CoreV1ApiLike } from '../src/deployment-watch.js'

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
