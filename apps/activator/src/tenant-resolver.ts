/**
 * Resolves an incoming HTTP request to a tenant's Kubernetes coordinates
 * by parsing the Host header.
 *
 * Convention (from provisioning.ts buildTenantResourceNames):
 *   Host: {subdomain}.{baseDomain}
 *   Namespace: tenant-{subdomain}
 *   Deployment: dnd-notes
 *   Service: dnd-notes
 *   Upstream: http://dnd-notes.tenant-{subdomain}.svc.cluster.local:{tenantPort}
 *
 * The subdomain doubles as the tenant's unique routing key. The base domain
 * and tenant port are supplied via environment variables.
 */

export interface TenantCoordinates {
  /** e.g. "t1234" — first label of the hostname */
  subdomain: string
  /** Kubernetes namespace, e.g. "tenant-t1234" */
  namespace: string
  /** Always "dnd-notes" per provisioning.ts convention */
  deploymentName: string
  /** Always "dnd-notes" per provisioning.ts convention */
  serviceName: string
  /** In-cluster upstream URL, e.g. "http://dnd-notes.tenant-t1234.svc.cluster.local:3000" */
  upstreamUrl: string
}

export interface TenantResolverOptions {
  /** e.g. "notes.daydreamsoftware.ca" */
  baseDomain: string
  /** Port the tenant app listens on inside the cluster. Default: 3000 */
  tenantPort?: number
}

export function createTenantResolver(options: TenantResolverOptions) {
  const baseDomain = options.baseDomain.toLowerCase()
  const tenantPort = options.tenantPort ?? 3000
  const deploymentName = 'dnd-notes'
  const serviceName = 'dnd-notes'

  return {
    /**
     * Parse the Host header and return tenant coordinates.
     * Returns null if the Host does not match the expected pattern.
     */
    resolve(host: string | undefined): TenantCoordinates | null {
      if (!host) return null
      // Strip port if present (e.g. "t1234.notes.example.com:8080")
      const hostname = host.split(':')[0]?.toLowerCase()
      if (!hostname) return null

      const suffix = `.${baseDomain}`
      if (!hostname.endsWith(suffix)) return null

      const subdomain = hostname.slice(0, hostname.length - suffix.length)
      if (!subdomain || subdomain.includes('.')) return null

      const namespace = `tenant-${subdomain}`
      const upstreamUrl = `http://${serviceName}.${namespace}.svc.cluster.local:${tenantPort}`

      return {
        subdomain,
        namespace,
        deploymentName,
        serviceName,
        upstreamUrl,
      }
    },
  }
}
