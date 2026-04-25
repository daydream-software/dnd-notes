import assert from 'node:assert/strict'
import { createHmac, createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import test, { afterEach } from 'node:test'

import {
  KeycloakJwtVerificationError,
  clearJwkCache,
  verifyToken,
} from '../src/index.js'

interface FakeRsaSigner {
  baseUrl: string
  jwksUrl: string
  issuer: string
  kid: string
  signRs256: (header: Record<string, unknown>, payload: Record<string, unknown>) => string
  setKid: (newKid: string) => void
  fetchCount: () => number
  close: () => Promise<void>
}

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function startFakeJwks(realm = 'test-realm'): Promise<FakeRsaSigner> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, string>
  let kid = `kid-${randomUUID()}`
  let fetchCount = 0

  const server: Server = createServer((req, res) => {
    if (req.url === `/realms/${realm}/protocol/openid-connect/certs`) {
      fetchCount += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          keys: [{ ...publicJwk, alg: 'RS256', kid, use: 'sig' }],
        }),
      )
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  const issuer = `${baseUrl}/realms/${realm}`

  return {
    baseUrl,
    issuer,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
    get kid() {
      return kid
    },
    setKid(newKid: string) {
      kid = newKid
    },
    fetchCount() {
      return fetchCount
    },
    signRs256(header, payload) {
      const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(
        JSON.stringify(payload),
      )}`
      const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey)
      return `${signingInput}.${encodeBase64Url(signature)}`
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function makeClaims(issuer: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: issuer,
    sub: 'subject-1',
    aud: 'account',
    azp: 'test-client',
    email: 'user@example.com',
    iat: now,
    exp: now + 300,
    nbf: now,
    ...overrides,
  }
}

afterEach(() => {
  clearJwkCache()
})

test('verifyToken accepts a well-formed RS256 JWT and returns parsed claims/header', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  const token = fake.signRs256(
    { alg: 'RS256', kid: fake.kid, typ: 'JWT' },
    makeClaims(fake.issuer),
  )

  const { header, claims } = await verifyToken(token, {
    issuer: fake.issuer,
    audience: 'test-client',
    jwksUrl: fake.jwksUrl,
  })

  assert.equal(header.alg, 'RS256')
  assert.equal(claims.sub, 'subject-1')
  assert.equal(claims.azp, 'test-client')
})

test('verifyToken caches the public key per (jwksUrl, kid) and skips repeat JWKS fetches', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  const token = fake.signRs256(
    { alg: 'RS256', kid: fake.kid, typ: 'JWT' },
    makeClaims(fake.issuer),
  )

  await verifyToken(token, {
    issuer: fake.issuer,
    audience: 'test-client',
    jwksUrl: fake.jwksUrl,
  })
  await verifyToken(token, {
    issuer: fake.issuer,
    audience: 'test-client',
    jwksUrl: fake.jwksUrl,
  })

  assert.equal(fake.fetchCount(), 1)
})

test('verifyToken refetches JWKS when a new kid rotates in', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  const firstKid = fake.kid
  const tokenA = fake.signRs256(
    { alg: 'RS256', kid: firstKid, typ: 'JWT' },
    makeClaims(fake.issuer),
  )
  await verifyToken(tokenA, {
    issuer: fake.issuer,
    audience: 'test-client',
    jwksUrl: fake.jwksUrl,
  })
  assert.equal(fake.fetchCount(), 1)

  const rotatedKid = `kid-${randomUUID()}`
  fake.setKid(rotatedKid)
  const tokenB = fake.signRs256(
    { alg: 'RS256', kid: rotatedKid, typ: 'JWT' },
    makeClaims(fake.issuer),
  )

  await verifyToken(tokenB, {
    issuer: fake.issuer,
    audience: 'test-client',
    jwksUrl: fake.jwksUrl,
  })
  assert.equal(fake.fetchCount(), 2)
})

test('verifyToken rejects an expired token with code "expired"', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  const now = Math.floor(Date.now() / 1000)
  const token = fake.signRs256(
    { alg: 'RS256', kid: fake.kid, typ: 'JWT' },
    makeClaims(fake.issuer, { iat: now - 600, exp: now - 60, nbf: now - 600 }),
  )

  await assert.rejects(
    verifyToken(token, {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError && error.code === 'expired',
  )
})

test('verifyToken rejects a token whose audience/azp does not match', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  const token = fake.signRs256(
    { alg: 'RS256', kid: fake.kid, typ: 'JWT' },
    makeClaims(fake.issuer, { aud: 'other-client', azp: 'other-client' }),
  )

  await assert.rejects(
    verifyToken(token, {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError &&
      error.code === 'wrong_audience',
  )
})

test('verifyToken rejects a token whose issuer does not match', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  const token = fake.signRs256(
    { alg: 'RS256', kid: fake.kid, typ: 'JWT' },
    makeClaims(fake.issuer, { iss: 'https://evil.example.com/realms/spoofed' }),
  )

  await assert.rejects(
    verifyToken(token, {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError &&
      error.code === 'wrong_issuer',
  )
})

test('verifyToken rejects non-RS256 algorithms via the alg allowlist', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  const header = { alg: 'HS256', kid: fake.kid, typ: 'JWT' }
  const payload = makeClaims(fake.issuer)
  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(
    JSON.stringify(payload),
  )}`
  const signature = createHmac('sha256', 'shared-secret').update(signingInput).digest()
  const hsToken = `${signingInput}.${encodeBase64Url(signature)}`

  await assert.rejects(
    verifyToken(hsToken, {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError &&
      error.code === 'unsupported_alg',
  )

  const noneHeader = { alg: 'none', kid: fake.kid, typ: 'JWT' }
  const noneInput = `${encodeBase64Url(JSON.stringify(noneHeader))}.${encodeBase64Url(
    JSON.stringify(payload),
  )}`
  const noneToken = `${noneInput}.`

  await assert.rejects(
    verifyToken(noneToken, {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError &&
      error.code === 'unsupported_alg',
  )
})

test('verifyToken rejects malformed tokens (wrong segment count, missing kid)', async (t) => {
  const fake = await startFakeJwks()
  t.after(() => fake.close())

  await assert.rejects(
    verifyToken('not.a.valid.token', {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError && error.code === 'malformed',
  )

  const tokenWithoutKid = fake.signRs256(
    { alg: 'RS256', typ: 'JWT' },
    makeClaims(fake.issuer),
  )
  await assert.rejects(
    verifyToken(tokenWithoutKid, {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError && error.code === 'malformed',
  )
})

test('verifyToken surfaces jwks_fetch_failed when the JWKS endpoint is unreachable', async (t) => {
  const fake = await startFakeJwks()
  await fake.close()

  const token = fake.signRs256(
    { alg: 'RS256', kid: fake.kid, typ: 'JWT' },
    makeClaims(fake.issuer),
  )

  await assert.rejects(
    verifyToken(token, {
      issuer: fake.issuer,
      audience: 'test-client',
      jwksUrl: fake.jwksUrl,
    }),
    (error: unknown) =>
      error instanceof KeycloakJwtVerificationError &&
      error.code === 'jwks_fetch_failed',
  )
  t.diagnostic('Confirmed JWKS fetch failure surfaces as jwks_fetch_failed')
})
