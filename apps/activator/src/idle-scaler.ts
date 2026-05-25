/**
 * Idle scaler — CronJob entrypoint.
 *
 * Queries tenant_activity.last_request_at for all tenants. For each tenant
 * idle longer than IDLE_THRESHOLD_MINUTES (default: 30), patches
 * spec.replicas: 0 on the tenant Deployment and updates currentState to
 * 'sleeping' in the tenant registry.
 *
 * Also syncs back: if a tenant's currentState is 'sleeping' but the
 * Deployment now has replicas > 0 (manual wake or operator action), update
 * currentState to 'ready'.
 *
 * Environment variables:
 *   CONTROL_PLANE_DATABASE_URL  - Postgres connection string
 *   IDLE_THRESHOLD_MINUTES      - idle threshold (default: 30)
 *   BASE_DOMAIN                 - required to derive tenant Deployment coordinates
 *
 * Run as a CronJob: exits with code 0 on success, 1 on error.
 */

import { KubeConfig, AppsV1Api, PatchStrategy, setHeaderOptions } from '@kubernetes/client-node'
import { Pool } from 'pg'

export interface IdleTenant {
  tenantId: string
  subdomain: string
  currentState: string
  /** Snapshot of tenant_activity.last_request_at at SELECT time (race guard, #354). */
  lastRequestAt: Date
}

interface ActiveTenant {
  tenantId: string
  subdomain: string
  currentState: string
}

/** Minimal DB client shape used internally — allows injection in tests. */
export interface IdleScalerDbClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>
}

/**
 * Return tenants eligible for scale-to-zero: ready, seen by the activator
 * (seen_by_activator = TRUE), and idle past the threshold.
 *
 * Exported for unit testing against pg-mem — callers do not need a K8s client.
 * Only tenants that have been seen_by_activator are eligible; tenants with no
 * activity row or with seen_by_activator = FALSE are never returned (#364 guard).
 */
export async function queryIdleEligibleTenants(
  db: IdleScalerDbClient,
  thresholdMinutes: number,
): Promise<IdleTenant[]> {
  const result = await db.query(
    `SELECT t.id AS "tenantId", t.subdomain, t.current_state AS "currentState",
            ta.last_request_at AS "lastRequestAt"
     FROM tenants t
     JOIN tenant_activity ta ON ta.tenant_id::text = t.id::text
     WHERE t.current_state IN ('ready')
       AND t.desired_state NOT IN ('deprovisioned', 'failed')
       AND ta.seen_by_activator = TRUE
       AND ta.last_request_at < NOW() - ($1 || ' minutes')::INTERVAL`,
    [thresholdMinutes],
  )
  return result.rows as unknown as IdleTenant[]
}

/**
 * Close the SELECT->PATCH race (#354). Between queryIdleEligibleTenants (the
 * idle SELECT) and the scale-to-zero PATCH there is a window — one K8s API
 * roundtrip plus the loop iteration — in which the activator can wake the
 * tenant in response to a real request. Re-read last_request_at just before
 * patching and skip the scale-down if it advanced past the SELECT-time
 * snapshot. The comparison runs in SQL to avoid JS Date precision/timezone
 * pitfalls.
 */
export async function hasActivitySince(
  db: IdleScalerDbClient,
  tenantId: string,
  since: Date,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM tenant_activity
     WHERE tenant_id = $1::text
       AND last_request_at > $2`,
    [tenantId, since],
  )
  return result.rows.length > 0
}

async function main(): Promise<void> {
  const CONTROL_PLANE_DATABASE_URL = process.env['CONTROL_PLANE_DATABASE_URL'] ?? ''
  const IDLE_THRESHOLD_MINUTES = Number(process.env['IDLE_THRESHOLD_MINUTES'] ?? '30')

  if (!Number.isFinite(IDLE_THRESHOLD_MINUTES) || IDLE_THRESHOLD_MINUTES <= 0) {
    console.error('[idle-scaler] IDLE_THRESHOLD_MINUTES must be a positive number')
    process.exit(1)
  }

  if (!CONTROL_PLANE_DATABASE_URL) {
    console.error('[idle-scaler] CONTROL_PLANE_DATABASE_URL is required')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: CONTROL_PLANE_DATABASE_URL })
  const kubeConfig = new KubeConfig()
  kubeConfig.loadFromDefault()
  const appsApi = kubeConfig.makeApiClient(AppsV1Api)

  try {
    console.log(`[idle-scaler] running with idle threshold ${IDLE_THRESHOLD_MINUTES} minutes`)

    const idleResult = { rows: await queryIdleEligibleTenants(pool, IDLE_THRESHOLD_MINUTES) }

    console.log(`[idle-scaler] found ${idleResult.rows.length} idle tenant(s) to scale to zero`)

    for (const row of idleResult.rows) {
      if (!row.subdomain) {
        console.warn(`[idle-scaler] tenant ${row.tenantId} has no subdomain, skipping`)
        continue
      }

      const namespace = `tenant-${row.subdomain}`
      const deploymentName = 'dnd-notes'

      try {
        // Race guard (#354): the activator may have woken this tenant between
        // the idle SELECT and now. If last_request_at advanced past the
        // snapshot, the tenant is active again — skip the scale-down (and the
        // sleeping mark) so we do not clobber a live request. Run this cheap DB
        // re-read before the K8s API GET so a woken tenant costs no apiserver
        // roundtrip.
        if (await hasActivitySince(pool, row.tenantId, row.lastRequestAt)) {
          console.log(`[idle-scaler] tenant ${row.subdomain} was woken after the idle scan, skipping scale-down`)
          continue
        }

        // Verify the Deployment still has replicas before patching
        const deployment = await appsApi.readNamespacedDeployment({ name: deploymentName, namespace })
        const currentReplicas = deployment.spec?.replicas ?? 0

        if (currentReplicas === 0) {
          console.log(`[idle-scaler] tenant ${row.subdomain} already at 0 replicas, syncing state`)
        } else {
          console.log(`[idle-scaler] scaling tenant ${row.subdomain} to 0 replicas`)
          await appsApi.patchNamespacedDeployment(
            { name: deploymentName, namespace, body: { spec: { replicas: 0 } } },
            setHeaderOptions('Content-Type', PatchStrategy.MergePatch),
          )
        }

        // Update currentState to 'sleeping' in the registry
        await pool.query(
          `UPDATE tenants
           SET current_state = 'sleeping',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::text
             AND current_state = 'ready'`,
          [row.tenantId],
        )

        // Record the state transition
        await pool.query(
          `INSERT INTO state_transitions
             (tenant_id, from_state, to_state, triggered_by, reason)
           VALUES ($1::text, 'ready', 'sleeping', 'idle-scaler',
                   'Tenant idle for ' || $2 || ' minutes')`,
          [row.tenantId, IDLE_THRESHOLD_MINUTES],
        )

        console.log(`[idle-scaler] tenant ${row.subdomain} scaled to zero and marked sleeping`)
      } catch (err) {
        console.error(
          `[idle-scaler] failed to scale tenant ${row.subdomain}:`,
          err instanceof Error ? err.message : String(err),
        )
        // Continue with other tenants — one failure does not block the rest
      }
    }

    // Sync back: sleeping tenants that are now awake (manual wake or operator action).
    //
    // No seen_by_activator guard needed here: to reach current_state='sleeping' a
    // tenant must have been scaled by the first SELECT above, which already requires
    // seen_by_activator = TRUE. Every sleeping tenant therefore carries the flag.
    // This query is a registry-state-sync against actual Deployment replicas, not a
    // scale decision — gating it on seen_by_activator would add no safety and could
    // mask a stuck-sleeping tenant if the flag were ever inconsistent.
    const awakeSleepingResult = await pool.query<ActiveTenant>(
      `SELECT t.id AS "tenantId", t.subdomain, t.current_state AS "currentState"
       FROM tenants t
       WHERE t.current_state = 'sleeping'
         AND t.desired_state NOT IN ('deprovisioned', 'failed')`,
      [],
    )

    for (const row of awakeSleepingResult.rows) {
      if (!row.subdomain) continue

      const namespace = `tenant-${row.subdomain}`
      try {
        const deployment = await appsApi.readNamespacedDeployment({ name: 'dnd-notes', namespace })
        const currentReplicas = deployment.spec?.replicas ?? 0
        if (currentReplicas > 0) {
          console.log(`[idle-scaler] tenant ${row.subdomain} is awake, syncing state to ready`)
          await pool.query(
            `UPDATE tenants
             SET current_state = 'ready',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1::text
               AND current_state = 'sleeping'`,
            [row.tenantId],
          )
          await pool.query(
            `INSERT INTO state_transitions
               (tenant_id, from_state, to_state, triggered_by, reason)
             VALUES ($1::text, 'sleeping', 'ready', 'idle-scaler',
                     'Deployment replicas > 0, syncing state')`,
            [row.tenantId],
          )
        }
      } catch {
        // Namespace may not exist if tenant is partially deprovisioned
      }
    }

    console.log('[idle-scaler] complete')
  } finally {
    await pool.end()
  }
}

// Only run main() when this module is the direct entry point, not when imported
// by tests or other modules. The ESM equivalent of Node's __filename === process.argv[1].
const isEntryPoint = process.argv[1] !== undefined &&
  import.meta.url === new URL(process.argv[1], 'file:').href

if (isEntryPoint) {
  main().catch((err) => {
    console.error('[idle-scaler] fatal error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
