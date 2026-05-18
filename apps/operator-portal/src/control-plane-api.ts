import { operatorApiBasePath } from './config'
import type {
  CreateTenantRequest,
  DeprovisionTenantRequest,
  ErrorResponse,
  FleetStatusResponse,
  ProvisionTenantRequest,
  TenantDeprovisionResponse,
  TenantDetailResponse,
  TenantProvisioningResponse,
} from './types'

/**
 * Mirrors KeycloakUserSummary from apps/control-plane/src/keycloak-admin-client.ts.
 * Duplicated here per the operator-portal convention — no cross-package type imports.
 */
export interface KeycloakUserSummary {
  id: string
  username?: string
  email?: string
  firstName?: string
  lastName?: string
}

function createHeaders(authToken?: string, contentType?: string) {
  const headers = new Headers()

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`)
  }

  if (contentType) {
    headers.set('Content-Type', contentType)
  }

  return headers
}

export class ApiError extends Error {
  public readonly statusCode: number
  public readonly code?: string

  constructor(message: string, statusCode: number, code?: string) {
    super(message)
    Object.setPrototypeOf(this, ApiError.prototype)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

async function readJson<T>(response: Response) {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`
    let errorCode: string | undefined

    try {
      const errorBody = (await response.json()) as ErrorResponse
      errorCode = errorBody.code
      const details = Array.isArray(errorBody.details)
        ? errorBody.details.join(' ').trim()
        : typeof errorBody.details === 'string'
          ? errorBody.details.trim()
          : ''

      if (errorBody.code && details.length > 0) {
        errorMessage = details
      } else if (details.length > 0 && errorBody.error) {
        errorMessage = `${errorBody.error} ${details}`
      } else if (details.length > 0) {
        errorMessage = details
      } else if (errorBody.error) {
        errorMessage = errorBody.error
      }
    } catch {
      // Fall back to generic HTTP error message.
    }

    throw new ApiError(errorMessage, response.status, errorCode)
  }

  return (await response.json()) as T
}

async function postJson<TResponse>(
  path: string,
  authToken: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch(`${operatorApiBasePath}${path}`, {
    method: 'POST',
    headers: createHeaders(authToken, 'application/json'),
    body: JSON.stringify(body),
    signal,
  })

  return readJson<TResponse>(response)
}

export async function fetchFleetStatus(authToken: string, signal?: AbortSignal) {
  const response = await fetch(`${operatorApiBasePath}/internal/fleet/status`, {
    headers: createHeaders(authToken),
    signal,
  })

  return readJson<FleetStatusResponse>(response)
}

export function createTenant(
  authToken: string,
  request: CreateTenantRequest,
  signal?: AbortSignal,
) {
  return postJson<TenantDetailResponse>('/internal/tenants', authToken, request, signal)
}

export function provisionTenant(
  authToken: string,
  tenantId: string,
  request: ProvisionTenantRequest,
  signal?: AbortSignal,
) {
  return postJson<TenantProvisioningResponse>(
    `/internal/tenants/${tenantId}/provision`,
    authToken,
    request,
    signal,
  )
}

export function deprovisionTenant(
  authToken: string,
  tenantId: string,
  request: DeprovisionTenantRequest,
  signal?: AbortSignal,
) {
  return postJson<TenantDeprovisionResponse>(
    `/internal/tenants/${tenantId}/deprovision`,
    authToken,
    request,
    signal,
  )
}

export async function searchKeycloakUsers(
  authToken: string,
  q: string,
  signal?: AbortSignal,
): Promise<KeycloakUserSummary[]> {
  const response = await fetch(
    `${operatorApiBasePath}/internal/keycloak-users?q=${encodeURIComponent(q)}`,
    {
      headers: createHeaders(authToken),
      signal,
    },
  )

  return readJson<KeycloakUserSummary[]>(response)
}
