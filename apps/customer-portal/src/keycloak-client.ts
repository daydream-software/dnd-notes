import Keycloak from 'keycloak-js'

export interface CustomerKeycloakConfig {
  url: string
  realm: string
  clientId: string
}

export interface StoredKeycloakTokens {
  accessToken: string
  refreshToken: string
  idToken?: string
}

export interface CustomerKeycloakClient {
  init(): Promise<StoredKeycloakTokens | null>
  login(redirectUri?: string): Promise<void>
  logout(redirectUri?: string): Promise<void>
  /**
   * Ensures the access token is valid for at least `minValidity` seconds and
   * returns it. Throws if the session can no longer be refreshed.
   */
  freshToken(minValidity?: number): Promise<string>
}

const keycloakTokenStorageKey = 'dnd-notes:customer-portal:keycloak-tokens'

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

export function readStoredKeycloakTokens(): StoredKeycloakTokens | null {
  const storedTokens = sessionStorage.getItem(keycloakTokenStorageKey)

  if (!storedTokens) {
    return null
  }

  try {
    const parsed = JSON.parse(storedTokens) as Partial<StoredKeycloakTokens>

    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string'
    ) {
      clearStoredKeycloakTokens()
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      ...(typeof parsed.idToken === 'string' ? { idToken: parsed.idToken } : {}),
    }
  } catch {
    clearStoredKeycloakTokens()
    return null
  }
}

export function persistKeycloakTokens(tokens: StoredKeycloakTokens) {
  sessionStorage.setItem(keycloakTokenStorageKey, JSON.stringify(tokens))
}

export function clearStoredKeycloakTokens() {
  sessionStorage.removeItem(keycloakTokenStorageKey)
}

export function createCustomerKeycloakClient(
  config: CustomerKeycloakConfig,
): CustomerKeycloakClient {
  const client = new Keycloak({
    url: config.url,
    realm: config.realm,
    clientId: config.clientId,
  })

  return {
    async init() {
      const storedTokens = readStoredKeycloakTokens()

      try {
        const authenticated = await client.init({
          checkLoginIframe: false,
          pkceMethod: 'S256',
          onLoad: 'check-sso',
          silentCheckSsoFallback: false,
          token: storedTokens?.accessToken,
          refreshToken: storedTokens?.refreshToken,
          idToken: storedTokens?.idToken,
        })

        const tokens = authenticated ? readTokens(client) : null

        if (tokens) {
          persistKeycloakTokens(tokens)
        } else {
          clearStoredKeycloakTokens()
        }

        return tokens
      } catch (error) {
        clearStoredKeycloakTokens()
        throw error
      }
    },
    async login(redirectUri) {
      await client.login({ redirectUri })
    },
    async logout(redirectUri) {
      clearStoredKeycloakTokens()
      await client.logout({ redirectUri })
    },
    async freshToken(minValidity = 30) {
      try {
        await client.updateToken(minValidity)
      } catch (error) {
        clearStoredKeycloakTokens()
        throw error
      }
      const tokens = readTokens(client)

      if (!tokens) {
        throw new Error('Your session is no longer available.')
      }

      persistKeycloakTokens(tokens)
      return tokens.accessToken
    },
  }
}
