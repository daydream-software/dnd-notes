import { joinBasePath } from '@dnd-notes/portal-utils'
import { portalApiBasePath } from './config'
import type {
  ErrorResponse,
  PortalCatalogResponse,
  PortalCreateTenantRequest,
  PortalDashboardResponse,
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
  const response = await fetch(joinBasePath(portalApiBasePath, path), {
    method: 'POST',
    headers: createHeaders(authToken, 'application/json'),
    body: JSON.stringify(body),
    signal,
  })

  return readJson<TResponse>(response)
}

export async function fetchPortalCatalog(signal?: AbortSignal) {
  const response = await fetch(joinBasePath(portalApiBasePath, '/portal/catalog'), {
    signal,
  })
  return readJson<PortalCatalogResponse>(response)
}

export async function fetchPortalDashboard(
  authToken: string,
  signal?: AbortSignal,
) {
  const response = await fetch(joinBasePath(portalApiBasePath, '/portal/me'), {
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

