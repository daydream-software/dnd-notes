import assert from 'node:assert'
import { describe, it } from 'node:test'
import proxyModule from '../../../scripts/k3d/tenant-api-override-proxy.js'

const { classifyTenantApiOverrideTarget } = proxyModule

describe('tenant API override proxy routing', () => {
  it('routes tenant API and probe paths to the local API process', () => {
    for (const pathname of [
      '/api',
      '/api/auth/config',
      '/api/campaigns',
      '/ready',
      '/readyz',
      '/health',
      '/healthz',
    ]) {
      assert.equal(classifyTenantApiOverrideTarget(pathname), 'local-api')
    }
  })

  it('keeps browser document and asset requests on the k3d tenant host', () => {
    for (const pathname of ['/', '/index.html', '/assets/index.js', '/share/demo']) {
      assert.equal(classifyTenantApiOverrideTarget(pathname), 'tenant-cluster')
    }
  })

  it('normalizes traversal segments before deciding whether a path belongs to the local API', () => {
    assert.equal(classifyTenantApiOverrideTarget('/api/../admin'), 'tenant-cluster')
    assert.equal(
      classifyTenantApiOverrideTarget('/assets/../api/auth/config'),
      'local-api',
    )
  })
})
