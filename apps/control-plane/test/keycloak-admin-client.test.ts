import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  KeycloakAdminClient,
  KeycloakAdminError,
  type KeycloakClientSpec,
} from '../src/keycloak-admin-client.js'

interface FakeServerState {
  tokenRequests: number
  adminRequests: Array<{ method: string; path: string; body: string }>
  clients: Record<string, KeycloakClientSpec & { id: string }>
  /** Map of `${clientInternalId}/${roleName}` → role record. */
  clientRoles: Record<string, { id: string; name: string }>
  /** Map of `${userId}/${clientInternalId}` → list of assigned role records. */
  userClientRoleMappings: Record<string, Array<{ id: string; name: string }>>
  /** Map of email → Keycloak user record. */
  usersByEmail: Record<string, { id: string; email?: string }>
  /** Override: when true, GET role responds 404 even if the role exists in `clientRoles`. */
  forceRoleGetMiss?: boolean
  /** Override: when true, POST role responds with the configured status. */
  roleCreateResponse?: { status: number; body?: object }
  /** Override: when set, GET /users responds with this status + raw body. */
  usersResponse?: { status: number; body: string }
  tokenResponse?: { status: number; body: object }
  adminResponse?: { status: number; body: object }
}

const TEST_REALM = 'test-realm'
const TEST_CLIENT_ID = 'test-admin-client'
const TEST_CLIENT_SECRET = 'test-admin-secret'
const ACCESS_TOKEN = 'fake-access-token'

async function startFakeKeycloakAdminServer(state: FakeServerState) {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })

    request.on('end', () => {
      const url = request.url ?? ''
      const method = request.method ?? 'GET'

      // Token endpoint
      if (url === `/realms/${TEST_REALM}/protocol/openid-connect/token`) {
        state.tokenRequests++

        if (state.tokenResponse) {
          response.writeHead(state.tokenResponse.status, { 'content-type': 'application/json' })
          response.end(JSON.stringify(state.tokenResponse.body))
          return
        }

        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            access_token: ACCESS_TOKEN,
            expires_in: 300,
          }),
        )
        return
      }

      // Role-mapping endpoints (`/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUUID}`)
      const roleMappingPattern = new RegExp(
        `^/admin/realms/${TEST_REALM}/users/([^/]+)/role-mappings/clients/([^/]+)$`,
      )
      const roleMappingMatch = url.match(roleMappingPattern)
      if (roleMappingMatch) {
        state.adminRequests.push({ method, path: url, body })
        const userId = decodeURIComponent(roleMappingMatch[1] ?? '')
        const clientInternalId = roleMappingMatch[2] ?? ''
        const mappingKey = `${userId}/${clientInternalId}`

        if (method === 'POST') {
          let assignments: Array<{ id: string; name: string }>

          try {
            assignments = JSON.parse(body) as Array<{ id: string; name: string }>
          } catch {
            response.writeHead(400)
            response.end()
            return
          }

          state.userClientRoleMappings[mappingKey] = [
            ...(state.userClientRoleMappings[mappingKey] ?? []),
            ...assignments,
          ]
          response.writeHead(204)
          response.end()
          return
        }

        response.writeHead(405)
        response.end()
        return
      }

      // Users-by-email lookup (`/admin/realms/{realm}/users?email=<email>&exact=true`).
      // Mirrors the subset of the Keycloak admin REST API consumed by
      // `KeycloakAdminClient.findUserByEmail`.
      if (
        method === 'GET' &&
        url.startsWith(`/admin/realms/${TEST_REALM}/users?`)
      ) {
        state.adminRequests.push({ method, path: url, body })

        if (state.usersResponse) {
          response.writeHead(state.usersResponse.status, {
            'content-type': 'application/json',
          })
          response.end(state.usersResponse.body)
          return
        }

        const params = new URLSearchParams(url.split('?')[1])
        const email = params.get('email') ?? ''
        const found = state.usersByEmail[email]
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(found ? [found] : []))
        return
      }

      // Per-client role endpoints (`/admin/realms/{realm}/clients/{clientUUID}/roles[/{roleName}]`)
      const clientRolesPattern = new RegExp(
        `^/admin/realms/${TEST_REALM}/clients/([^/]+)/roles(?:/([^/?]+))?$`,
      )
      const clientRolesMatch = url.match(clientRolesPattern)
      if (clientRolesMatch) {
        state.adminRequests.push({ method, path: url, body })
        const clientInternalId = clientRolesMatch[1] ?? ''
        const roleName = clientRolesMatch[2]
          ? decodeURIComponent(clientRolesMatch[2])
          : undefined
        const roleKey = `${clientInternalId}/${roleName ?? ''}`

        if (method === 'GET' && roleName) {
          if (state.forceRoleGetMiss) {
            response.writeHead(404)
            response.end()
            return
          }

          const role = state.clientRoles[roleKey]

          if (role) {
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end(JSON.stringify(role))
          } else {
            response.writeHead(404)
            response.end()
          }

          return
        }

        if (method === 'POST' && !roleName) {
          if (state.roleCreateResponse) {
            response.writeHead(state.roleCreateResponse.status, {
              'content-type': 'application/json',
            })
            response.end(JSON.stringify(state.roleCreateResponse.body ?? {}))
            return
          }

          let payload: { name?: string }
          try {
            payload = JSON.parse(body) as { name?: string }
          } catch {
            response.writeHead(400)
            response.end()
            return
          }

          if (!payload.name) {
            response.writeHead(400)
            response.end()
            return
          }

          const newRoleKey = `${clientInternalId}/${payload.name}`

          if (state.clientRoles[newRoleKey]) {
            response.writeHead(409)
            response.end()
            return
          }

          state.clientRoles[newRoleKey] = {
            id: `role-id-${payload.name}`,
            name: payload.name,
          }
          response.writeHead(201)
          response.end()
          return
        }

        response.writeHead(405)
        response.end()
        return
      }

      // Admin clients list endpoint
      if (url.startsWith(`/admin/realms/${TEST_REALM}/clients`)) {
        state.adminRequests.push({ method, path: url, body })

        if (state.adminResponse) {
          response.writeHead(state.adminResponse.status, { 'content-type': 'application/json' })
          response.end(JSON.stringify(state.adminResponse.body))
          return
        }

        // Parse clientId query for GET
        if (method === 'GET' && url.includes('?clientId=')) {
          const params = new URLSearchParams(url.split('?')[1])
          const clientId = params.get('clientId') ?? ''
          const found = state.clients[clientId]
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify(found ? [found] : []))
          return
        }

        // GET single client by internal id
        if (method === 'GET') {
          const internalId = url.split('/').pop()
          const found = Object.values(state.clients).find((c) => c.id === internalId)

          if (found) {
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end(JSON.stringify(found))
          } else {
            response.writeHead(404)
            response.end()
          }

          return
        }

        // POST — create
        if (method === 'POST') {
          const spec = JSON.parse(body) as KeycloakClientSpec
          const internalId = `id-${spec.clientId}`
          state.clients[spec.clientId] = { ...spec, id: internalId }
          response.writeHead(201, { location: `/clients/${internalId}` })
          response.end()
          return
        }

        // PUT — update by internal id
        if (method === 'PUT') {
          const internalId = url.split('/').pop() ?? ''
          const spec = JSON.parse(body) as KeycloakClientSpec & { id: string }
          const existing = Object.values(state.clients).find((c) => c.id === internalId)

          if (!existing) {
            response.writeHead(404)
            response.end()
            return
          }

          state.clients[spec.clientId] = { ...spec, id: internalId }
          response.writeHead(204)
          response.end()
          return
        }

        // DELETE by internal id
        if (method === 'DELETE') {
          const internalId = url.split('/').pop() ?? ''
          const key = Object.keys(state.clients).find(
            (k) => state.clients[k]!.id === internalId,
          )

          if (key) {
            delete state.clients[key]
            response.writeHead(204)
          } else {
            response.writeHead(404)
          }

          response.end()
          return
        }

        response.writeHead(405)
        response.end()
        return
      }

      response.writeHead(404)
      response.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Fake server did not bind to a TCP port.')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

function makeClient(baseUrl: string) {
  return new KeycloakAdminClient({
    baseUrl,
    realm: TEST_REALM,
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
  })
}

describe('KeycloakAdminClient', () => {
  let state: FakeServerState
  let server: Awaited<ReturnType<typeof startFakeKeycloakAdminServer>> | undefined

  beforeEach(() => {
    state = {
      tokenRequests: 0,
      adminRequests: [],
      clients: {},
      clientRoles: {},
      userClientRoleMappings: {},
      usersByEmail: {},
    }
  })

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  describe('getClient', () => {
    it('returns null when the client does not exist', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)

      const result = await client.getClient('nonexistent-client')

      assert.equal(result, null)
    })

    it('returns the client spec when it exists', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.clients['existing-client'] = {
        id: 'id-existing-client',
        clientId: 'existing-client',
        enabled: true,
        publicClient: true,
      }
      const client = makeClient(server.baseUrl)

      const result = await client.getClient('existing-client')

      assert.ok(result)
      assert.equal(result.clientId, 'existing-client')
      assert.equal(result.id, 'id-existing-client')
    })
  })

  describe('ensureClient', () => {
    it('creates a new client when it does not exist', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)
      const spec: KeycloakClientSpec = {
        clientId: 'my-new-client',
        enabled: true,
        publicClient: true,
      }

      await client.ensureClient(spec)

      assert.ok(state.clients['my-new-client'])
      assert.equal(state.clients['my-new-client']!.clientId, 'my-new-client')
      // POST was called
      const postReq = state.adminRequests.find((r) => r.method === 'POST')
      assert.ok(postReq)
    })

    it('is idempotent — updates an existing client via PUT on second call', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)
      const spec: KeycloakClientSpec = {
        clientId: 'my-client',
        enabled: true,
        publicClient: true,
        redirectUris: ['https://example.com/*'],
      }

      // First call creates
      await client.ensureClient(spec)
      assert.ok(state.clients['my-client'])

      // Second call with updated spec should PUT
      const updatedSpec: KeycloakClientSpec = {
        ...spec,
        redirectUris: ['https://example.com/*', 'https://example.org/*'],
      }
      await client.ensureClient(updatedSpec)

      const putReq = state.adminRequests.find((r) => r.method === 'PUT')
      assert.ok(putReq, 'expected a PUT request for update')
      assert.deepEqual(state.clients['my-client']!.redirectUris, [
        'https://example.com/*',
        'https://example.org/*',
      ])
    })

    it('does not duplicate clients — only one entry per clientId', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)
      const spec: KeycloakClientSpec = { clientId: 'stable-client', enabled: true }

      await client.ensureClient(spec)
      await client.ensureClient(spec)
      await client.ensureClient(spec)

      const clientEntries = Object.keys(state.clients).filter((k) => k === 'stable-client')
      assert.equal(clientEntries.length, 1)
    })

    it('skips PUT when spec already matches the existing client', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const spec: KeycloakClientSpec = {
        clientId: 'synced-client',
        enabled: true,
        publicClient: true,
        redirectUris: ['https://example.com/*'],
        webOrigins: ['https://example.com'],
      }
      // Pre-seed with an existing client that already matches the spec.
      // Include extra fields Keycloak would carry that are not in the spec.
      state.clients['synced-client'] = {
        ...spec,
        id: 'id-synced-client',
        protocol: 'openid-connect',
        defaultClientScopes: ['web-origins', 'profile'],
      }
      const client = makeClient(server.baseUrl)

      await client.ensureClient(spec)

      // No PUT should have been issued — the spec was already in sync.
      const putReq = state.adminRequests.find((r) => r.method === 'PUT')
      assert.equal(putReq, undefined, 'expected no PUT when spec matches existing client')
    })

    it('still PUTs when at least one spec field differs from the existing client', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const existingSpec: KeycloakClientSpec = {
        clientId: 'drifted-client',
        enabled: true,
        publicClient: true,
        redirectUris: ['https://old.example.com/*'],
      }
      state.clients['drifted-client'] = { ...existingSpec, id: 'id-drifted-client' }
      const client = makeClient(server.baseUrl)

      // Call with a different redirectUris — must trigger a PUT.
      await client.ensureClient({
        ...existingSpec,
        redirectUris: ['https://new.example.com/*'],
      })

      const putReq = state.adminRequests.find((r) => r.method === 'PUT')
      assert.ok(putReq, 'expected a PUT when a spec field differs from existing')
      assert.deepEqual(state.clients['drifted-client']!.redirectUris, [
        'https://new.example.com/*',
      ])
    })

    it('throws KeycloakAdminError when Keycloak returns an error status', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.adminResponse = { status: 500, body: { error: 'server error' } }
      const client = makeClient(server.baseUrl)

      await assert.rejects(
        () => client.ensureClient({ clientId: 'bad-client' }),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 500)
          return true
        },
      )
    })
  })

  describe('deleteClient', () => {
    it('deletes an existing client', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.clients['to-delete'] = { id: 'id-to-delete', clientId: 'to-delete', enabled: true }
      const client = makeClient(server.baseUrl)

      await client.deleteClient('to-delete')

      assert.equal(state.clients['to-delete'], undefined)
    })

    it('is a no-op when the client does not exist', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)

      // Should not throw
      await client.deleteClient('nonexistent')

      const deleteReq = state.adminRequests.find((r) => r.method === 'DELETE')
      assert.equal(deleteReq, undefined)
    })
  })

  describe('ensureClientRole (#196 per-tenant role gate)', () => {
    it('creates the role when it does not exist on the client', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.clients['parent-client'] = {
        id: 'id-parent-client',
        clientId: 'parent-client',
        enabled: true,
      }
      const client = makeClient(server.baseUrl)

      await client.ensureClientRole('parent-client', 'tenant-member')

      assert.ok(state.clientRoles['id-parent-client/tenant-member'])
      assert.equal(
        state.clientRoles['id-parent-client/tenant-member']?.name,
        'tenant-member',
      )
      // POST should have been issued.
      const postReq = state.adminRequests.find(
        (r) => r.method === 'POST' && r.path.endsWith('/roles'),
      )
      assert.ok(postReq)
    })

    it('is a no-op when the role already exists (idempotent)', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.clients['parent-client'] = {
        id: 'id-parent-client',
        clientId: 'parent-client',
        enabled: true,
      }
      state.clientRoles['id-parent-client/tenant-member'] = {
        id: 'role-id-tenant-member',
        name: 'tenant-member',
      }
      const client = makeClient(server.baseUrl)

      await client.ensureClientRole('parent-client', 'tenant-member')

      // No POST issued — only the GET role probe.
      const postReq = state.adminRequests.find(
        (r) => r.method === 'POST' && r.path.endsWith('/roles'),
      )
      assert.equal(postReq, undefined)
    })

    it('treats a 409 on POST as a successful no-op (concurrent create race)', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.clients['parent-client'] = {
        id: 'id-parent-client',
        clientId: 'parent-client',
        enabled: true,
      }
      // Force the GET to miss so the wrapper falls through to POST, but POST
      // returns 409 — simulating another provisioner creating the role
      // between our GET and POST.
      state.forceRoleGetMiss = true
      state.roleCreateResponse = { status: 409, body: { error: 'conflict' } }
      const client = makeClient(server.baseUrl)

      // Must not throw.
      await client.ensureClientRole('parent-client', 'tenant-member')
    })

    it('throws KeycloakAdminError when the parent client does not exist', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)

      await assert.rejects(
        () => client.ensureClientRole('missing-client', 'tenant-member'),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 404)
          return true
        },
      )
    })
  })

  describe('assignClientRoleToUser (#196 per-tenant role gate)', () => {
    it('issues a POST role-mapping with the resolved role id and name', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.clients['parent-client'] = {
        id: 'id-parent-client',
        clientId: 'parent-client',
        enabled: true,
      }
      state.clientRoles['id-parent-client/tenant-member'] = {
        id: 'role-id-tenant-member',
        name: 'tenant-member',
      }
      const client = makeClient(server.baseUrl)

      await client.assignClientRoleToUser(
        'kc-user-sub-123',
        'parent-client',
        'tenant-member',
      )

      const mapping = state.userClientRoleMappings['kc-user-sub-123/id-parent-client']
      assert.ok(mapping)
      assert.equal(mapping?.length, 1)
      assert.equal(mapping?.[0]?.id, 'role-id-tenant-member')
      assert.equal(mapping?.[0]?.name, 'tenant-member')
    })

    it('throws KeycloakAdminError when the role cannot be resolved', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.clients['parent-client'] = {
        id: 'id-parent-client',
        clientId: 'parent-client',
        enabled: true,
      }
      // No role registered.
      const client = makeClient(server.baseUrl)

      await assert.rejects(
        () => client.assignClientRoleToUser('any-user', 'parent-client', 'tenant-member'),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 404)
          return true
        },
      )
    })

    it('is naturally idempotent — assigning the same role twice produces two POSTs but no errors', async () => {
      // Keycloak itself returns 204 for already-assigned mappings; the fake
      // server appends to a list per call. The wrapper does not de-duplicate;
      // it relies on Keycloak to be the source of truth. Assert the wrapper
      // does not throw on repeated assignment.
      server = await startFakeKeycloakAdminServer(state)
      state.clients['parent-client'] = {
        id: 'id-parent-client',
        clientId: 'parent-client',
        enabled: true,
      }
      state.clientRoles['id-parent-client/tenant-member'] = {
        id: 'role-id-tenant-member',
        name: 'tenant-member',
      }
      const client = makeClient(server.baseUrl)

      await client.assignClientRoleToUser('user-1', 'parent-client', 'tenant-member')
      await client.assignClientRoleToUser('user-1', 'parent-client', 'tenant-member')

      // Two POSTs were issued; both succeeded.
      const postReqs = state.adminRequests.filter(
        (r) => r.method === 'POST' && r.path.includes('/role-mappings/clients/'),
      )
      assert.equal(postReqs.length, 2)
    })
  })

  describe('token caching', () => {
    it('reuses the cached token for multiple calls', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)

      await client.getClient('client-a')
      await client.getClient('client-b')
      await client.getClient('client-c')

      // Token endpoint should be called only once
      assert.equal(state.tokenRequests, 1)
    })

    it('throws KeycloakAdminError when the token endpoint is unreachable', async () => {
      // Use a port that is not listening
      const client = new KeycloakAdminClient({
        baseUrl: 'http://127.0.0.1:1',
        realm: TEST_REALM,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
      })

      await assert.rejects(
        () => client.getClient('any-client'),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 0)
          return true
        },
      )
    })

    it('throws KeycloakAdminError when the token endpoint returns a non-200 status', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.tokenResponse = { status: 401, body: { error: 'unauthorized_client' } }
      const client = makeClient(server.baseUrl)

      await assert.rejects(
        () => client.getClient('any-client'),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 401)
          return true
        },
      )
    })
  })

  describe('findUserByEmail (#196 / #200 admin-tenant role gate)', () => {
    it('returns the matching user id when Keycloak finds a user by email', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.usersByEmail['owner@example.com'] = {
        id: 'kc-user-owner',
        email: 'owner@example.com',
      }
      const client = makeClient(server.baseUrl)

      const result = await client.findUserByEmail('owner@example.com')

      assert.deepEqual(result, { id: 'kc-user-owner' })
      const userReq = state.adminRequests.find((r) =>
        r.path.startsWith(`/admin/realms/${TEST_REALM}/users?`),
      )
      assert.ok(userReq, 'expected GET /users request')
      // exact=true is required so partial matches do not return a wrong user.
      assert.match(userReq.path, /[?&]exact=true(?:&|$)/)
      // The email is URL-encoded.
      assert.match(userReq.path, /email=owner%40example\.com/)
    })

    it('returns null when no user matches the email', async () => {
      server = await startFakeKeycloakAdminServer(state)
      const client = makeClient(server.baseUrl)

      const result = await client.findUserByEmail('missing@example.com')

      assert.equal(result, null)
    })

    it('throws KeycloakAdminError when Keycloak returns a non-2xx status', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.usersResponse = { status: 503, body: '' }
      const client = makeClient(server.baseUrl)

      await assert.rejects(
        () => client.findUserByEmail('owner@example.com'),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 503)
          return true
        },
      )
    })

    it('throws KeycloakAdminError when the response payload is not JSON', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.usersResponse = { status: 200, body: 'not-json' }
      const client = makeClient(server.baseUrl)

      await assert.rejects(
        () => client.findUserByEmail('owner@example.com'),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 0)
          return true
        },
      )
    })

    it('throws KeycloakAdminError when the matched user has no id field', async () => {
      server = await startFakeKeycloakAdminServer(state)
      state.usersResponse = {
        status: 200,
        body: JSON.stringify([{ email: 'owner@example.com' }]),
      }
      const client = makeClient(server.baseUrl)

      await assert.rejects(
        () => client.findUserByEmail('owner@example.com'),
        (error) => {
          assert.ok(error instanceof KeycloakAdminError)
          assert.equal(error.statusCode, 0)
          return true
        },
      )
    })
  })
})
