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

import http from 'node:http'
import { createDeploymentWatcher } from './deployment-watch.js'
import { createMetrics } from './metrics.js'
import { createRequestHandler } from './request-handler.js'
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

watcher.start()
console.log('[activator] Kubernetes Watch streams started.')

const handleRequest = createRequestHandler({
  resolver,
  watcher,
  activityStore,
  metrics,
  config: { coldStartTimeoutMs: COLD_START_TIMEOUT_MS },
})

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
