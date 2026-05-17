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
  resource_access?: Record<string, { roles?: string[] } | undefined>
}

/**
 * Per-tenant client role expected on every authenticated Keycloak token. The
 * role lives on the per-tenant Keycloak client (`dnd-notes-tenant-{tenantId}`)
 * and is created + assigned by the control-plane at provisioning time (#196).
 * Tokens that pass signature/issuer/audience validation but lack this role
 * are rejected with HTTP 403 — the user is authenticated but not authorized
 * for this tenant.
 */
const tenantMemberRoleName = 'tenant-member'

const FORBIDDEN_TOKEN_MESSAGE =
  'Your account is not authorized for this tenant. The tenant owner must grant you access.'

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
  authConfig: {
    keycloak: {
      url: string
      realm: string
      clientId: string
    }
  }
  authenticateBearerToken(token: string): Promise<KeycloakIdentity>
}

interface CreateTenantRuntimeAuthOptions {
  clientId?: string
  issuer?: string
  jwksUrl?: string
  keycloakRealm?: string
  keycloakUrl?: string
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
      'Keycloak auth requires KEYCLOAK_URL, KEYCLOAK_REALM, and KEYCLOAK_TENANT_CLIENT_ID.',
    )
  }

  const issuer =
    options.issuer ??
    (options.keycloakUrl && options.keycloakRealm
      ? `${normalizeBaseUrl(options.keycloakUrl)}/realms/${options.keycloakRealm}`
      : undefined)

  if (!issuer) {
    throw new Error(
      'Keycloak auth requires KEYCLOAK_URL, KEYCLOAK_REALM, and KEYCLOAK_TENANT_CLIENT_ID.',
    )
  }

  return {
    clientId: options.clientId,
    issuer,
    jwksUrl: options.jwksUrl ?? `${issuer}/protocol/openid-connect/certs`,
  }
}

/**
 * Stub runtime auth that always rejects with 401. Used as the createApp
 * default and in tests that don't need a real Keycloak issuer — every
 * authenticated route returns "Owner access token is invalid or expired."
 * without ever touching the network.
 */
export function createStubTenantRuntimeAuth(): TenantRuntimeAuth {
  return {
    authConfig: {
      keycloak: { url: '', realm: '', clientId: '' },
    },
    async authenticateBearerToken() {
      throw new KeycloakTokenValidationError(401, INVALID_TOKEN_MESSAGE)
    },
  }
}

export function createTenantRuntimeAuth(
  options: CreateTenantRuntimeAuthOptions = {},
): TenantRuntimeAuth {
  const { clientId, issuer, jwksUrl } = buildKeycloakEndpoints(options)
  const keycloakUrl = normalizeBaseUrl(
    options.keycloakUrl ?? issuer.replace(/\/realms\/[^/]+$/, ''),
  )
  const keycloakRealm = options.keycloakRealm ?? issuer.split('/realms/')[1] ?? ''

  return {
    authConfig: {
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

      // Per-tenant role gate (#196): the token must carry the
      // `tenant-member` role under `resource_access[clientId].roles` of the
      // per-tenant Keycloak client. The control-plane creates the role at
      // provisioning time and assigns it to the tenant creator. Without it
      // the token is valid (signature/issuer/audience all checked above)
      // but the user has not been granted access to this tenant — return
      // 403 with a distinguishable message so the front-end can prompt
      // the user to claim or request access.
      const clientRoles = claims.resource_access?.[clientId]?.roles ?? []
      if (!clientRoles.includes(tenantMemberRoleName)) {
        throw new KeycloakTokenValidationError(403, FORBIDDEN_TOKEN_MESSAGE)
      }

      return {
        keycloakSub: claims.sub,
        email: claims.email,
        displayName: deriveDisplayName(claims),
      }
    },
  }
}
