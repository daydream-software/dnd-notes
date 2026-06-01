import type { FleetTenantStatus } from './types'

/**
 * Returns the majority version across the fleet. Breaks ties by picking the
 * highest (lexicographic) version. Returns '' when the fleet is empty.
 */
export function deriveSuggestedRolloutVersion(tenants: FleetTenantStatus[]): string {
  if (tenants.length === 0) {
    return ''
  }

  const counts: Record<string, number> = {}
  for (const ts of tenants) {
    counts[ts.tenant.version] = (counts[ts.tenant.version] ?? 0) + 1
  }

  const entries = Object.entries(counts).sort((a, b) => {
    // Sort by count descending, then version descending for tie-break.
    if (b[1] !== a[1]) {
      return b[1] - a[1]
    }
    return b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : 0
  })

  return entries[0][0]
}
