/**
 * Activator request handler — factory with injected dependencies so the wake /
 * proxy hot path is unit-testable. index.ts wires the real clients; tests pass
 * fakes.
 *
 * Behavior is the wake-on-request flow from the architecture doc (Pattern B):
 *   - replicas >= 1: upsert activity, proxy directly.
 *   - replicas == 0: coalesce a wake (patch replicas to 1 + wait for a ready
 *     endpoint), then proxy when ready or answer 503 on timeout.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeploymentWatcher } from './deployment-watch.js'
import type { ActivatorMetrics } from './metrics.js'
import { proxyRequest as defaultProxyRequest } from './proxy.js'
import type { TenantActivityStore } from './tenant-activity.js'
import type { createTenantResolver } from './tenant-resolver.js'

type TenantResolver = ReturnType<typeof createTenantResolver>

export interface RequestHandlerConfig {
  /** Max cold-start budget before answering 503. */
  coldStartTimeoutMs: number
}

export interface RequestHandlerDeps {
  resolver: TenantResolver
  watcher: DeploymentWatcher
  activityStore: TenantActivityStore
  metrics: ActivatorMetrics
  config: RequestHandlerConfig
  /** Injectable for tests; defaults to the real reverse proxy. */
  proxyRequest?: typeof defaultProxyRequest
}

export function createRequestHandler(
  deps: RequestHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { resolver, watcher, activityStore, metrics, config } = deps
  const proxyRequest = deps.proxyRequest ?? defaultProxyRequest

  // Wake coalescing: track in-progress wake attempts per tenant namespace to
  // avoid concurrent PATCH replicas: 1 storms.
  const wakeInProgress = new Map<string, Promise<boolean>>()

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

    const { namespace, deploymentName, serviceName, upstreamUrl, subdomain } = tenant

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

      let wakePromise = wakeInProgress.get(namespace)
      if (!wakePromise) {
        wakePromise = (async (): Promise<boolean> => {
          try {
            console.log(`[activator] waking tenant ${subdomain} (namespace: ${namespace})`)
            // Stamp activity before scaling up (defense-in-depth, not a
            // synchronization primitive — this is fire-and-forget). The
            // deterministic #354 guard is hasActivitySince in the idle-scaler;
            // this early stamp narrows the window where an idle-scaler tick lands
            // mid-cold-start, sees last_request_at already advanced, and skips the
            // scale-down instead of clobbering the wake.
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

      const ready = await wakePromise
      const durationSeconds = (Date.now() - wakeStart) / 1000
      metrics.coldStartDuration.observe({ tenant: subdomain }, durationSeconds)
      if (heldConnection) {
        metrics.heldConnections.dec()
        heldConnection = false
      }

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
