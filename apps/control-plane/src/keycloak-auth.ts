import {
  KeycloakJwtVerificationError,
  normalizeBaseUrl,
  verifyToken,
  type JwtClaims,
} from '@dnd-notes/keycloak-jwt'

interface ClientAccess {
  roles?: string[]
}

interface ControlPlaneJwtClaims extends JwtClaims {
  realm_access?: {
    roles?: string[]
  }
  resource_access?: Record<string, ClientAccess>
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

function buildKeycloakEndpoints(options: CreateControlPlaneAdminAuthOptions) {
  if (!options.clientId) {
    throw new Error(
      'CONTROL_PLANE_AUTH_MODE=keycloak requires CONTROL_PLANE_KEYCLOAK_URL, CONTROL_PLANE_KEYCLOAK_REALM, and CONTROL_PLANE_KEYCLOAK_CLIENT_ID.',
    )
  }

  const issuer =
    options.issuer ??
    (options.keycloakUrl && options.keycloakRealm
      ? `${normalizeBaseUrl(options.keycloakUrl)}/realms/${options.keycloakRealm}`
      : undefined)

  if (!issuer) {
    throw new Error(
      'CONTROL_PLANE_AUTH_MODE=keycloak requires CONTROL_PLANE_KEYCLOAK_URL, CONTROL_PLANE_KEYCLOAK_REALM, and CONTROL_PLANE_KEYCLOAK_CLIENT_ID.',
    )
  }

  return {
    clientId: options.clientId,
    issuer,
    jwksUrl: options.jwksUrl ?? `${issuer}/protocol/openid-connect/certs`,
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
      let claims: ControlPlaneJwtClaims

      try {
        const result = await verifyToken<ControlPlaneJwtClaims>(token, {
          issuer,
          audience: clientId,
          jwksUrl,
        })
        claims = result.claims
      } catch (error) {
        if (error instanceof KeycloakJwtVerificationError) {
          throw new ControlPlaneAuthError(401, 'Unauthorized')
        }
        throw error
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
