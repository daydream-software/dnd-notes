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

import { KubeConfig, AppsV1Api } from '@kubernetes/client-node'
import { Pool } from 'pg'

const CONTROL_PLANE_DATABASE_URL = process.env['CONTROL_PLANE_DATABASE_URL'] ?? ''
const IDLE_THRESHOLD_MINUTES = Number(process.env['IDLE_THRESHOLD_MINUTES'] ?? '30')

if (!CONTROL_PLANE_DATABASE_URL) {
  console.error('[idle-scaler] CONTROL_PLANE_DATABASE_URL is required')
  process.exit(1)
}

interface IdleTenant {
  tenantId: string
  subdomain: string
  currentState: string
}

interface ActiveTenant {
  tenantId: string
  subdomain: string
  currentState: string
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: CONTROL_PLANE_DATABASE_URL })
  const kubeConfig = new KubeConfig()
  kubeConfig.loadFromDefault()
  const appsApi = kubeConfig.makeApiClient(AppsV1Api)

  try {
    console.log(`[idle-scaler] running with idle threshold ${IDLE_THRESHOLD_MINUTES} minutes`)

    // Find tenants idle past the threshold that are not already sleeping
    const idleResult = await pool.query<IdleTenant>(
      `SELECT t.id AS "tenantId", t.subdomain, t.current_state AS "currentState"
       FROM tenants t
       LEFT JOIN tenant_activity ta ON ta.tenant_id::text = t.id::text
       WHERE t.current_state IN ('ready')
         AND t.desired_state NOT IN ('deprovisioned', 'failed')
         AND (
           ta.last_request_at IS NULL
           OR ta.last_request_at < NOW() - ($1 || ' minutes')::INTERVAL
         )`,
      [IDLE_THRESHOLD_MINUTES],
    )

    console.log(`[idle-scaler] found ${idleResult.rows.length} idle tenant(s) to scale to zero`)

    for (const row of idleResult.rows) {
      if (!row.subdomain) {
        console.warn(`[idle-scaler] tenant ${row.tenantId} has no subdomain, skipping`)
        continue
      }

      const namespace = `tenant-${row.subdomain}`
      const deploymentName = 'dnd-notes'

      try {
        // Verify the Deployment still has replicas before patching
        const deployment = await appsApi.readNamespacedDeployment({ name: deploymentName, namespace })
        const currentReplicas = deployment.spec?.replicas ?? 0
        if (currentReplicas === 0) {
          console.log(`[idle-scaler] tenant ${row.subdomain} already at 0 replicas, syncing state`)
        } else {
          console.log(`[idle-scaler] scaling tenant ${row.subdomain} to 0 replicas`)
          // ObjectParamAPI request object; library selects application/merge-patch+json automatically
          await appsApi.patchNamespacedDeployment({ name: deploymentName, namespace, body: { spec: { replicas: 0 } } })
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

    // Sync back: sleeping tenants that are now awake (manual wake or operator action)
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

main().catch((err) => {
  console.error('[idle-scaler] fatal error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
