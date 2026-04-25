import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import request from 'supertest'
import { createTestApp, registerOwner, withAuth } from './test-helpers.js'

const controlPlaneToken = 'test-control-plane-token'
const authHeader = `Bearer ${controlPlaneToken}`

async function listen(app: http.RequestListener) {
  const server = http.createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()
  assert(address && typeof address === 'object')

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  }
}

async function close(server: http.Server) {
  server.close()
  await once(server, 'close')
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 500, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition')
    }

    await sleep(intervalMs)
  }
}

async function sendJsonRequest({
  origin,
  path,
  method = 'POST',
  body,
  headers = {},
}: {
  origin: string
  path: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
}) {
  return new Promise<{ statusCode?: number; body: unknown }>((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const requestHeaders = payload
      ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload).toString(),
          ...headers,
        }
      : headers

    const clientRequest = http.request(
      `${origin}${path}`,
      {
        method,
        headers: requestHeaders,
      },
      (response) => {
        response.setEncoding('utf8')

        let responseBody = ''
        response.on('data', (chunk) => {
          responseBody += chunk
        })
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            body:
              responseBody.length > 0
                ? (JSON.parse(responseBody) as unknown)
                : null,
          })
        })
        response.on('error', reject)
      },
    )

    clientRequest.on('error', reject)

    if (payload) {
      clientRequest.write(payload)
    }

    clientRequest.end()
  })
}

function startStreamingJsonRequest({
  origin,
  path,
  method = 'POST',
  headers = {},
}: {
  origin: string
  path: string
  method?: string
  headers?: Record<string, string>
}) {
  let clientRequest!: http.ClientRequest
  const responsePromise = new Promise<{ statusCode?: number; body: unknown }>(
    (resolve, reject) => {
      clientRequest = http.request(
        `${origin}${path}`,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
        },
        (response) => {
          response.setEncoding('utf8')

          let responseBody = ''
          response.on('data', (chunk) => {
            responseBody += chunk
          })
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode,
              body:
                responseBody.length > 0
                  ? (JSON.parse(responseBody) as unknown)
                  : null,
            })
          })
          response.on('error', reject)
        },
      )

      clientRequest.on('error', reject)
    },
  )

  return {
    request: clientRequest,
    responsePromise,
  }
}

test('GET /_control/info returns 503 when control plane token is not configured', async () => {
  const { app, cleanup } = await createTestApp({ controlPlaneToken: null })

  try {
    const response = await request(app).get('/_control/info')

    assert.equal(response.status, 503)
    assert.equal(response.body.code, 'control_endpoints_not_configured')
  } finally {
    await cleanup()
  }
})

for (const [description, configuredToken] of [
  ['empty', ''],
  ['whitespace-only', '   '],
] as const) {
  test(`GET /_control/info returns 503 when control plane token is ${description}`, async () => {
    const { app, cleanup } = await createTestApp({
      controlPlaneToken: configuredToken,
    })

    try {
      const response = await request(app)
        .get('/_control/info')
        .set('Authorization', 'Bearer    ')

      assert.equal(response.status, 503)
      assert.equal(response.body.code, 'control_endpoints_not_configured')
    } finally {
      await cleanup()
    }
  })
}

test('GET /_control/info rejects requests without a bearer token', async () => {
  const { app, cleanup } = await createTestApp({ controlPlaneToken })

  try {
    const response = await request(app).get('/_control/info')

    assert.equal(response.status, 401)
    assert.equal(response.body.code, 'control_unauthorized')
  } finally {
    await cleanup()
  }
})

test('GET /_control/info rejects requests with an invalid bearer token', async () => {
  const { app, cleanup } = await createTestApp({ controlPlaneToken })

  try {
    const response = await request(app)
      .get('/_control/info')
      .set('Authorization', 'Bearer wrong-token')

    assert.equal(response.status, 401)
    assert.equal(response.body.code, 'control_unauthorized')
  } finally {
    await cleanup()
  }
})

test('GET /_control/info reports tenant runtime metadata and DB connection state', async () => {
  const { app, cleanup } = await createTestApp({
    controlPlaneToken,
    tenantId: 'tenant-test-1',
    appVersion: '9.9.9',
    schemaVersion: 'v-test',
  })

  try {
    // Trigger a probe so that lastProbeAt becomes populated.
    await request(app).get('/ready').expect(200)

    const response = await request(app)
      .get('/_control/info')
      .set('Authorization', authHeader)

    assert.equal(response.status, 200)
    assert.equal(response.body.tenantId, 'tenant-test-1')
    assert.equal(response.body.appVersion, '9.9.9')
    assert.deepEqual(response.body.schema, { version: 'v-test' })
    assert.equal(response.body.database.state, 'connected')
    assert.deepEqual(response.body.maintenance, {
      mode: 'disabled',
      since: null,
      reason: null,
    })
    assert.equal(typeof response.body.serverTime, 'string')
    assert.equal(typeof response.body.lastProbeAt, 'string')
  } finally {
    await cleanup()
  }
})

test('GET /_control/info reports last-write timestamp after a successful write', async () => {
  const { app, cleanup } = await createTestApp({ controlPlaneToken })

  try {
    await registerOwner(request(app))

    const response = await request(app)
      .get('/_control/info')
      .set('Authorization', authHeader)
      .expect(200)

    assert.equal(typeof response.body.lastWriteAt, 'string')
  } finally {
    await cleanup()
  }
})

test('GET /_control/info does not advance lastWriteAt for an aborted write', async () => {
  const { app, cleanup, controlState } = await createTestApp({ controlPlaneToken })
  let releaseHandler: (() => void) | undefined
  const handlerReleased = new Promise<void>((resolve) => {
    releaseHandler = resolve
  })
  let markStarted: (() => void) | undefined
  const requestStarted = new Promise<void>((resolve) => {
    markStarted = resolve
  })

  app.post('/api/test-abort', async (_request, response) => {
    markStarted?.()
    await handlerReleased

    if (!response.destroyed) {
      response.status(201).json({ ok: true })
    }
  })

  const { server, origin } = await listen(app)

  try {
    const payload = JSON.stringify({})
    const clientRequest = http.request(`${origin}/api/test-abort`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload).toString(),
      },
    })
    clientRequest.on('error', () => {
      // Expected after we abort the client-side connection.
    })
    clientRequest.write(payload)
    clientRequest.end()

    await requestStarted
    clientRequest.destroy()

    await waitUntil(() => controlState.inflightWrites === 0)
    releaseHandler?.()

    const infoResponse = await sendJsonRequest({
      origin,
      path: '/_control/info',
      method: 'GET',
      headers: {
        Authorization: authHeader,
      },
    })

    assert.equal(infoResponse.statusCode, 200)
    assert.equal(
      (infoResponse.body as { lastWriteAt: string | null }).lastWriteAt,
      null,
    )
  } finally {
    releaseHandler?.()
    await close(server)
    await cleanup()
  }
})

test('POST /_control/maintenance enable then disable toggles the maintenance state', async () => {
  const { app, cleanup } = await createTestApp({
    controlPlaneToken,
    maintenanceDrainGraceMs: 0,
  })

  try {
    const enableResponse = await request(app)
      .post('/_control/maintenance')
      .set('Authorization', authHeader)
      .send({ mode: 'enable', reason: 'rolling restart' })

    assert.equal(enableResponse.status, 200)
    assert.equal(enableResponse.body.maintenance.mode, 'enabled')
    assert.equal(enableResponse.body.maintenance.reason, 'rolling restart')
    assert.equal(typeof enableResponse.body.maintenance.since, 'string')
    assert.equal(typeof enableResponse.body.serverTime, 'string')
    assert.ok(
      Date.parse(enableResponse.body.serverTime) >=
        Date.parse(enableResponse.body.maintenance.since),
    )
    assert.equal(enableResponse.body.drained, true)

    const infoDuringMaintenance = await request(app)
      .get('/_control/info')
      .set('Authorization', authHeader)
      .expect(200)
    assert.equal(infoDuringMaintenance.body.maintenance.mode, 'enabled')

    const disableResponse = await request(app)
      .post('/_control/maintenance')
      .set('Authorization', authHeader)
      .send({ mode: 'disable' })

    assert.equal(disableResponse.status, 200)
    assert.equal(disableResponse.body.maintenance.mode, 'disabled')
    assert.equal(disableResponse.body.maintenance.since, null)
    assert.equal(disableResponse.body.maintenance.reason, null)
  } finally {
    await cleanup()
  }
})

test('POST /_control/maintenance drains only writes that started before maintenance mode', async () => {
  const { app, cleanup, controlState } = await createTestApp({
    controlPlaneToken,
    maintenanceDrainGraceMs: 150,
  })

  app.post('/api/test-streamed', (_request, response) => {
    response.status(201).json({ ok: true })
  })

  app.post('/api/test-blocked', (_request, response) => {
    response.status(201).json({ ok: true })
  })

  const { server, origin } = await listen(app)

  const inflightWrite = startStreamingJsonRequest({
    origin,
    path: '/api/test-streamed',
  })

  try {
    inflightWrite.request.write('{"name":"partially-sent')
    await waitUntil(() => controlState.inflightWrites === 1)

    const enableMaintenancePromise = sendJsonRequest({
      origin,
      path: '/_control/maintenance',
      headers: {
        Authorization: authHeader,
      },
      body: { mode: 'enable' },
    })

    await waitUntil(() => controlState.maintenance.mode === 'enabled')
    const drainState = await Promise.race([
      enableMaintenancePromise.then(() => 'resolved'),
      sleep(20).then(() => 'pending'),
    ])
    assert.equal(drainState, 'pending')

    const blockedWritePromise = sendJsonRequest({
      origin,
      path: '/api/test-blocked',
      body: {},
    })
    await sleep(30)
    inflightWrite.request.end('"}')

    const [inflightWriteResponse, enableMaintenanceResponse, blockedWriteResponse] =
      await Promise.all([
        inflightWrite.responsePromise,
        enableMaintenancePromise,
        blockedWritePromise,
      ])

    assert.equal(inflightWriteResponse.statusCode, 201)
    assert.equal(enableMaintenanceResponse.statusCode, 200)
    assert.equal(
      (enableMaintenanceResponse.body as { drained: boolean }).drained,
      true,
    )
    assert.equal(
      (
        enableMaintenanceResponse.body as { inflightWritesRemaining: number }
      ).inflightWritesRemaining,
      0,
    )
    const maintenanceResponseBody = enableMaintenanceResponse.body as {
      maintenance: { since: string | null }
      serverTime: string
    }
    assert.equal(typeof maintenanceResponseBody.maintenance.since, 'string')
    assert.ok(
      Date.parse(maintenanceResponseBody.serverTime) >
        Date.parse(maintenanceResponseBody.maintenance.since),
    )
    assert.equal(blockedWriteResponse.statusCode, 503)
  } finally {
    inflightWrite.request.destroy()
    await close(server)
    await cleanup()
  }
})

test('POST /_control/maintenance rejects invalid mode values', async () => {
  const { app, cleanup } = await createTestApp({ controlPlaneToken })

  try {
    const response = await request(app)
      .post('/_control/maintenance')
      .set('Authorization', authHeader)
      .send({ mode: 'wat' })

    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'invalid_request')
  } finally {
    await cleanup()
  }
})

test('Maintenance mode causes write endpoints to return 503 with stable error code', async () => {
  const { app, cleanup } = await createTestApp({
    controlPlaneToken,
    maintenanceDrainGraceMs: 0,
  })

  try {
    // Register an owner *before* enabling maintenance so we have an authenticated
    // session for the write attempt below.
    const { token } = await registerOwner(request(app))

    await request(app)
      .post('/_control/maintenance')
      .set('Authorization', authHeader)
      .send({ mode: 'enable' })
      .expect(200)

    const writeResponse = await withAuth(request(app), token)
      .post('/api/campaigns')
      .send({
        name: 'New campaign',
        tagline: 'tagline',
        system: 'system',
        setting: 'setting',
        nextSession: null,
      })

    assert.equal(writeResponse.status, 503)
    assert.equal(writeResponse.body.code, 'tenant_in_maintenance')
    assert.equal(writeResponse.headers['retry-after'], '60')

    // Reads still succeed.
    const readResponse = await withAuth(request(app), token).get('/api/notes')
    assert.equal(readResponse.status, 200)

    // Liveness/readiness probes still report green.
    await request(app).get('/healthz').expect(200)
    await request(app).get('/ready').expect(200)
  } finally {
    await cleanup()
  }
})

test('Maintenance mode does not block control-plane endpoints themselves', async () => {
  const { app, cleanup } = await createTestApp({
    controlPlaneToken,
    maintenanceDrainGraceMs: 0,
  })

  try {
    await request(app)
      .post('/_control/maintenance')
      .set('Authorization', authHeader)
      .send({ mode: 'enable' })
      .expect(200)

    // Disable should still go through despite maintenance gating writes.
    await request(app)
      .post('/_control/maintenance')
      .set('Authorization', authHeader)
      .send({ mode: 'disable' })
      .expect(200)
  } finally {
    await cleanup()
  }
})
