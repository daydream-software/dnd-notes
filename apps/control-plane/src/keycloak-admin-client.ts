/**
 * Keycloak Admin REST client.
 *
 * Authenticates via client_credentials grant (service-account pattern) and
 * exposes a minimal surface sufficient for both static portal client upserts
 * (this PR) and per-tenant client lifecycle (#170).
 *
 * All methods are idempotent:
 *   - ensureClient: GET by clientId → POST if missing; diff spec against
 *     existing and PUT only when at least one spec key differs; no-op if
 *     already in sync. This avoids spurious 409s from Keycloak when the
 *     realm-imported client already matches the desired spec.
 *   - deleteClient: GET by clientId → DELETE internal id; no-op if not found.
 *   - getClient: GET by clientId → returns spec or null.
 */

import { isDeepStrictEqual } from 'node:util'

export interface KeycloakClientSpec {
  clientId: string
  enabled?: boolean
  publicClient?: boolean
  standardFlowEnabled?: boolean
  implicitFlowEnabled?: boolean
  directAccessGrantsEnabled?: boolean
  serviceAccountsEnabled?: boolean
  bearerOnly?: boolean
  redirectUris?: string[]
  webOrigins?: string[]
  [key: string]: unknown
}

export interface KeycloakAdminClientOptions {
  /** In-cluster base URL, e.g. http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080 */
  baseUrl: string
  realm: string
  clientId: string
  clientSecret: string
}

export class KeycloakAdminError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'KeycloakAdminError'
  }
}

interface TokenResponse {
  access_token: string
  expires_in: number
}

function normalizeBaseUrl(url: string): string {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  return url.slice(0, end)
}

/**
 * Returns true when every key present in `spec` already has an equal value in
 * `existing`. Keys carried by Keycloak but absent from `spec` are ignored —
 * we only care whether the fields we manage are already correct.
 *
 * Uses Node's `isDeepStrictEqual` so array values (redirectUris, webOrigins)
 * are compared element-by-element, not by stringified form.
 */
function specMatchesExisting(
  spec: KeycloakClientSpec,
  existing: KeycloakClientSpec & { id: string },
): boolean {
  for (const key of Object.keys(spec)) {
    if (!isDeepStrictEqual(spec[key], existing[key])) {
      return false
    }
  }
  return true
}

export class KeycloakAdminClient {
  private readonly baseUrl: string
  private readonly realm: string
  private readonly clientId: string
  private readonly clientSecret: string

  private cachedToken: string | null = null
  private tokenExpiresAt = 0

  constructor(options: KeycloakAdminClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.realm = options.realm
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now()

    if (this.cachedToken && now < this.tokenExpiresAt) {
      return this.cachedToken
    }

    const tokenUrl = `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    })

    let response: Response

    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    } catch (error) {
      throw new KeycloakAdminError(
        0,
        `Failed to reach Keycloak token endpoint at ${tokenUrl}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!response.ok) {
      throw new KeycloakAdminError(
        response.status,
        `Keycloak token endpoint returned HTTP ${response.status}.`,
      )
    }

    let payload: TokenResponse

    try {
      payload = (await response.json()) as TokenResponse
    } catch {
      throw new KeycloakAdminError(0, 'Keycloak token endpoint returned a non-JSON response.')
    }

    if (!payload.access_token) {
      throw new KeycloakAdminError(0, 'Keycloak token response did not include an access_token.')
    }

    // Subtract 10 seconds as a safety buffer before treating the token as expired.
    this.cachedToken = payload.access_token
    this.tokenExpiresAt = now + (payload.expires_in - 10) * 1000
    return this.cachedToken
  }

  private async adminFetch(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const token = await this.getAccessToken()
    const url = `${this.baseUrl}/admin/realms/${this.realm}${path}`

    return fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  }

  /**
   * Returns the full client representation (including internal `id`) or null
   * if no client with the given clientId exists.
   */
  async getClient(clientId: string): Promise<(KeycloakClientSpec & { id: string }) | null> {
    let response: Response

    try {
      response = await this.adminFetch(
        `/clients?clientId=${encodeURIComponent(clientId)}`,
      )
    } catch (error) {
      if (error instanceof KeycloakAdminError) {
        throw error
      }

      throw new KeycloakAdminError(
        0,
        `Failed to reach Keycloak admin API: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!response.ok) {
      throw new KeycloakAdminError(
        response.status,
        `Keycloak admin GET clients returned HTTP ${response.status}.`,
      )
    }

    const clients = (await response.json()) as (KeycloakClientSpec & { id: string })[]

    if (!Array.isArray(clients) || clients.length === 0) {
      return null
    }

    return clients[0]
  }

  /**
   * Idempotent create-or-update. If a client with spec.clientId already exists
   * the spec is diffed against the live representation: if every key in spec
   * already matches the existing value the PUT is skipped entirely (no-op).
   * Only when at least one spec key differs is a full-replace PUT issued.
   * If the client does not exist it is created via POST.
   */
  async ensureClient(spec: KeycloakClientSpec): Promise<void> {
    const existing = await this.getClient(spec.clientId)

    if (existing) {
      if (specMatchesExisting(spec, existing)) {
        // All managed fields are already in sync — skip the PUT.
        return
      }

      // At least one field differs — full replace via PUT.
      const response = await this.adminFetch(`/clients/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...existing, ...spec }),
      })

      if (!response.ok) {
        throw new KeycloakAdminError(
          response.status,
          `Keycloak admin PUT client "${spec.clientId}" returned HTTP ${response.status}.`,
        )
      }

      return
    }

    // Client does not exist — create it.
    const response = await this.adminFetch('/clients', {
      method: 'POST',
      body: JSON.stringify(spec),
    })

    if (!response.ok) {
      throw new KeycloakAdminError(
        response.status,
        `Keycloak admin POST client "${spec.clientId}" returned HTTP ${response.status}.`,
      )
    }
  }

  /**
   * Deletes the client identified by clientId. No-op if the client does not
   * exist (idempotent).
   */
  async deleteClient(clientId: string): Promise<void> {
    const existing = await this.getClient(clientId)

    if (!existing) {
      return
    }

    const response = await this.adminFetch(`/clients/${existing.id}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new KeycloakAdminError(
        response.status,
        `Keycloak admin DELETE client "${clientId}" returned HTTP ${response.status}.`,
      )
    }
  }
}
