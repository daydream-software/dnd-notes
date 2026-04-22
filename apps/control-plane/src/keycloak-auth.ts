import { createPublicKey, verify } from 'node:crypto'

interface JwtHeader {
  alg?: string
  kid?: string
}

interface ClientAccess {
  roles?: string[]
}

interface JwtClaims {
  aud?: string | string[]
  azp?: string
  exp?: number
  iss?: string
  nbf?: number
  realm_access?: {
    roles?: string[]
  }
  resource_access?: Record<string, ClientAccess>
}

interface KeycloakJwk {
  kid?: string
  kty?: string
  n?: string
  e?: string
}

interface KeycloakJwksResponse {
  keys?: KeycloakJwk[]
}

export class ControlPlaneAuthError extends Error {
  constructor(
    readonly statusCode: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'ControlPlaneAuthError'
  }
}

export interface ControlPlaneAdminAuth {
  mode: 'static' | 'keycloak'
  authorizeBearerToken(token: string): Promise<void>
}

interface CreateControlPlaneAdminAuthOptions {
  clientId?: string
  issuer?: string
  jwksUrl?: string
  keycloakRealm?: string
  keycloakUrl?: string
  mode?: string
  requiredRoles?: readonly string[]
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
    throw new ControlPlaneAuthError(401, 'Unauthorized')
  }
}

function matchesClient(claims: JwtClaims, clientId: string) {
  const audienceMatches =
    typeof claims.aud === 'string'
      ? claims.aud === clientId
      : Array.isArray(claims.aud)
        ? claims.aud.includes(clientId)
        : false
  const authorizedPartyMatches =
    claims.azp === undefined ? true : claims.azp === clientId

  return audienceMatches && authorizedPartyMatches
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
    throw new ControlPlaneAuthError(401, 'Unauthorized')
  }

  if (!response.ok) {
    throw new ControlPlaneAuthError(401, 'Unauthorized')
  }

  const payload = (await response.json()) as KeycloakJwksResponse
  const jwk = payload.keys?.find((candidate) => candidate.kid === keyId)

  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw new ControlPlaneAuthError(401, 'Unauthorized')
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

function validateStandardClaims(claims: JwtClaims, issuer: string, clientId: string) {
  if (claims.iss !== issuer || !matchesClient(claims, clientId)) {
    throw new ControlPlaneAuthError(401, 'Unauthorized')
  }

  const now = Math.floor(Date.now() / 1000)

  if (
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    (typeof claims.nbf === 'number' && claims.nbf > now + 30)
  ) {
    throw new ControlPlaneAuthError(401, 'Unauthorized')
  }
}

function buildKeycloakEndpoints(options: CreateControlPlaneAdminAuthOptions) {
  if (options.issuer && options.jwksUrl && options.clientId) {
    return {
      clientId: options.clientId,
      issuer: options.issuer,
      jwksUrl: options.jwksUrl,
    }
  }

  if (!options.keycloakUrl || !options.keycloakRealm || !options.clientId) {
    throw new Error(
      'CONTROL_PLANE_AUTH_MODE=keycloak requires CONTROL_PLANE_KEYCLOAK_URL, CONTROL_PLANE_KEYCLOAK_REALM, and CONTROL_PLANE_KEYCLOAK_CLIENT_ID.',
    )
  }

  const issuer = `${normalizeBaseUrl(options.keycloakUrl)}/realms/${options.keycloakRealm}`
  return {
    clientId: options.clientId,
    issuer,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
  }
}

export function createControlPlaneAdminAuth(
  options: CreateControlPlaneAdminAuthOptions = {},
): ControlPlaneAdminAuth {
  const mode = options.mode === 'keycloak' ? 'keycloak' : 'static'

  if (mode === 'static') {
    return {
      mode,
      async authorizeBearerToken() {
        throw new ControlPlaneAuthError(401, 'Unauthorized')
      },
    }
  }

  const { clientId, issuer, jwksUrl } = buildKeycloakEndpoints(options)
  const normalizedRequiredRoles =
    options.requiredRoles?.map((role) => role.trim()).filter((role) => role.length > 0) ?? []
  const requiredRoles =
    normalizedRequiredRoles.length > 0
      ? normalizedRequiredRoles
      : ['control-plane-admin', 'control-plane-workforce']

  return {
    mode,
    async authorizeBearerToken(token) {
      const parts = token.split('.')

      if (parts.length !== 3) {
        throw new ControlPlaneAuthError(401, 'Unauthorized')
      }

      const [headerSegment, payloadSegment, signatureSegment] = parts
      const header = parseJwtSection<JwtHeader>(headerSegment)
      const claims = parseJwtSection<JwtClaims>(payloadSegment)

      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
        throw new ControlPlaneAuthError(401, 'Unauthorized')
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
        throw new ControlPlaneAuthError(401, 'Unauthorized')
      }

      const clientRoles = claims.resource_access?.[clientId]?.roles ?? []
      const realmRoles = claims.realm_access?.roles ?? []
      const effectiveRoles = new Set([...realmRoles, ...clientRoles])

      if (!requiredRoles.some((role) => effectiveRoles.has(role))) {
        throw new ControlPlaneAuthError(403, 'Forbidden')
      }
    },
  }
}
