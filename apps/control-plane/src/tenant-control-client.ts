import type { Tenant } from './types.js'

export interface TenantMaintenanceTransitionRequest {
  tenant: Tenant
  mode: 'enable' | 'disable'
  reason?: string
}

export interface TenantMaintenanceTransitionResult {
  status: number
  body: unknown
}

export interface TenantControlClient {
  setMaintenanceMode(
    request: TenantMaintenanceTransitionRequest,
  ): Promise<TenantMaintenanceTransitionResult>
}

export interface HttpTenantControlClientOptions {
  controlPlaneToken: string
  baseDomain: string
  publicScheme?: 'http' | 'https'
  fetchImpl?: typeof fetch
  resolveTenantBaseUrl?: (tenant: Tenant) => string | null
  timeoutMs?: number
}

const defaultRequestTimeoutMs = 10_000

export class TenantControlError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'TenantControlError'
    this.status = status
    this.body = body
  }
}

export function buildTenantControlBaseUrl(
  tenant: Tenant,
  baseDomain: string,
  publicScheme: 'http' | 'https',
): string | null {
  if (!tenant.subdomain) {
    return null
  }

  return `${publicScheme}://${tenant.subdomain}.${baseDomain}`
}

export function createHttpTenantControlClient(
  options: HttpTenantControlClientOptions,
): TenantControlClient {
  const publicScheme = options.publicScheme ?? 'https'
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs
  const resolveBaseUrl =
    options.resolveTenantBaseUrl ??
    ((tenant) => buildTenantControlBaseUrl(tenant, options.baseDomain, publicScheme))

  return {
    async setMaintenanceMode({ tenant, mode, reason }) {
      const baseUrl = resolveBaseUrl(tenant)

      if (!baseUrl) {
        throw new TenantControlError(
          `Tenant ${tenant.id} has no addressable subdomain for control-plane calls.`,
          0,
          null,
        )
      }

      const url = `${baseUrl}/_control/maintenance`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.controlPlaneToken}`,
          },
          body: JSON.stringify({ mode, reason }),
          signal: controller.signal,
        })

        let body: unknown = null
        const text = await response.text()

        if (text.length > 0) {
          try {
            body = JSON.parse(text)
          } catch {
            body = text
          }
        }

        if (!response.ok) {
          throw new TenantControlError(
            `Tenant ${tenant.id} rejected control-plane maintenance ${mode} request with HTTP ${response.status}.`,
            response.status,
            body,
          )
        }

        return { status: response.status, body }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
