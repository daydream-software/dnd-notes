import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import {
  ControlPlaneAuthError,
  type ControlPlaneAdminAuth,
} from '../src/keycloak-auth.js'
import type { KeycloakUserSummary } from '../src/keycloak-admin-client.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'
import type { TenantRegistry } from '../src/tenant-registry.js'

/**
 * Minimal ControlPlaneAdminAuth fake for keycloak mode.
 * `authorizeBearerToken` calls the provided callback so tests can
 * control whether the token is accepted (pass), rejected with 401
 * (throw ControlPlaneAuthError 401), or rejected with 403 (throw
 * ControlPlaneAuthError 403).
 */
function createTestAdminAuth(
  authorize: (token: string) => Promise<void>,
): ControlPlaneAdminAuth {
  return {
    mode: 'keycloak',
    authorizeBearerToken: authorize,
  }
}

/**
 * Minimal AppKeycloakAdminClient fake for the searchUsers surface.
 */
function createTestKeycloakAdminClient(opts: {
  searchUsers: (q: string) => Promise<KeycloakUserSummary[]>
}) {
  return {
    assignClientRoleToUser: async () => {
      // not used in these tests
    },
    searchUsers: opts.searchUsers,
  }
}

describe('GET /internal/keycloak-users', () => {
  const adminToken = 'test-admin-token'
  let tenantRegistry: TenantRegistry
  let cleanupTenantRegistry: (() => Promise<void>) | undefined

  beforeEach(() => {
    const registry = createTestTenantRegistry()
    tenantRegistry = registry.tenantRegistry
    cleanupTenantRegistry = registry.cleanup
  })

  afterEach(async () => {
    await cleanupTenantRegistry?.()
    cleanupTenantRegistry = undefined
  })

  it('returns 400 when q is missing', async () => {
    const app = createApp({
      tenantRegistry,
      adminToken,
      keycloakAdminClient: createTestKeycloakAdminClient({
        searchUsers: async () => [],
      }),
    })

    const response = await request(app)
      .get('/internal/keycloak-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)

    assert.ok(
      typeof response.body.error === 'string' && response.body.error.length > 0,
      'error message should be present',
    )
  })

  it('returns 400 when q is empty after trim', async () => {
    const app = createApp({
      tenantRegistry,
      adminToken,
      keycloakAdminClient: createTestKeycloakAdminClient({
        searchUsers: async () => [],
      }),
    })

    const response = await request(app)
      .get('/internal/keycloak-users?q=   ')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)

    assert.ok(
      typeof response.body.error === 'string' && response.body.error.length > 0,
      'error message should be present',
    )
  })

  it('returns 401 when no bearer token is provided', async () => {
    const app = createApp({
      tenantRegistry,
      adminToken,
    })

    const response = await request(app)
      .get('/internal/keycloak-users?q=alice')
      .expect(401)

    assert.ok(response.body.error)
  })

  it('returns 403 when the token is valid but lacks operator role', async () => {
    const adminAuth = createTestAdminAuth(async () => {
      throw new ControlPlaneAuthError(403, 'Forbidden')
    })

    const app = createApp({
      tenantRegistry,
      adminToken: undefined,
      adminAuth,
      keycloakAdminClient: createTestKeycloakAdminClient({
        searchUsers: async () => [],
      }),
    })

    const response = await request(app)
      .get('/internal/keycloak-users?q=alice')
      .set('Authorization', 'Bearer some-valid-jwt-without-role')
      .expect(403)

    assert.ok(response.body.error)
  })

  it('returns mapped users on happy path', async () => {
    const mockUsers: KeycloakUserSummary[] = [
      {
        id: 'kc-uuid-1',
        username: 'alice',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
      },
      {
        id: 'kc-uuid-2',
        username: 'alicia',
        email: undefined,
        firstName: undefined,
        lastName: undefined,
      },
    ]

    const app = createApp({
      tenantRegistry,
      adminToken,
      keycloakAdminClient: createTestKeycloakAdminClient({
        searchUsers: async (q) => {
          assert.strictEqual(q, 'alice')
          return mockUsers
        },
      }),
    })

    const response = await request(app)
      .get('/internal/keycloak-users?q=alice')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    assert.ok(Array.isArray(response.body), 'body should be an array')
    assert.strictEqual(response.body.length, 2)

    const first = response.body[0] as KeycloakUserSummary
    assert.strictEqual(first.id, 'kc-uuid-1')
    assert.strictEqual(first.username, 'alice')
    assert.strictEqual(first.email, 'alice@example.com')
    assert.strictEqual(first.firstName, 'Alice')
    assert.strictEqual(first.lastName, 'Smith')

    // Verify no extra Keycloak attributes are leaked.
    const allowedKeys = new Set(['id', 'username', 'email', 'firstName', 'lastName'])
    for (const user of response.body as object[]) {
      for (const key of Object.keys(user)) {
        assert.ok(allowedKeys.has(key), `unexpected key "${key}" in response`)
      }
    }
  })

  it('returns 500 with sanitized message when Keycloak upstream fails', async () => {
    const app = createApp({
      tenantRegistry,
      adminToken,
      keycloakAdminClient: createTestKeycloakAdminClient({
        searchUsers: async () => {
          throw new Error('Connection refused — internal Keycloak detail that must not leak')
        },
      }),
    })

    const response = await request(app)
      .get('/internal/keycloak-users?q=alice')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(500)

    assert.ok(
      typeof response.body.error === 'string' && response.body.error.length > 0,
      'sanitized error message should be present',
    )
    // The upstream error message must not appear in the response.
    assert.ok(
      !JSON.stringify(response.body).includes('Connection refused'),
      'upstream error detail must not leak to client',
    )
    assert.ok(
      !JSON.stringify(response.body).includes('Keycloak detail'),
      'upstream error detail must not leak to client',
    )
  })

  it('returns 501 when keycloakAdminClient is not configured', async () => {
    const app = createApp({
      tenantRegistry,
      adminToken,
      // keycloakAdminClient intentionally omitted
    })

    const response = await request(app)
      .get('/internal/keycloak-users?q=alice')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(501)

    assert.ok(response.body.error)
  })
})
