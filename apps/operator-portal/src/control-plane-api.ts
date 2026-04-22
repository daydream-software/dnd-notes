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

async function readJson<T>(response: Response) {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`

    try {
      const errorBody = (await response.json()) as ErrorResponse
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

    throw new Error(errorMessage)
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
