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
})
