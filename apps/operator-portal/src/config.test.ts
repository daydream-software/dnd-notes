import { describe, expect, it } from 'vitest'

import { resolveOperatorPortalConfig } from './config'

describe('resolveOperatorPortalConfig', () => {
  it('falls back to defaults when Vite env is unavailable', () => {
    expect(resolveOperatorPortalConfig()).toEqual({
      operatorApiBasePath: '/operator-api',
      operatorKeycloakConfig: {
        url: 'http://keycloak.127.0.0.1.nip.io:8080',
        realm: 'dnd-notes-dev',
        clientId: 'dnd-notes-control-plane',
      },
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
        url: 'http://keycloak.127.0.0.1.nip.io:8080',
        realm: 'dnd-notes-dev',
        clientId: 'dnd-notes-control-plane',
      },
    })
  })
})
