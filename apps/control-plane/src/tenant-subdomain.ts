const maxKubernetesObjectNameLength = 63
export const tenantPvcNamePrefix = 'dnd-notes-data-'
export const maxTenantSubdomainLength =
  maxKubernetesObjectNameLength - tenantPvcNamePrefix.length

const tenantSubdomainPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export function isValidTenantSubdomain(subdomain: string): boolean {
  return (
    subdomain.length <= maxTenantSubdomainLength &&
    tenantSubdomainPattern.test(subdomain)
  )
}

export function assertPersistedTenantSubdomain(
  tenantId: string,
  subdomain: string,
  operation: string,
): string {
  if (!isValidTenantSubdomain(subdomain)) {
    throw new Error(
      `Tenant ${tenantId} has invalid persisted subdomain ${JSON.stringify(subdomain)}. Repair or clear it before ${operation}.`,
    )
  }

  return subdomain
}

export function assertGeneratedTenantSubdomain(subdomain: string): string {
  if (!isValidTenantSubdomain(subdomain)) {
    throw new Error(
      `Generated tenant subdomain candidate ${JSON.stringify(subdomain)} is invalid.`,
    )
  }

  return subdomain
}
