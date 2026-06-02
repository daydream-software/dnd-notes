import { describe, expect, it } from 'vitest'

import { resolveOperatorPortalConfig } from './config'

describe('resolveOperatorPortalConfig', () => {
  it('falls back to defaults when Vite env is unavailable', () => {
    expect(resolveOperatorPortalConfig()).toEqual({
      operatorApiBasePath: '/operator-api',
      operatorKeycloakConfig: {
        url: 'https://keycloak.127.0.0.1.nip.io',
        realm: 'dnd-notes-dev',
        clientId: 'dnd-notes-control-plane',
      },
      requiredRoles: ['control-plane-admin', 'control-plane-workforce'],
      customerPortalUrl: 'https://portal.127.0.0.1.nip.io',
      tenantBaseDomain: '127.0.0.1.nip.io',
      tenantPublicScheme: 'https',
    })
  })

  it('normalizes configured values from Vite env', () => {
    expect(
      resolveOperatorPortalConfig({
        VITE_OPERATOR_API_BASE_PATH: ' /operator-api/// ',
        VITE_OPERATOR_KEYCLOAK_URL: ' http://keycloak.example.test/// ',
        VITE_OPERATOR_KEYCLOAK_REALM: 'operators',
        VITE_OPERATOR_KEYCLOAK_CLIENT_ID: 'operator-portal',
      }),
    ).toEqual({
      operatorApiBasePath: '/operator-api',
      operatorKeycloakConfig: {
        url: 'http://keycloak.example.test',
        realm: 'operators',
        clientId: 'operator-portal',
      },
      requiredRoles: ['control-plane-admin', 'control-plane-workforce'],
      customerPortalUrl: 'https://portal.127.0.0.1.nip.io',
      tenantBaseDomain: '127.0.0.1.nip.io',
      tenantPublicScheme: 'https',
    })
  })

  it('falls back when keycloak realm or client id are blank', () => {
    expect(
      resolveOperatorPortalConfig({
        VITE_OPERATOR_KEYCLOAK_REALM: '   ',
        VITE_OPERATOR_KEYCLOAK_CLIENT_ID: '',
      }),
    ).toEqual({
      operatorApiBasePath: '/operator-api',
      operatorKeycloakConfig: {
        url: 'https://keycloak.127.0.0.1.nip.io',
        realm: 'dnd-notes-dev',
        clientId: 'dnd-notes-control-plane',
      },
      requiredRoles: ['control-plane-admin', 'control-plane-workforce'],
      customerPortalUrl: 'https://portal.127.0.0.1.nip.io',
      tenantBaseDomain: '127.0.0.1.nip.io',
      tenantPublicScheme: 'https',
    })
  })

  it('falls back when keycloak url is blank', () => {
    expect(
      resolveOperatorPortalConfig({
        VITE_OPERATOR_KEYCLOAK_URL: '   ',
      }),
    ).toEqual({
      operatorApiBasePath: '/operator-api',
      operatorKeycloakConfig: {
        url: 'https://keycloak.127.0.0.1.nip.io',
        realm: 'dnd-notes-dev',
        clientId: 'dnd-notes-control-plane',
      },
      requiredRoles: ['control-plane-admin', 'control-plane-workforce'],
      customerPortalUrl: 'https://portal.127.0.0.1.nip.io',
      tenantBaseDomain: '127.0.0.1.nip.io',
      tenantPublicScheme: 'https',
    })
  })

  it('parses KEYCLOAK_REQUIRED_ROLES from comma-separated string', () => {
    const result = resolveOperatorPortalConfig({
      VITE_OPERATOR_KEYCLOAK_REQUIRED_ROLES: 'control-plane-admin , control-plane-workforce ',
    })
    expect(result.requiredRoles).toEqual(['control-plane-admin', 'control-plane-workforce'])
  })

  it('falls back to default required roles when KEYCLOAK_REQUIRED_ROLES is blank', () => {
    const result = resolveOperatorPortalConfig({
      VITE_OPERATOR_KEYCLOAK_REQUIRED_ROLES: '   ',
    })
    expect(result.requiredRoles).toEqual(['control-plane-admin', 'control-plane-workforce'])
  })

  it('uses a single role when KEYCLOAK_REQUIRED_ROLES has one entry', () => {
    const result = resolveOperatorPortalConfig({
      VITE_OPERATOR_KEYCLOAK_REQUIRED_ROLES: 'control-plane-admin',
    })
    expect(result.requiredRoles).toEqual(['control-plane-admin'])
  })

  it('uses configured CUSTOMER_PORTAL_URL', () => {
    const result = resolveOperatorPortalConfig({
      VITE_OPERATOR_CUSTOMER_PORTAL_URL: 'https://portal.example.com/',
    })
    expect(result.customerPortalUrl).toBe('https://portal.example.com')
  })

  it('falls back to default customer portal URL when blank', () => {
    const result = resolveOperatorPortalConfig({
      VITE_OPERATOR_CUSTOMER_PORTAL_URL: '   ',
    })
    expect(result.customerPortalUrl).toBe('https://portal.127.0.0.1.nip.io')
  })
})
