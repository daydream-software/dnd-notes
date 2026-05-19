/**
 * Activator service — wake-on-request HTTP proxy for scale-to-zero tenants.
 *
 * Architecture (Pattern B from the spike doc):
 *   Each tenant IngressRoute points to the activator as its sole backend.
 *   The activator inspects the tenant Deployment's replica count:
 *     - replicas >= 1: upsert last_request_at, proxy directly.
 *     - replicas == 0: patch replicas: 1, hold connection, wait for ready
 *       endpoint, then upsert last_request_at and proxy.
 *
 * Endpoints:
 *   GET  /healthz   - liveness probe
 *   GET  /readyz    - readiness probe
 *   GET  /metrics   - Prometheus text format
 *   *    *          - reverse proxy (any other path/method)
 *
 * Environment variables:
 *   PORT                        - HTTP port (default: 8080)
 *   BASE_DOMAIN                 - e.g. "notes.daydreamsoftware.ca"
 *   TENANT_PORT                 - port tenant app listens on (default: 3000)
 *   CONTROL_PLANE_DATABASE_URL  - Postgres connection string for tenant_activity
 *   COLD_START_TIMEOUT_MS       - max cold-start budget (default: 60000)
 *   POD_SCHEDULE_BUDGET_MS      - Pending-past-budget threshold (default: 30000)
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { createDeploymentWatcher } from './deployment-watch.js'
import { createMetrics } from './metrics.js'
import { proxyRequest } from './proxy.js'
import { createTenantActivityStore } from './tenant-activity.js'
import { createTenantResolver } from './tenant-resolver.js'

const PORT = Number(process.env['PORT'] ?? '8080')
const BASE_DOMAIN = process.env['BASE_DOMAIN'] ?? ''
const TENANT_PORT = Number(process.env['TENANT_PORT'] ?? '3000')
const CONTROL_PLANE_DATABASE_URL = process.env['CONTROL_PLANE_DATABASE_URL'] ?? ''
const COLD_START_TIMEOUT_MS = Number(process.env['COLD_START_TIMEOUT_MS'] ?? '60000')
const POD_SCHEDULE_BUDGET_MS = Number(process.env['POD_SCHEDULE_BUDGET_MS'] ?? '30000')

if (!BASE_DOMAIN) {
  console.error('[activator] BASE_DOMAIN is required')
  process.exit(1)
}

if (!CONTROL_PLANE_DATABASE_URL) {
  console.error('[activator] CONTROL_PLANE_DATABASE_URL is required')
  process.exit(1)
}

const metrics = createMetrics()
const resolver = createTenantResolver({ baseDomain: BASE_DOMAIN, tenantPort: TENANT_PORT })
const watcher = createDeploymentWatcher({ podScheduleBudgetMs: POD_SCHEDULE_BUDGET_MS })
const activityStore = createTenantActivityStore({ databaseUrl: CONTROL_PLANE_DATABASE_URL })

// Wake coalescing: track in-progress wake attempts per tenant namespace to
// avoid concurrent PATCH replicas: 1 storms.
const wakeInProgress = new Map<string, Promise<boolean>>()

watcher.start()
console.log('[activator] Kubernetes Watch streams started.')

/**
 * Handle a single incoming HTTP request.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
          await watcher.patchReplicas(namespace, deploymentName, 1)
          const ready = await watcher.waitForReadyEndpoint(
            namespace,
            serviceName,
            deploymentName,
            COLD_START_TIMEOUT_MS,
            () => {
              metrics.podScheduleDeadlineExceeded.inc({ tenant: subdomain })
            },
          )
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

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[activator] unhandled error in request handler:', err)
    if (!res.headersSent) {
      res.writeHead(500)
      res.end()
    }
  })
})

server.listen(PORT, () => {
  console.log(`[activator] listening on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('[activator] SIGTERM received, shutting down.')
  watcher.stop()
  server.close(async () => {
    await activityStore.close()
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('[activator] SIGINT received, shutting down.')
  watcher.stop()
  server.close(async () => {
    await activityStore.close()
    process.exit(0)
  })
})
