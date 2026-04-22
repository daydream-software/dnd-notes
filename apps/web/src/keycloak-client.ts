import Keycloak from 'keycloak-js'
import type { AuthConfigResponse } from './types'

export interface StoredKeycloakTokens {
  accessToken: string
  refreshToken: string
  idToken?: string
}

export interface RuntimeKeycloakClient {
  init(tokens?: StoredKeycloakTokens | null): Promise<StoredKeycloakTokens | null>
  login(redirectUri?: string): Promise<void>
  logout(redirectUri?: string): Promise<void>
  refresh(minValidity?: number): Promise<StoredKeycloakTokens>
  clear(): void
}

export function isKeycloakAuthConfig(
  authConfig: AuthConfigResponse | null,
): authConfig is AuthConfigResponse & {
  mode: 'keycloak'
  keycloak: {
    url: string
    realm: string
    clientId: string
  }
} {
  return authConfig?.mode === 'keycloak' && authConfig.keycloak !== null
}

function readTokens(client: Keycloak): StoredKeycloakTokens | null {
  if (!client.token || !client.refreshToken) {
    return null
  }

  return {
    accessToken: client.token,
    refreshToken: client.refreshToken,
    ...(client.idToken ? { idToken: client.idToken } : {}),
  }
}

export function createRuntimeKeycloakClient(
  config: NonNullable<AuthConfigResponse['keycloak']>,
): RuntimeKeycloakClient {
  const client = new Keycloak({
    url: config.url,
    realm: config.realm,
    clientId: config.clientId,
  })

  return {
    async init(tokens) {
      const authenticated = await client.init({
        checkLoginIframe: false,
        pkceMethod: 'S256',
        token: tokens?.accessToken,
        refreshToken: tokens?.refreshToken,
        idToken: tokens?.idToken,
      })

      return authenticated ? readTokens(client) : null
    },
    async login(redirectUri) {
      await client.login({ redirectUri })
    },
    async logout(redirectUri) {
      await client.logout({ redirectUri })
    },
    async refresh(minValidity = 30) {
      await client.updateToken(minValidity)
      const tokens = readTokens(client)

      if (!tokens) {
        throw new Error('Keycloak session is no longer available.')
      }

      return tokens
    },
    clear() {
      client.clearToken()
    },
  }
}
