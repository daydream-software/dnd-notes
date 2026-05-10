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
 *   - ensureClientRole: GET role by name → POST if missing. Treats 409
 *     (concurrent create) as a no-op. Used by the per-tenant role gate
 *     (#196) to attach a `tenant-member` role to the per-tenant client.
 *   - assignClientRoleToUser: resolves the role's UUID and POSTs the
 *     role-mapping. Already-assigned mappings are accepted as no-ops
 *     (Keycloak returns 204 in that case).
 *   - findUserByEmail: GET /users?email=<exact>&exact=true → returns the
 *     first matching user or null. Used by the per-tenant role gate (#196)
 *     as an email-fallback when an admin-created tenant has no
 *     `keycloak_sub` on its portal_account row yet.
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
   * Ensures a client role with the given name exists on the client identified
   * by `clientId`. Idempotent: if the role already exists, the call is a
   * no-op. Treats Keycloak's 409 (returned when a concurrent process creates
   * the role between our GET and POST) as a successful no-op.
   *
   * Throws `KeycloakAdminError` when the parent client does not exist —
   * roles are namespaced under a client, so there is no sensible default
   * behavior in that case.
   */
  async ensureClientRole(clientId: string, roleName: string): Promise<void> {
    const client = await this.getClient(clientId)

    if (!client) {
      throw new KeycloakAdminError(
        404,
        `Cannot create role "${roleName}" — Keycloak client "${clientId}" does not exist.`,
      )
    }

    // Fast path: role already exists.
    const existingRoleResponse = await this.adminFetch(
      `/clients/${client.id}/roles/${encodeURIComponent(roleName)}`,
    )

    if (existingRoleResponse.ok) {
      return
    }

    if (existingRoleResponse.status !== 404) {
      throw new KeycloakAdminError(
        existingRoleResponse.status,
        `Keycloak admin GET role "${roleName}" on client "${clientId}" returned HTTP ${existingRoleResponse.status}.`,
      )
    }

    // Create the role. Tolerate 409 — a concurrent provisioner may have
    // created it between our GET and POST.
    const createResponse = await this.adminFetch(`/clients/${client.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name: roleName }),
    })

    if (!createResponse.ok && createResponse.status !== 409) {
      throw new KeycloakAdminError(
        createResponse.status,
        `Keycloak admin POST role "${roleName}" on client "${clientId}" returned HTTP ${createResponse.status}.`,
      )
    }
  }

  /**
   * Assigns the named client role to the user identified by `userId` (the
   * Keycloak `sub` claim — Keycloak's user primary key is the sub).
   *
   * Resolves the role's internal UUID via the admin REST API and issues a
   * POST against `/users/{userId}/role-mappings/clients/{clientUUID}` with
   * the `[{id, name}]` payload Keycloak expects. Already-assigned mappings
   * are accepted as no-ops — Keycloak returns 204 either way, so the call
   * is naturally idempotent.
   *
   * Throws `KeycloakAdminError` when the client, role, or user cannot be
   * resolved.
   */
  async assignClientRoleToUser(
    userId: string,
    clientId: string,
    roleName: string,
  ): Promise<void> {
    const client = await this.getClient(clientId)

    if (!client) {
      throw new KeycloakAdminError(
        404,
        `Cannot assign role "${roleName}" — Keycloak client "${clientId}" does not exist.`,
      )
    }

    const roleResponse = await this.adminFetch(
      `/clients/${client.id}/roles/${encodeURIComponent(roleName)}`,
    )

    if (!roleResponse.ok) {
      throw new KeycloakAdminError(
        roleResponse.status,
        `Keycloak admin GET role "${roleName}" on client "${clientId}" returned HTTP ${roleResponse.status}.`,
      )
    }

    let role: { id?: string; name?: string }

    try {
      role = (await roleResponse.json()) as { id?: string; name?: string }
    } catch {
      throw new KeycloakAdminError(
        0,
        `Keycloak admin GET role "${roleName}" on client "${clientId}" returned a non-JSON response.`,
      )
    }

    if (!role.id || !role.name) {
      throw new KeycloakAdminError(
        0,
        `Keycloak admin GET role "${roleName}" on client "${clientId}" returned a payload without id/name.`,
      )
    }

    const assignResponse = await this.adminFetch(
      `/users/${encodeURIComponent(userId)}/role-mappings/clients/${client.id}`,
      {
        method: 'POST',
        body: JSON.stringify([{ id: role.id, name: role.name }]),
      },
    )

    if (!assignResponse.ok) {
      throw new KeycloakAdminError(
        assignResponse.status,
        `Keycloak admin POST role-mapping for user "${userId}" on client "${clientId}" returned HTTP ${assignResponse.status}.`,
      )
    }
  }

  /**
   * Resolves a Keycloak user by their email address using an exact-match
   * lookup. Returns `{ id }` (the `sub`) when a unique user exists, or
   * `null` when no user matches. Throws `KeycloakAdminError` on transport
   * or parse failure.
   *
   * Used by tenant provisioning (#196) as the email-fallback for admin-
   * created tenants whose portal_account row has no `keycloak_sub` yet —
   * we still need to assign the per-tenant `tenant-member` role so the
   * owner can authenticate against the tenant API on first login.
   *
   * Only the `id` field is returned because that is the only field the
   * provisioner needs (the role-mapping POST is keyed on user id).
   */
  async findUserByEmail(email: string): Promise<{ id: string } | null> {
    let response: Response

    try {
      response = await this.adminFetch(
        `/users?email=${encodeURIComponent(email)}&exact=true`,
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
        `Keycloak admin GET users by email returned HTTP ${response.status}.`,
      )
    }

    let users: { id?: string }[]

    try {
      users = (await response.json()) as { id?: string }[]
    } catch {
      throw new KeycloakAdminError(
        0,
        'Keycloak admin GET users by email returned a non-JSON response.',
      )
    }

    if (!Array.isArray(users) || users.length === 0) {
      return null
    }

    const first = users[0]
    if (!first || typeof first.id !== 'string' || first.id.trim() === '') {
      throw new KeycloakAdminError(
        0,
        'Keycloak admin GET users by email returned a payload without an id.',
      )
    }

    return { id: first.id }
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
