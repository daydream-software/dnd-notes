import { createServer } from 'node:http'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'

interface FakeKeycloakTokenOptions {
  audience?: string | string[]
  clientId: string
  email?: string
  expiresInSeconds?: number
  issuer?: string
  notBeforeOffsetSeconds?: number
  roles?: string[]
  subject?: string
  userName?: string
}

function encodeBase64Url(value: Buffer | string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export async function startFakeKeycloakServer(realm = 'dnd-notes-test') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const keyId = `kid-${randomUUID()}`
  const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, string>
  const server = createServer((request, response) => {
    if (request.url === `/realms/${realm}/protocol/openid-connect/certs`) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          keys: [
            {
              ...publicJwk,
              alg: 'RS256',
              kid: keyId,
              use: 'sig',
            },
          ],
        }),
      )
      return
    }

    response.writeHead(404)
    response.end()
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Fake Keycloak server did not bind to a TCP port.')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`
  const issuer = `${baseUrl}/realms/${realm}`

  return {
    baseUrl,
    issuer,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    },
    issueToken({
      audience,
      clientId,
      email = 'owner@example.com',
      expiresInSeconds = 300,
      issuer: tokenIssuer = issuer,
      notBeforeOffsetSeconds = 0,
      roles = [],
      subject = randomUUID(),
      userName = 'Owner User',
    }: FakeKeycloakTokenOptions) {
      const now = Math.floor(Date.now() / 1000)
      const header = {
        alg: 'RS256',
        kid: keyId,
        typ: 'JWT',
      }
      const payload = {
        iss: tokenIssuer,
        sub: subject,
        aud: audience ?? [clientId, 'account'],
        azp: clientId,
        email,
        exp: now + expiresInSeconds,
        iat: now,
        nbf: now + notBeforeOffsetSeconds,
        name: userName,
        preferred_username: email,
        resource_access:
          roles.length > 0
            ? {
                [clientId]: {
                  roles,
                },
              }
            : undefined,
      }
      const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(
        JSON.stringify(payload),
      )}`
      const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey)

      return `${signingInput}.${encodeBase64Url(signature)}`
    },
  }
}
