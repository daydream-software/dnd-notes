/**
 * Activator request handler — factory with injected dependencies so the wake /
 * proxy hot path is unit-testable. index.ts wires the real clients; tests pass
 * fakes.
 *
 * Wake-on-request flow (Pattern B):
 *   - replicas >= 1: upsert activity, proxy directly.
 *   - replicas == 0: coalesce a wake (patch replicas to 1 + wait for a ready
 *     endpoint). How the caller waits depends on the request kind (#395):
 *       * navigation: hold for the full cold-start budget, then proxy or 503.
 *       * non-navigation (XHR/API): hold only a short grace window; if not
 *         ready by then, answer a recognizable "warming" 503 + Retry-After so
 *         the client retries, while the wake continues in the background. The
 *         marker is emitted strictly before proxying, so no mutation occurred
 *         and the client may safely retry POST/PUT/PATCH.
 */

import { setTimeout as delay } from 'node:timers/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeploymentWatcher } from './deployment-watch.js'
import type { ActivatorMetrics } from './metrics.js'
import { proxyRequest as defaultProxyRequest } from './proxy.js'
import { isNavigationRequest } from './request-kind.js'
import type { TenantActivityStore } from './tenant-activity.js'
import type { createTenantResolver, TenantCoordinates } from './tenant-resolver.js'

type TenantResolver = ReturnType<typeof createTenantResolver>

export interface RequestHandlerConfig {
  /** Max cold-start budget before a navigation gets a 503. */
  coldStartTimeoutMs: number
  /**
   * How long a non-navigation request holds waiting for readiness before
   * answering a warming 503. Absorbs fast wakes without a 503 round-trip.
   */
  graceHoldMs: number
  /** Retry-After (seconds) advertised on the warming 503. */
  warmingRetryAfterSeconds: number
}

export interface RequestHandlerDeps {
  resolver: TenantResolver
  watcher: DeploymentWatcher
  activityStore: TenantActivityStore
  metrics: ActivatorMetrics
  config: RequestHandlerConfig
  /** Injectable for tests; defaults to the real reverse proxy. */
  proxyRequest?: typeof defaultProxyRequest
  /** Injectable abortable sleep for the grace window; defaults to a real timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal }) as Promise<void>
}

export function createRequestHandler(
  deps: RequestHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { resolver, watcher, activityStore, metrics, config } = deps
  const proxyRequest = deps.proxyRequest ?? defaultProxyRequest
  const sleep = deps.sleep ?? defaultSleep

  // Wake coalescing: track in-progress wake attempts per tenant namespace to
  // avoid concurrent PATCH replicas: 1 storms.
  const wakeInProgress = new Map<string, Promise<boolean>>()

  // Get-or-create the coalesced wake for a tenant. Kicks the scale-up and
  // background readiness wait; resolves true once a ready endpoint appears
  // within the cold-start budget, false on timeout. Re-entrant: concurrent
  // callers share one wake.
  function ensureWake(coords: TenantCoordinates): Promise<boolean> {
    const { namespace, deploymentName, serviceName, subdomain } = coords
    let wakePromise = wakeInProgress.get(namespace)
    if (!wakePromise) {
      wakePromise = (async (): Promise<boolean> => {
        try {
          console.log(`[activator] waking tenant ${subdomain} (namespace: ${namespace})`)
          // Stamp activity before scaling up (defense-in-depth, not a
          // synchronization primitive — fire-and-forget). The deterministic
          // #354 guard is hasActivitySince in the idle-scaler; this early stamp
          // narrows the window where an idle-scaler tick lands mid-cold-start,
          // sees last_request_at already advanced, and skips the scale-down.
          void activityStore.recordActivity(subdomain).catch((err: unknown) => {
            console.warn('[activator] activity upsert failed for %s:', subdomain, err instanceof Error ? err.message : String(err))
          })
          await watcher.patchReplicas(namespace, deploymentName, 1)
          const ready = await watcher.waitForReadyEndpoint(
            namespace,
            serviceName,
            deploymentName,
            config.coldStartTimeoutMs,
            () => {
              metrics.podScheduleDeadlineExceeded.inc({ tenant: subdomain })
            },
          )
          if (ready) {
            // Make the wake eagerly authoritative: flip current_state
            // sleeping -> ready now rather than waiting for the idle-scaler
            // sync-back, so the operator portal reflects the live tenant (#385).
            void activityStore.markReady(subdomain).catch((err: unknown) => {
              console.warn('[activator] markReady failed for %s:', subdomain, err instanceof Error ? err.message : String(err))
            })
          }
          return ready
        } finally {
          wakeInProgress.delete(namespace)
        }
      })()
      wakeInProgress.set(namespace, wakePromise)
    }
    return wakePromise
  }

  function sendWarming503(res: ServerResponse, subdomain: string): void {
    metrics.warmingResponsesTotal.inc({ tenant: subdomain })
    console.log(`[activator] tenant ${subdomain} still waking — returning warming 503`)
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Retry-After': String(config.warmingRetryAfterSeconds),
      'X-Activator-Wake': 'warming',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify({
      error: 'Workspace is waking from sleep. Retry shortly.',
      code: 'tenant_waking',
      retryable: true,
    }))
  }

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Health and metrics endpoints bypass the proxy
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }

    if (req.method === 'GET' && req.url === '/readyz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }

    if (req.method === 'GET' && req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': metrics.contentType })
      res.end(metrics.metrics())
      return
    }

    // Resolve the tenant from the Host header
    const tenant = resolver.resolve(req.headers['host'])
    if (!tenant) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unroutable_host', details: 'Host header does not match a known tenant pattern' }))
      return
    }

    const { namespace, deploymentName, upstreamUrl, subdomain } = tenant

    let heldConnection = false

    try {
      // Get current replica count (cache miss falls back to API GET)
      const replicas = await watcher.getReplicas(namespace, deploymentName)

      if (replicas >= 1) {
        // Tenant is warm — upsert activity and proxy directly
        void activityStore.recordActivity(subdomain).catch((err: unknown) => {
          console.warn('[activator] activity upsert failed for %s:', subdomain, err instanceof Error ? err.message : String(err))
        })
        await proxyRequest(req, res, { url: upstreamUrl })
        return
      }

      // Tenant is sleeping — coalesce concurrent wake attempts
      metrics.wakeTotal.inc({ tenant: subdomain })
      metrics.heldConnections.inc()
      heldConnection = true
      const wakeStart = Date.now()
      const wakePromise = ensureWake(tenant)

      if (isNavigationRequest(req)) {
        // Navigation: hold for the full cold-start budget (an interstitial
        // replaces this hold in #396), then proxy or answer 503.
        const ready = await wakePromise
        const durationSeconds = (Date.now() - wakeStart) / 1000
        metrics.coldStartDuration.observe({ tenant: subdomain }, durationSeconds)
        metrics.heldConnections.dec()
        heldConnection = false

        if (!ready) {
          metrics.errorTotal.inc({ tenant: subdomain, reason: 'cold_start_timeout' })
          console.warn(`[activator] cold-start timeout for ${subdomain} after ${durationSeconds.toFixed(1)}s`)
          res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '10' })
          res.end(JSON.stringify({
            error: 'cold_start_timeout',
            details: 'Workspace is taking longer than expected to start. Try again in a moment.',
            retryable: true,
          }))
          return
        }

        console.log(`[activator] tenant ${subdomain} cold-start complete in ${durationSeconds.toFixed(1)}s`)
        void activityStore.recordActivity(subdomain).catch((err: unknown) => {
          console.warn('[activator] activity upsert failed for %s:', subdomain, err instanceof Error ? err.message : String(err))
        })
        await proxyRequest(req, res, { url: upstreamUrl })
        return
      }

      // Non-navigation (XHR/API): hold only the grace window; if not ready,
      // answer a warming 503 (the wake keeps running in the background).
      const graceTimer = new AbortController()
      const outcome = await Promise.race<'ready' | 'failed' | 'grace'>([
        // Attaches a handler to wakePromise, so its rejection is observed even
        // when the grace timer wins the race. A wake error still answers a
        // (retryable) warming 503, but is logged + counted here — the nav path
        // gets this via the outer catch; this branch must not swallow it.
        wakePromise.then(
          (ready) => (ready ? 'ready' : 'failed'),
          (err: unknown) => {
            metrics.errorTotal.inc({ tenant: subdomain, reason: 'wake_error' })
            console.error('[activator] wake failed for %s:', subdomain, err instanceof Error ? err.message : String(err))
            return 'failed'
          },
        ),
        // Maps both fulfilment and post-race abort to 'grace' so an aborted
        // timer never surfaces as an unhandled rejection.
        sleep(config.graceHoldMs, graceTimer.signal).then(() => 'grace', () => 'grace'),
      ]).finally(() => {
        graceTimer.abort() // cancel the grace timer when the wake won the race
      })

      metrics.heldConnections.dec()
      heldConnection = false

      if (outcome === 'ready') {
        const durationSeconds = (Date.now() - wakeStart) / 1000
        metrics.coldStartDuration.observe({ tenant: subdomain }, durationSeconds)
        console.log(`[activator] tenant ${subdomain} cold-start complete within grace in ${durationSeconds.toFixed(1)}s`)
        void activityStore.recordActivity(subdomain).catch((err: unknown) => {
          console.warn('[activator] activity upsert failed for %s:', subdomain, err instanceof Error ? err.message : String(err))
        })
        await proxyRequest(req, res, { url: upstreamUrl })
        return
      }

      // Grace elapsed, or the wake failed/timed out — tell the client to retry.
      sendWarming503(res, subdomain)
    } catch (err) {
      if (heldConnection) {
        metrics.heldConnections.dec()
      }
      const reason = err instanceof Error && err.message.includes('ECONNREFUSED') ? 'upstream_refused' : 'internal_error'
      metrics.errorTotal.inc({ tenant: subdomain, reason })
      console.error('[activator] error handling request for %s:', subdomain, err instanceof Error ? err.message : String(err))
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'gateway_error', details: 'Activator encountered an error' }))
      }
    }
  }
}
