import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join } from 'node:path'
import {
  createStubTenantRuntimeAuth,
  type TenantRuntimeAuth,
} from './keycloak-auth.js'
import type { NoteStore } from './note-store.js'
import { registerAdminRoutes } from './routes/admin-routes.js'
import { registerAuthRoutes } from './routes/auth-routes.js'
import {
  controlMaintenanceErrorCode,
  registerControlRoutes,
} from './routes/control-routes.js'
import { registerOwnerCampaignRoutes } from './routes/owner-campaign-routes.js'
import { registerOwnerNoteRoutes } from './routes/owner-note-routes.js'
import { registerSharedRoutes } from './routes/shared-routes.js'
import { applySharedLinkPolicy, normalizePublicWebUrl } from './route-support.js'
import { createControlState, type ControlState } from './control-state.js'
import { tenantApiSchemaVersion } from './migrations.js'
import type { ErrorResponse, HealthResponse } from './types.js'
import { createReadLimiter } from './rate-limiters.js'

export const noteStoreSchemaVersion = tenantApiSchemaVersion
const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const defaultMaintenanceDrainGraceMs = 5_000

interface CreateAppOptions {
  noteStore: NoteStore
  publicWebUrl?: string
  allowedOrigins?: string
  runtimeAuth?: TenantRuntimeAuth
  isShuttingDown?: () => boolean
  serveWeb?: boolean
  webDistPath?: string
  controlPlaneToken?: string | null
  appVersion?: string
  schemaVersion?: string
  tenantId?: string | null
  maintenanceDrainGraceMs?: number
  controlState?: ControlState
  trustProxy?: boolean | number
}

export function createApp({
  noteStore: initialNoteStore,
  publicWebUrl: configuredPublicWebUrl,
  allowedOrigins: configuredAllowedOrigins,
  runtimeAuth = createStubTenantRuntimeAuth(),
  isShuttingDown = () => false,
  serveWeb = false,
  webDistPath,
  controlPlaneToken = null,
  appVersion = process.env.APP_VERSION ?? 'unknown',
  schemaVersion = noteStoreSchemaVersion,
  tenantId = null,
  maintenanceDrainGraceMs = defaultMaintenanceDrainGraceMs,
  controlState = createControlState(),
  trustProxy = false,
}: CreateAppOptions): Express {
  const app = express()
  // When the tenant API runs behind nginx ingress (k3d, hosted), `trustProxy`
  // must be set so express resolves req.ip from `X-Forwarded-For` instead of
  // the proxy hop's IP. Without it, express-rate-limit groups every request
  // under one key and innocent visitors hit 429 on a fresh page load (#322).
  app.set('trust proxy', trustProxy)
  const noteStore = initialNoteStore
  const publicWebUrl = normalizePublicWebUrl(configuredPublicWebUrl)
  const spaFallbackReadLimiter = createReadLimiter()

  const routeContext = {
    getNoteStore: () => noteStore,
    publicWebUrl,
    runtimeAuth,
  }

  // CORS configuration - explicit origin allowlist for security
  const allowedOrigins = (configuredAllowedOrigins ?? process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., mobile apps, curl, Postman)
        if (!origin) {
          callback(null, true)
          return
        }

        // Check if origin is in allowlist
        if (allowedOrigins.includes(origin)) {
          callback(null, true)
          return
        }

        // Reject origin
        callback(new Error('CORS policy: Origin not allowed'))
      },
      credentials: true,
    }),
  )

  // Security headers middleware
  app.use((_request, response, next) => {
    // Prevent MIME type sniffing
    response.setHeader('X-Content-Type-Options', 'nosniff')

    // Prevent clickjacking for API routes (frame-ancestors CSP applied per-route for shared links)
    response.setHeader('X-Frame-Options', 'DENY')

    // XSS protection (legacy header, but doesn't hurt)
    response.setHeader('X-XSS-Protection', '1; mode=block')

    // Don't send referrer to external sites
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

    next()
  })

  // Maintenance write gate. Reads keep working because only write methods are
  // blocked, so readiness/liveness GET handlers still pass through and
  // /_control/* stays reachable for toggles.
  app.use((request, response: Response<ErrorResponse & { code?: string }>, next) => {
    if (controlState.maintenance.mode !== 'enabled') {
      next()
      return
    }

    if (!writeMethods.has(request.method)) {
      next()
      return
    }

    if (request.path.startsWith('/_control/')) {
      next()
      return
    }

    response.set('Retry-After', '60')
    response.status(503).json({
      code: controlMaintenanceErrorCode,
      error: 'Tenant is in maintenance mode; write operations are paused.',
    })
  })

  // Track in-flight writes and last-write timestamp for /_control/info reporting
  // and for the maintenance grace-window drain.
  app.use((request, response, next) => {
    const shouldTrackWrite =
      writeMethods.has(request.method) &&
      !request.path.startsWith('/_control/')

    if (!shouldTrackWrite) {
      next()
      return
    }

    controlState.inflightWrites += 1
    let settled = false
    const settle = ({ updateLastWriteAt }: { updateLastWriteAt: boolean }) => {
      if (settled) {
        return
      }

      settled = true
      controlState.inflightWrites = Math.max(
        0,
        controlState.inflightWrites - 1,
      )

      if (updateLastWriteAt && response.statusCode < 400) {
        controlState.lastWriteAt = new Date().toISOString()
      }
    }

    response.on('finish', () => settle({ updateLastWriteAt: true }))
    response.on('close', () => settle({ updateLastWriteAt: false }))

    next()
  })

  app.use(express.json())

  // Liveness probe - process is alive
  app.get('/healthz', (_request: Request, response: Response<HealthResponse>) => {
    controlState.lastProbeAt = new Date().toISOString()
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  const handleReadiness = async (
    _request: Request,
    response: Response<HealthResponse | ErrorResponse>,
  ) => {
    controlState.lastProbeAt = new Date().toISOString()

    if (isShuttingDown()) {
      response.status(503).json({
        error: 'Shutting down',
      })
      return
    }

    try {
      await noteStore.checkHealth()
      response.json({ status: 'ok', service: 'dnd-notes-api' })
    } catch {
      response.status(503).json({
        error: 'Database unavailable',
      })
    }
  }

  // Readiness probes - /ready is the control-plane contract, /readyz stays for legacy probe compatibility.
  app.get('/ready', handleReadiness)
  app.get('/readyz', handleReadiness)

  // Legacy health endpoint for backward compatibility
  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  registerControlRoutes(app, {
    getNoteStore: () => noteStore,
    controlState,
    controlPlaneToken,
    appVersion,
    schemaVersion,
    tenantId,
    drainGraceMs: maintenanceDrainGraceMs,
  })

  registerAdminRoutes(app, routeContext)
  registerAuthRoutes(app, routeContext)
  registerOwnerCampaignRoutes(app, routeContext)
  registerOwnerNoteRoutes(app, routeContext)
  registerSharedRoutes(app, routeContext)

  // Serve static web assets when in production container mode
  if (serveWeb) {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const resolvedWebDistPath = webDistPath ?? join(__dirname, '..', '..', 'web', 'dist')

    app.use(express.static(resolvedWebDistPath))

    // SPA fallback - serve index.html for browser navigation requests only
    app.use(spaFallbackReadLimiter, async (request: Request, response: Response, next) => {
      const isDocumentRequest = request.method === 'GET' || request.method === 'HEAD'
      const path = request.path
      const acceptsHtml = Boolean(request.accepts('html'))
      const looksLikeFileRequest = extname(path) !== ''

      if (
        !isDocumentRequest ||
        !acceptsHtml ||
        looksLikeFileRequest ||
        path === '/api' ||
        path.startsWith('/api/') ||
        path.startsWith('/_control/') ||
        path === '/health' ||
        path === '/healthz' ||
        path === '/ready' ||
        path === '/readyz'
      ) {
        next()
        return
      }

      // For share-link document routes, remove X-Frame-Options and set
      // frame-ancestors from the share link's configured policy.  All other
      // SPA routes keep the global X-Frame-Options: DENY set by middleware.
      const shareMatch = path.match(/^\/share\/([^/]+)\/?$/)
      if (shareMatch) {
        const shareToken = shareMatch[1]
        let frameAncestors: string | null = null
        try {
          const shareLink = await noteStore.getCampaignShareLinkByToken(shareToken)
          frameAncestors = shareLink?.frameAncestors ?? null
        } catch {
          // DB hiccup — fall back to locked policy ('none') and still serve the document
        }
        applySharedLinkPolicy(response, frameAncestors)
      }

      response.sendFile('index.html', { root: resolvedWebDistPath })
    })
  }

  return app
}
