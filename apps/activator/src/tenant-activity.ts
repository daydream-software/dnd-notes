/**
 * Postgres upsert for tenant_activity.last_request_at.
 *
 * The activator calls recordActivity() on every proxied request (sleeping
 * wakes and warm forwarding). The idle-scaler CronJob reads this table to
 * decide which tenants have been idle longer than the threshold.
 *
 * Uses the control-plane registry database (CONTROL_PLANE_DATABASE_URL).
 *
 * tenant_activity.tenant_id references tenants.id (the opaque primary key),
 * not tenants.slug (the URL-visible short identifier). The activator only
 * knows the slug at proxy time, so this module resolves slug → id via a
 * cached SELECT before each upsert. The cache is process-local and has no
 * eviction — slugs are stable for a tenant's lifetime, so the lookup only
 * hits the DB once per activator pod restart per tenant.
 */

import { Pool } from 'pg'

export interface TenantActivityOptions {
  databaseUrl: string
}

/** Minimal DB client shape used internally — allows injection in tests. */
export interface DbClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  end(): Promise<void>
}

export interface TenantActivityStore {
  recordActivity(slug: string): Promise<void>
  close(): Promise<void>
}

export interface TenantActivityStoreOptions {
  db: DbClient
}

/**
 * Create a TenantActivityStore with an injected DB client.
 * Used in tests. Production code should call createTenantActivityStore().
 */
export function createTenantActivityStoreWithClient(options: TenantActivityStoreOptions): TenantActivityStore {
  const { db } = options

  // In-memory slug → tenants.id cache. Populated lazily on first lookup.
  const slugToId = new Map<string, string>()

  return {
    async recordActivity(slug: string): Promise<void> {
      // Resolve slug to the tenants.id the FK requires.
      let tenantId = slugToId.get(slug)

      if (tenantId === undefined) {
        const result = await db.query(
          'SELECT id FROM tenants WHERE slug = $1::text',
          [slug],
        )
        if (result.rows.length === 0) {
          // Host matched activator routing but no tenant row exists — could be
          // a race during provisioning or a stale Ingress. Log and skip; do
          // not crash or reject (caller already fires-and-forgets with .catch).
          console.warn(`[activator] tenant not found for slug "${slug}", skipping activity upsert`)
          return
        }
        tenantId = result.rows[0]['id'] as string
        slugToId.set(slug, tenantId)
      }

      // Cast $1 explicitly to text to avoid the null-parameter ambiguity
      // documented in feedback_run_pg_mem_tests_on_sql_changes.
      await db.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at)
         VALUES ($1::text, CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id) DO UPDATE
           SET last_request_at = EXCLUDED.last_request_at`,
        [tenantId],
      )
    },

    async close(): Promise<void> {
      await db.end()
    },
  }
}

export function createTenantActivityStore(options: TenantActivityOptions): TenantActivityStore {
  const pool = new Pool({ connectionString: options.databaseUrl })
  return createTenantActivityStoreWithClient({ db: pool })
}
