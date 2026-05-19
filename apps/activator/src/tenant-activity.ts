/**
 * Postgres upsert for tenant_activity.last_request_at.
 *
 * The activator calls recordActivity() on every proxied request (sleeping
 * wakes and warm forwarding). The idle-scaler CronJob reads this table to
 * decide which tenants have been idle longer than the threshold.
 *
 * Uses the control-plane registry database (CONTROL_PLANE_DATABASE_URL).
 */

import { Pool } from 'pg'

export interface TenantActivityOptions {
  databaseUrl: string
}

export interface TenantActivityStore {
  recordActivity(tenantId: string): Promise<void>
  close(): Promise<void>
}

export function createTenantActivityStore(options: TenantActivityOptions): TenantActivityStore {
  const pool = new Pool({ connectionString: options.databaseUrl })

  return {
    async recordActivity(tenantId: string): Promise<void> {
      // Cast $1 explicitly to text to avoid the null-parameter ambiguity
      // documented in feedback_run_pg_mem_tests_on_sql_changes.
      await pool.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at)
         VALUES ($1::text, CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id) DO UPDATE
           SET last_request_at = EXCLUDED.last_request_at`,
        [tenantId],
      )
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
