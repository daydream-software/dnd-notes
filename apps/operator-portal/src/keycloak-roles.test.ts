import { describe, expect, it } from 'vitest'
import { extractEffectiveRoles, hasAnyRequiredRole } from './keycloak-roles'

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${header}.${body}.sig`
}

const CLIENT_ID = 'dnd-notes-control-plane'

describe('extractEffectiveRoles', () => {
  it('returns an empty set for a non-JWT string', () => {
    expect(extractEffectiveRoles('not-a-jwt', CLIENT_ID).size).toBe(0)
  })

  it('returns an empty set when neither realm nor client roles are present', () => {
    const token = makeJwt({ sub: 'user-1' })
    expect(extractEffectiveRoles(token, CLIENT_ID).size).toBe(0)
  })

  it('extracts realm-level roles', () => {
    const token = makeJwt({
      realm_access: { roles: ['control-plane-admin', 'default-roles-dnd-notes-dev'] },
    })
    const roles = extractEffectiveRoles(token, CLIENT_ID)
    expect(roles.has('control-plane-admin')).toBe(true)
    expect(roles.has('default-roles-dnd-notes-dev')).toBe(true)
  })

  it('extracts client-level roles from the correct clientId', () => {
    const token = makeJwt({
      resource_access: {
        [CLIENT_ID]: { roles: ['control-plane-workforce'] },
        'some-other-client': { roles: ['unrelated-role'] },
      },
    })
    const roles = extractEffectiveRoles(token, CLIENT_ID)
    expect(roles.has('control-plane-workforce')).toBe(true)
    expect(roles.has('unrelated-role')).toBe(false)
  })

  it('unions realm and client roles', () => {
    const token = makeJwt({
      realm_access: { roles: ['control-plane-admin'] },
      resource_access: {
        [CLIENT_ID]: { roles: ['control-plane-workforce'] },
      },
    })
    const roles = extractEffectiveRoles(token, CLIENT_ID)
    expect(roles.has('control-plane-admin')).toBe(true)
    expect(roles.has('control-plane-workforce')).toBe(true)
  })

  it('handles missing resource_access gracefully', () => {
    const token = makeJwt({ realm_access: { roles: ['control-plane-admin'] } })
    expect(extractEffectiveRoles(token, CLIENT_ID).has('control-plane-admin')).toBe(true)
  })

  it('handles a client entry without roles gracefully', () => {
    const token = makeJwt({
      resource_access: { [CLIENT_ID]: {} },
    })
    expect(extractEffectiveRoles(token, CLIENT_ID).size).toBe(0)
  })
})

describe('hasAnyRequiredRole', () => {
  it('returns true when the user has at least one required role', () => {
    const roles = new Set(['control-plane-workforce', 'some-other'])
    expect(hasAnyRequiredRole(roles, ['control-plane-admin', 'control-plane-workforce'])).toBe(
      true,
    )
  })

  it('returns false when the user has none of the required roles', () => {
    const roles = new Set(['default-roles-dnd-notes-dev'])
    expect(hasAnyRequiredRole(roles, ['control-plane-admin', 'control-plane-workforce'])).toBe(
      false,
    )
  })

  it('returns false for an empty effective roles set', () => {
    expect(hasAnyRequiredRole(new Set(), ['control-plane-admin', 'control-plane-workforce'])).toBe(
      false,
    )
  })

  it('returns false when required roles list is empty', () => {
    // empty requiredRoles means no gate — but callers should substitute the default list
    expect(hasAnyRequiredRole(new Set(['control-plane-admin']), [])).toBe(false)
  })
})
