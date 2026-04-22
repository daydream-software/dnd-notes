import { createPublicKey, verify } from 'node:crypto'

export interface KeycloakIdentity {
  keycloakSub: string
  email: string
  displayName: string
}

interface JwtHeader {
  alg?: string
  kid?: string
}

interface JwtClaims {
  aud?: string | string[]
  azp?: string
  email?: string
  exp?: number
  iat?: number
  iss?: string
  name?: string
  nbf?: number
  preferred_username?: string
  sub?: string
}

interface KeycloakJwk {
  kid?: string
  kty?: string
  n?: string
  e?: string
  alg?: string
  use?: string
}

interface KeycloakJwksResponse {
  keys?: KeycloakJwk[]
}

export class KeycloakTokenValidationError extends Error {
  constructor(
    readonly statusCode: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'KeycloakTokenValidationError'
  }
}

export interface TenantRuntimeAuth {
  mode: 'local' | 'keycloak'
  authConfig: {
    mode: 'local' | 'keycloak'
    keycloak:
      | {
          url: string
          realm: string
          clientId: string
        }
      | null
  }
  authenticateBearerToken(token: string): Promise<KeycloakIdentity>
}

interface CreateTenantRuntimeAuthOptions {
  clientId?: string
  issuer?: string
  jwksUrl?: string
  keycloakRealm?: string
  keycloakUrl?: string
  mode?: string
}

const jwkCache = new Map<string, ReturnType<typeof createPublicKey>>()

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, 'base64')
}

function parseJwtSection<T>(value: string): T {
  try {
    return JSON.parse(decodeBase64Url(value).toString('utf8')) as T
  } catch {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }
}

function matchesClient(claims: JwtClaims, clientId: string) {
  const audienceMatches =
    typeof claims.aud === 'string'
      ? claims.aud === clientId
      : Array.isArray(claims.aud)
        ? claims.aud.includes(clientId)
        : false

  if (claims.azp !== undefined) {
    return claims.azp === clientId
  }

  return audienceMatches
}

async function readSigningKey(jwksUrl: string, keyId: string) {
  const cacheKey = `${jwksUrl}#${keyId}`
  const cachedKey = jwkCache.get(cacheKey)

  if (cachedKey) {
    return cachedKey
  }

  let response: Response

  try {
    response = await fetch(jwksUrl)
  } catch {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }

  if (!response.ok) {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }

  const payload = (await response.json()) as KeycloakJwksResponse
  const jwk = payload.keys?.find((candidate) => candidate.kid === keyId)

  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }

  const publicKey = createPublicKey({
    key: {
      kty: 'RSA',
      kid: jwk.kid,
      n: jwk.n,
      e: jwk.e,
    },
    format: 'jwk',
  })
  jwkCache.set(cacheKey, publicKey)
  return publicKey
}

function deriveDisplayName(claims: JwtClaims) {
  const preferredName = claims.name?.trim()
  if (preferredName) {
    return preferredName
  }

  const preferredUsername = claims.preferred_username?.trim()
  if (preferredUsername) {
    return preferredUsername
  }

  return claims.email ?? 'Keycloak user'
}

function validateStandardClaims(claims: JwtClaims, issuer: string, clientId: string) {
  if (claims.iss !== issuer || !matchesClient(claims, clientId)) {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }

  const now = Math.floor(Date.now() / 1000)

  if (
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    (typeof claims.nbf === 'number' && claims.nbf > now + 30)
  ) {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }

  if (typeof claims.sub !== 'string' || claims.sub.trim() === '') {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }

  if (typeof claims.email !== 'string' || claims.email.trim() === '') {
    throw new KeycloakTokenValidationError(
      401,
      'Owner access token is invalid or expired.',
    )
  }
}

function buildKeycloakEndpoints(options: CreateTenantRuntimeAuthOptions) {
  if (options.issuer && options.jwksUrl && options.clientId) {
    return {
      clientId: options.clientId,
      issuer: options.issuer,
      jwksUrl: options.jwksUrl,
    }
  }

  if (!options.keycloakUrl || !options.keycloakRealm || !options.clientId) {
    throw new Error(
      'AUTH_MODE=keycloak requires KEYCLOAK_URL, KEYCLOAK_REALM, and KEYCLOAK_TENANT_CLIENT_ID.',
    )
  }

  const issuer = `${normalizeBaseUrl(options.keycloakUrl)}/realms/${options.keycloakRealm}`
  return {
    clientId: options.clientId,
    issuer,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
  }
}

export function createTenantRuntimeAuth(
  options: CreateTenantRuntimeAuthOptions = {},
): TenantRuntimeAuth {
  const mode = options.mode === 'keycloak' ? 'keycloak' : 'local'

  if (mode === 'local') {
    return {
      mode,
      authConfig: {
        mode,
        keycloak: null,
      },
      async authenticateBearerToken() {
        throw new KeycloakTokenValidationError(
          401,
          'Owner access token is invalid or expired.',
        )
      },
    }
  }

  const { clientId, issuer, jwksUrl } = buildKeycloakEndpoints(options)
  const keycloakUrl = normalizeBaseUrl(options.keycloakUrl ?? issuer.replace(/\/realms\/[^/]+$/, ''))
  const keycloakRealm = options.keycloakRealm ?? issuer.split('/realms/')[1] ?? ''

  return {
    mode,
    authConfig: {
      mode,
      keycloak: {
        url: keycloakUrl,
        realm: keycloakRealm,
        clientId,
      },
    },
    async authenticateBearerToken(token) {
      const parts = token.split('.')

      if (parts.length !== 3) {
        throw new KeycloakTokenValidationError(
          401,
          'Owner access token is invalid or expired.',
        )
      }

      const [headerSegment, payloadSegment, signatureSegment] = parts
      const header = parseJwtSection<JwtHeader>(headerSegment)
      const claims = parseJwtSection<JwtClaims>(payloadSegment)

      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
        throw new KeycloakTokenValidationError(
          401,
          'Owner access token is invalid or expired.',
        )
      }

      validateStandardClaims(claims, issuer, clientId)

      const publicKey = await readSigningKey(jwksUrl, header.kid)
      const isValid = verify(
        'RSA-SHA256',
        Buffer.from(`${headerSegment}.${payloadSegment}`),
        publicKey,
        decodeBase64Url(signatureSegment),
      )

      if (!isValid) {
        throw new KeycloakTokenValidationError(
          401,
          'Owner access token is invalid or expired.',
        )
      }

      return {
        keycloakSub: claims.sub as string,
        email: claims.email as string,
        displayName: deriveDisplayName(claims),
      }
    },
  }
}
