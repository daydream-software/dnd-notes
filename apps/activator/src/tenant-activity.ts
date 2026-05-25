/**
 * Activator → control-plane registry writes, keyed by subdomain.
 *
 * Two operations, both against the control-plane registry database
 * (CONTROL_PLANE_DATABASE_URL):
 *
 *   recordActivity() — upsert tenant_activity.last_request_at (+ seen_by_activator).
 *     Called on every proxied request (sleeping wakes and warm forwarding). The
 *     idle-scaler CronJob reads this table to decide which tenants are idle.
 *
 *   markReady() — transition tenants.current_state from 'sleeping' to 'ready' at
 *     wake time (#385). The activator scales a sleeping tenant's Deployment to 1
 *     on demand, but historically only the idle-scaler's periodic sync-back
 *     flipped current_state back to 'ready', so the operator portal showed a
 *     woken tenant as 'sleeping' until the next cron tick. markReady makes the
 *     wake eagerly authoritative; the sync-back remains a backstop.
 *
 * tenant_activity.tenant_id and tenants.id are the opaque primary key, not
 * tenants.subdomain (the URL-visible short identifier). The activator only knows
 * the subdomain at proxy time, so both operations resolve subdomain → id via a
 * cached SELECT first. The cache stores the in-flight Promise so concurrent
 * first-hit requests for the same subdomain share a single SELECT. On DB error
 * the entry is removed so the next call can retry. Subdomains are stable for a
 * tenant's lifetime, so the lookup runs once per pod restart per tenant.
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
  recordActivity(subdomain: string): Promise<void>
  /**
   * Transition the tenant from 'sleeping' to 'ready' in the registry after a
   * confirmed wake (#385). No-op if the tenant is not currently 'sleeping'
   * (e.g. the idle-scaler sync-back already flipped it, or it is in another
   * state), so it never forces an unexpected state to 'ready'.
   */
  markReady(subdomain: string): Promise<void>
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

  // In-memory subdomain → tenants.id cache. Stores the in-flight lookup Promise so
  // concurrent first-hit requests for the same subdomain share one SELECT instead of
  // each firing their own. On DB error the entry is deleted so the next call
  // can retry rather than awaiting a permanently rejected promise.
  const subdomainToId = new Map<string, Promise<string | undefined>>()

  // Resolve subdomain to the tenants.id the registry tables key on. Shared by
  // recordActivity and markReady. Returns undefined (and skips) when no tenant
  // row matches the subdomain.
  async function resolveTenantId(subdomain: string): Promise<string | undefined> {
    let tenantIdPromise = subdomainToId.get(subdomain)

    if (tenantIdPromise === undefined) {
      tenantIdPromise = db
        .query('SELECT id FROM tenants WHERE subdomain = $1::text', [subdomain])
        .then((result) => {
          if (result.rows.length === 0) {
            // Host matched activator routing but no tenant row exists — could be
            // a race during provisioning or a stale Ingress. Log and skip; do
            // not crash or reject (caller already fires-and-forgets with .catch).
            console.warn(`[activator] tenant not found for subdomain "${subdomain}", skipping registry write`)
            return undefined
          }
          return result.rows[0]['id'] as string
        })
        .catch((error: unknown) => {
          // Remove entry so the next call retries rather than awaiting a
          // permanently rejected promise.
          subdomainToId.delete(subdomain)
          throw error
        })
      subdomainToId.set(subdomain, tenantIdPromise)
    }

    const tenantId = await tenantIdPromise
    if (tenantId === undefined) {
      subdomainToId.delete(subdomain)
    }
    return tenantId
  }

  return {
    async recordActivity(subdomain: string): Promise<void> {
      const tenantId = await resolveTenantId(subdomain)
      if (tenantId === undefined) {
        return
      }

      // Cast $1 explicitly to text to avoid the null-parameter ambiguity
      // documented in feedback_run_pg_mem_tests_on_sql_changes.
      //
      // seen_by_activator is set TRUE on BOTH insert and conflict-update so that
      // a backfilled tenant (FALSE from migration 0008) that later receives real
      // traffic through the activator flips to TRUE and becomes eligible for
      // scale-to-zero. Without the UPDATE branch, a re-provisioned migrated
      // tenant would stay FALSE forever (#364 fix — guard idle scaler).
      await db.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
         VALUES ($1::text, CURRENT_TIMESTAMP, TRUE)
         ON CONFLICT (tenant_id) DO UPDATE
           SET last_request_at = EXCLUDED.last_request_at,
               seen_by_activator = TRUE`,
        [tenantId],
      )
    },

    async markReady(subdomain: string): Promise<void> {
      const tenantId = await resolveTenantId(subdomain)
      if (tenantId === undefined) {
        return
      }

      // Flip sleeping -> ready. The WHERE guard makes this idempotent and safe:
      // it transitions only a currently-sleeping tenant, so a tenant the
      // idle-scaler sync-back already flipped, or one in any other state, is
      // left untouched. The desired_state guard (symmetric with the idle-scaler
      // SELECTs) prevents resurrecting a tenant mid-teardown: a deprovisioning
      // tenant whose Ingress is still up can receive a late request, and we must
      // not flip it back to ready. RETURNING lets us record the transition only
      // when it actually happened, avoiding spurious state_transitions rows.
      const updated = await db.query(
        `UPDATE tenants
         SET current_state = 'ready',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::text
           AND current_state = 'sleeping'
           AND desired_state NOT IN ('deprovisioned', 'failed')
         RETURNING id`,
        [tenantId],
      )
      if (updated.rows.length === 0) {
        return
      }

      await db.query(
        `INSERT INTO state_transitions
           (tenant_id, from_state, to_state, triggered_by, reason)
         VALUES ($1::text, 'sleeping', 'ready', 'activator', 'wake-on-request')`,
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
