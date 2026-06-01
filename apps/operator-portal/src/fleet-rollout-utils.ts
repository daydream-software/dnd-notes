import type { FleetTenantStatus } from './types'

/**
 * Compares two semver strings numerically, segment by segment.
 * Returns positive when a > b, negative when a < b, 0 when equal.
 * Falls back to locale comparison for non-numeric segments (pre-release tags, etc.).
 */
function compareSemverDesc(a: string, b: string): number {
  const aParts = a.split('.')
  const bParts = b.split('.')
  const len = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < len; i++) {
    const aNum = parseInt(aParts[i] ?? '0', 10)
    const bNum = parseInt(bParts[i] ?? '0', 10)

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (bNum !== aNum) {
        return bNum - aNum // descending: higher segment wins
      }
    } else {
      // Non-numeric segment — fall back to string comparison.
      const aStr = aParts[i] ?? ''
      const bStr = bParts[i] ?? ''
      if (aStr !== bStr) {
        return bStr > aStr ? 1 : -1
      }
    }
  }

  return 0
}

/**
 * Returns the majority version across the fleet. Breaks ties by picking the
 * highest semver version (numeric segment comparison). Returns '' when the
 * fleet is empty.
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
    return compareSemverDesc(a[0], b[0])
  })

  return entries[0][0]
}
