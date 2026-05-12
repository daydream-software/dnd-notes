/**
 * Background role-sync retry loop (#201).
 *
 * Periodically finds portal accounts whose role_sync_status is 'pending' —
 * meaning the per-tenant Keycloak role-assignment sweep at auto-link time
 * failed for at least one tenant — and re-attempts the assignments.
 *
 * Design constraints:
 * - Runs out-of-band; never blocks an HTTP request.
 * - assignClientRoleToUser is already idempotent (Keycloak returns 204 for
 *   already-assigned mappings), so re-running the same assignment twice is
 *   always safe.
 * - A 404 on the Keycloak client (dnd-notes-tenant-{id}) means the tenant
 *   client is genuinely absent — deprovisioned or never created. We treat
 *   this as a non-retryable skip for that tenant slot but do not mark the
 *   account complete (other tenant slots may still need retry). If all
 *   remaining slots are either 404 or successful, we mark complete. This
 *   prevents permanent 'pending' state caused by tenants whose KC clients
 *   were removed.
 * - Exponential backoff per-tick: if every account in a tick fails, the
 *   next tick is delayed by 2× the base interval, capped at maxIntervalMs.
 *   On any partial or full success the interval resets to baseIntervalMs.
 */

import { tenantMemberRoleName } from './provisioning.js'
import type { TenantRegistry } from './tenant-registry.js'
import type { KeycloakAdminClient } from './keycloak-admin-client.js'
import { KeycloakAdminError } from './keycloak-admin-client.js'

export interface RoleSyncRetryOptions {
  tenantRegistry: TenantRegistry
  keycloakAdminClient: Pick<KeycloakAdminClient, 'assignClientRoleToUser'>
  /** Base polling interval in ms. Default: 60_000 (60 s). */
  baseIntervalMs?: number
  /** Maximum polling interval after backoff. Default: 300_000 (5 min). */
  maxIntervalMs?: number
}

export interface RoleSyncRetryLoop {
  /** Stops the retry loop. Safe to call multiple times. */
  stop(): void
}

/**
 * Starts the background role-sync retry loop. Returns a handle whose `.stop()`
 * method can be called during graceful shutdown to cancel the next scheduled
 * tick.
 *
 * Only call this once per process (from index.ts, after the server starts).
 * Tests should NOT call this — pass `enableRoleSyncRetry: false` to createApp
 * and start the loop explicitly from the bootstrap file if needed.
 */
export function startRoleSyncRetryLoop(options: RoleSyncRetryOptions): RoleSyncRetryLoop {
  const {
    tenantRegistry,
    keycloakAdminClient,
    baseIntervalMs = 60_000,
    maxIntervalMs = 300_000,
  } = options

  if (!Number.isInteger(baseIntervalMs) || baseIntervalMs < 1) {
    throw new Error(`Invalid baseIntervalMs: ${baseIntervalMs}. Expected a positive integer.`)
  }
  if (!Number.isInteger(maxIntervalMs) || maxIntervalMs < baseIntervalMs) {
    throw new Error(
      `Invalid maxIntervalMs: ${maxIntervalMs}. Expected an integer >= baseIntervalMs (${baseIntervalMs}).`,
    )
  }

  let stopped = false
  let currentIntervalMs = baseIntervalMs
  let timer: ReturnType<typeof setTimeout> | undefined

  async function tick(): Promise<void> {
    if (stopped) return

    let accounts: Awaited<ReturnType<typeof tenantRegistry.getPortalAccountsPendingRoleSync>>

    try {
      accounts = await tenantRegistry.getPortalAccountsPendingRoleSync()
    } catch (queryError) {
      console.warn('[role-sync-retry] Failed to query pending accounts — will retry next tick:', queryError)
      scheduleNext(false)
      return
    }

    if (accounts.length === 0) {
      scheduleNext(true)
      return
    }

    let anyAccountSucceeded = false

    for (const account of accounts) {
      if (stopped) return

      const keycloakSub = account.keycloakSub

      if (!keycloakSub) {
        // Should not happen (getPortalAccountsPendingRoleSync filters these
        // out), but guard defensively.
        continue
      }

      let ownedTenants: Awaited<ReturnType<typeof tenantRegistry.listTenantsByOwnerId>>

      try {
        ownedTenants = await tenantRegistry.listTenantsByOwnerId(account.id)
      } catch (listError) {
        console.warn(
          `[role-sync-retry] Failed to list tenants for account "${account.id}" — skipping this tick:`,
          listError,
        )
        continue
      }

      let accountAllSucceeded = true

      for (const tenant of ownedTenants) {
        if (stopped) return

        const tenantClientId = `dnd-notes-tenant-${tenant.id}`

        try {
          await keycloakAdminClient.assignClientRoleToUser(
            keycloakSub,
            tenantClientId,
            tenantMemberRoleName,
          )
        } catch (assignError) {
          if (
            assignError instanceof KeycloakAdminError &&
            assignError.statusCode === 404
          ) {
            // Keycloak client not found — tenant deprovisioned or never had a
            // KC client. Log and treat as a resolved slot (not retryable).
            console.warn(
              `[role-sync-retry] Keycloak client "${tenantClientId}" not found for account "${account.id}" — treating slot as resolved (tenant may be deprovisioned).`,
            )
          } else {
            accountAllSucceeded = false
            console.warn(
              `[role-sync-retry] Role assignment failed for tenant "${tenant.id}" / account "${account.id}" — will retry next tick:`,
              assignError,
            )
          }
        }
      }

      if (accountAllSucceeded) {
        anyAccountSucceeded = true

        try {
          await tenantRegistry.markRoleSyncComplete(account.id)
          console.log(`[role-sync-retry] Role-sync complete for account "${account.id}".`)
        } catch (markError) {
          console.warn(
            `[role-sync-retry] Failed to mark role-sync complete for account "${account.id}":`,
            markError,
          )
        }
      }
    }

    scheduleNext(anyAccountSucceeded)
  }

  function scheduleNext(anySuccessInTick: boolean): void {
    if (stopped) return

    if (anySuccessInTick) {
      currentIntervalMs = baseIntervalMs
    } else {
      currentIntervalMs = Math.min(currentIntervalMs * 2, maxIntervalMs)
    }

    timer = setTimeout(() => {
      tick().catch((unexpectedError) => {
        console.error('[role-sync-retry] Unexpected error in tick:', unexpectedError)
        scheduleNext(false)
      })
    }, currentIntervalMs)
  }

  // Kick off the first tick after one base interval (not immediately, so that
  // the server finishes starting before we hit the database).
  timer = setTimeout(() => {
    tick().catch((unexpectedError) => {
      console.error('[role-sync-retry] Unexpected error in first tick:', unexpectedError)
      scheduleNext(false)
    })
  }, baseIntervalMs)

  return {
    stop() {
      stopped = true

      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
  }
}
