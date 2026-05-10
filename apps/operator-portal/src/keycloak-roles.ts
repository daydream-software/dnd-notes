interface JwtRoleClaims {
  realm_access?: { roles?: string[] }
  resource_access?: Record<string, { roles?: string[] } | undefined>
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')

  if (parts.length < 2) {
    return null
  }

  try {
    const normalizedPayload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (normalizedPayload.length % 4)) % 4)
    const json = atob(`${normalizedPayload}${padding}`)

    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Extract the union of realm-level and client-level roles from a Keycloak
 * access token. Mirrors the backend logic in keycloak-auth.ts.
 */
export function extractEffectiveRoles(token: string, clientId: string): Set<string> {
  const payload = decodeJwtPayload(token) as JwtRoleClaims | null

  if (!payload) {
    return new Set()
  }

  const realmRoles = payload.realm_access?.roles ?? []
  const clientRoles = payload.resource_access?.[clientId]?.roles ?? []

  return new Set([...realmRoles, ...clientRoles])
}

/**
 * Returns true when the user has at least one of the required roles.
 * Matches the backend check: requiredRoles.some(role => effectiveRoles.has(role))
 */
export function hasAnyRequiredRole(
  effectiveRoles: Set<string>,
  requiredRoles: string[],
): boolean {
  return requiredRoles.some((role) => effectiveRoles.has(role))
}
