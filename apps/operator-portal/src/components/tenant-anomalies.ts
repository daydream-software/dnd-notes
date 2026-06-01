import type { FleetTenantStatus } from '../types'

/**
 * Derives whether a tenant is stuck sleeping.
 *
 * Stuck-sleeping: currentState is sleeping AND the activator has never
 * observed this tenant (seenByActivator === false). This indicates the
 * idle-scaler put the tenant to sleep but the activator has no record of it,
 * so wake attempts will likely fail silently.
 *
 * Other anomalies (flapping, oom-restart-cycle) are intentionally out of scope
 * for v1 — they require wakeCount thresholds over a short window or pod-restart
 * data from cluster-metrics infra not yet shipped (#402.3).
 */
export function isStuckSleeping(status: FleetTenantStatus): boolean {
  return (
    (status.tenant.currentState as string) === 'sleeping' &&
    status.uptime?.seenByActivator === false
  )
}
