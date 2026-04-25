import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { createTestApp, registerOwner, withAuth } from './test-helpers.js'

const controlPlaneToken = 'test-control-plane-token'
const authHeader = `Bearer ${controlPlaneToken}`

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
