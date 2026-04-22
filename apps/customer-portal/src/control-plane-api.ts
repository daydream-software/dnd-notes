import { portalApiBasePath } from './config'
import type {
  ErrorResponse,
  PortalCatalogResponse,
  PortalCreateTenantRequest,
  PortalDashboardResponse,
  PortalLoginRequest,
  PortalLogoutResponse,
  PortalSessionResponse,
  PortalSignupRequest,
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

      if (details.length > 0 && errorBody.error) {
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
  body: unknown,
  authToken?: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`${portalApiBasePath}${path}`, {
    method: 'POST',
    headers: createHeaders(authToken, 'application/json'),
    body: JSON.stringify(body),
    signal,
  })

  return readJson<TResponse>(response)
}

export async function fetchPortalCatalog(signal?: AbortSignal) {
  const response = await fetch(`${portalApiBasePath}/portal/catalog`, { signal })
  return readJson<PortalCatalogResponse>(response)
}

export function signupPortalAccount(
  request: PortalSignupRequest,
  signal?: AbortSignal,
) {
  return postJson<PortalSessionResponse>('/portal/signup', request, undefined, signal)
}

export function loginPortalAccount(request: PortalLoginRequest, signal?: AbortSignal) {
  return postJson<PortalSessionResponse>('/portal/login', request, undefined, signal)
}

export async function fetchPortalDashboard(
  authToken: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`${portalApiBasePath}/portal/me`, {
    headers: createHeaders(authToken),
    signal,
  })

  return readJson<PortalDashboardResponse>(response)
}

export function createPortalTenant(
  authToken: string,
  request: PortalCreateTenantRequest,
  signal?: AbortSignal,
) {
  return postJson<PortalDashboardResponse>(
    '/portal/me/tenants',
    request,
    authToken,
    signal,
  )
}

export function logoutPortal(authToken: string, signal?: AbortSignal) {
  return postJson<PortalLogoutResponse>('/portal/logout', {}, authToken, signal)
}
