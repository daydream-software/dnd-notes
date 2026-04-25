import {
  KeycloakJwtVerificationError,
  normalizeBaseUrl,
  verifyToken,
  type JwtClaims,
} from '@dnd-notes/keycloak-jwt'

export interface KeycloakIdentity {
  keycloakSub: string
  email: string
  displayName: string
}

interface TenantJwtClaims extends JwtClaims {
  email?: string
  name?: string
  preferred_username?: string
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

const INVALID_TOKEN_MESSAGE = 'Owner access token is invalid or expired.'

function deriveDisplayName(claims: TenantJwtClaims): string {
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

function buildKeycloakEndpoints(options: CreateTenantRuntimeAuthOptions) {
  if (!options.clientId) {
    throw new Error(
      'AUTH_MODE=keycloak requires KEYCLOAK_URL, KEYCLOAK_REALM, and KEYCLOAK_TENANT_CLIENT_ID.',
    )
  }

  const issuer =
    options.issuer ??
    (options.keycloakUrl && options.keycloakRealm
      ? `${normalizeBaseUrl(options.keycloakUrl)}/realms/${options.keycloakRealm}`
      : undefined)

  if (!issuer) {
    throw new Error(
      'AUTH_MODE=keycloak requires KEYCLOAK_URL, KEYCLOAK_REALM, and KEYCLOAK_TENANT_CLIENT_ID.',
    )
  }

  return {
    clientId: options.clientId,
    issuer,
    jwksUrl: options.jwksUrl ?? `${issuer}/protocol/openid-connect/certs`,
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
        throw new KeycloakTokenValidationError(401, INVALID_TOKEN_MESSAGE)
      },
    }
  }

  const { clientId, issuer, jwksUrl } = buildKeycloakEndpoints(options)
  const keycloakUrl = normalizeBaseUrl(
    options.keycloakUrl ?? issuer.replace(/\/realms\/[^/]+$/, ''),
  )
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
      let claims: TenantJwtClaims

      try {
        const result = await verifyToken<TenantJwtClaims>(token, {
          issuer,
          audience: clientId,
          jwksUrl,
          notBeforeSkewSec: 30,
        })
        claims = result.claims
      } catch (error) {
        if (error instanceof KeycloakJwtVerificationError) {
          throw new KeycloakTokenValidationError(401, INVALID_TOKEN_MESSAGE)
        }
        throw error
      }

      if (typeof claims.sub !== 'string' || claims.sub.trim() === '') {
        throw new KeycloakTokenValidationError(401, INVALID_TOKEN_MESSAGE)
      }

      if (typeof claims.email !== 'string' || claims.email.trim() === '') {
        throw new KeycloakTokenValidationError(401, INVALID_TOKEN_MESSAGE)
      }

      return {
        keycloakSub: claims.sub,
        email: claims.email,
        displayName: deriveDisplayName(claims),
      }
    },
  }
}
