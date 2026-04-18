import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { NoteStore } from './note-store.js'
import { registerAdminRoutes } from './routes/admin-routes.js'
import { registerAuthRoutes } from './routes/auth-routes.js'
import { registerOwnerCampaignRoutes } from './routes/owner-campaign-routes.js'
import { registerOwnerNoteRoutes } from './routes/owner-note-routes.js'
import { registerSharedRoutes } from './routes/shared-routes.js'
import {
  normalizePublicWebUrl,
  type RateLimitPolicy,
} from './route-support.js'
import type { ErrorResponse, HealthResponse } from './types.js'
interface RateLimitBucket {
  count: number
  resetAt: number
}

interface CreateAppOptions {
  noteStore: NoteStore
  publicWebUrl?: string
  allowedOrigins?: string
  restoreNoteStore?: (sourcePath: string) => NoteStore
  serveWeb?: boolean
}

function readRateLimitClientId(request: Request) {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

export function createApp({
  noteStore: initialNoteStore,
  publicWebUrl: configuredPublicWebUrl,
  allowedOrigins: configuredAllowedOrigins,
  restoreNoteStore,
  serveWeb = false,
}: CreateAppOptions): Express {
  const app = express()
  let noteStore = initialNoteStore
  const rateLimitBuckets = new Map<string, RateLimitBucket>()
  const publicWebUrl = normalizePublicWebUrl(configuredPublicWebUrl)

  function isRateLimited(
    request: Request,
    response: Response<ErrorResponse>,
    policyKey: string,
    policy: RateLimitPolicy,
    scopeKey?: string,
  ) {
    const now = Date.now()

    for (const [key, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) {
        rateLimitBuckets.delete(key)
      }
    }

    const bucketKey = [
      policyKey,
      readRateLimitClientId(request),
      scopeKey ?? '',
    ].join(':')
    const existingBucket = rateLimitBuckets.get(bucketKey)

    if (!existingBucket || existingBucket.resetAt <= now) {
      rateLimitBuckets.set(bucketKey, {
        count: 1,
        resetAt: now + policy.windowMs,
      })
      return false
    }

    if (existingBucket.count >= policy.maxRequests) {
      response.set(
        'Retry-After',
        Math.max(1, Math.ceil((existingBucket.resetAt - now) / 1000)).toString(),
      )
      response.status(429).json({ error: policy.errorMessage })
      return true
    }

    existingBucket.count += 1
    return false
  }

  const routeContext = {
    getNoteStore: () => noteStore,
    setNoteStore: (restoredNoteStore: NoteStore) => {
      noteStore = restoredNoteStore
    },
    publicWebUrl,
    restoreNoteStore,
    isRateLimited,
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

  app.use(express.json())

  // Liveness probe - process is alive
  app.get('/healthz', (_request: Request, response: Response<HealthResponse>) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  // Readiness probe - ready to serve traffic
  app.get('/readyz', (_request: Request, response: Response<HealthResponse | ErrorResponse>) => {
    try {
      noteStore.getAdminOverview()
      response.json({ status: 'ok', service: 'dnd-notes-api' })
    } catch {
      response.status(503).json({
        error: 'Database unavailable',
      })
    }
  })

  // Legacy health endpoint for backward compatibility
  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
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
    const webDistPath = join(__dirname, '..', '..', 'web', 'dist')
    
    app.use(express.static(webDistPath))
    
    // SPA fallback - serve index.html for all non-API/health routes
    app.use((_request: Request, response: Response, next) => {
      const path = _request.path
      if (path.startsWith('/api/') || path.startsWith('/health') || path.startsWith('/readyz')) {
        next()
      } else {
        response.sendFile(join(webDistPath, 'index.html'))
      }
    })
  }

  return app
}
