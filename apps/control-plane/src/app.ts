import { createRequire } from 'node:module'
import express, { type Express, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  TenantProvisioningValidationError,
  type TenantProvisioningPort,
} from './provisioning.js'
import type { TenantRegistry } from './tenant-registry.js'
import { tenantStates } from './types.js'
import type {
  TenantDeprovisionResponse,
  ErrorResponse,
  HealthResponse,
  StateTransitionHistoryResponse,
  TenantDetailResponse,
  TenantListResponse,
  TenantProvisioningResponse,
} from './types.js'

interface CreateAppOptions {
  tenantRegistry: TenantRegistry
  adminToken: string
  tenantProvisioningService?: TenantProvisioningPort
}

const require = createRequire(import.meta.url)
const { version: appVersion } = require('../package.json') as { version: string }

const createTenantSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  ownerId: z.string().min(1),
  version: z.string().min(1),
})

const tenantStateSchema = z.enum(tenantStates)
const internalRoutePrefix = '/internal'
const tenantRoutePrefix = `${internalRoutePrefix}/tenants`

const updateStateSchema = z.object({
  state: tenantStateSchema,
  triggeredBy: z.string().min(1),
  reason: z.string().min(1).optional(),
})

const updateDesiredStateSchema = z.object({
  desiredState: tenantStateSchema,
})

const updateStorageSchema = z.object({
  storageReference: z.string().min(1),
})

const updateBackupSchema = z.object({
  backupMetadata: z.string().min(1),
})

const provisionTenantSchema = z.object({
  triggeredBy: z.string().min(1),
  reason: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
})

const deprovisionTenantSchema = z.object({
  triggeredBy: z.string().min(1),
  reason: z.string().min(1).optional(),
})

function isSqliteConstraintError(
  error: unknown,
): error is Error & { code?: string } {
  if (!(error instanceof Error)) {
    return false
  }

  const sqliteCode = (error as Error & { code?: string }).code

  if (
    sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  ) {
    return true
  }

  return (
    (sqliteCode === 'SQLITE_CONSTRAINT' || typeof sqliteCode !== 'string') &&
    (error.message.includes('UNIQUE constraint failed') ||
      error.message.includes('PRIMARY KEY constraint failed'))
  )
}

function getTenantConflictResponse(error: Error): ErrorResponse {
  if (error.message.includes('tenants.id')) {
    return { error: 'Tenant ID already exists' }
  }

  if (error.message.includes('tenants.slug')) {
    return { error: 'Tenant slug already exists' }
  }

  return { error: 'Tenant already exists' }
}

function createAdminAuthMiddleware(adminToken: string): express.RequestHandler {
  return (request, response, next) => {
    const authorizationHeader = request.header('authorization')
    if (authorizationHeader !== `Bearer ${adminToken}`) {
      request.resume()
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    next()
  }
}

export function createApp({
  tenantRegistry,
  adminToken,
  tenantProvisioningService,
}: CreateAppOptions): Express {
  const app = express()
  const buildHealthResponse = (): HealthResponse => ({
    status: 'healthy',
    uptime: process.uptime(),
    version: appVersion,
  })
  const readinessHandler = (
    _request: Request,
    response: Response<HealthResponse | ErrorResponse>,
  ) => {
    try {
      tenantRegistry.checkHealth()
      response.json(buildHealthResponse())
    } catch {
      response.status(503).json({
        error: 'Tenant registry unavailable',
      })
    }
  }

  app.disable('x-powered-by')
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('X-XSS-Protection', '1; mode=block')
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    next()
  })
  app.use(internalRoutePrefix, createAdminAuthMiddleware(adminToken))
  app.use(internalRoutePrefix, express.json())

  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json(buildHealthResponse())
  })

  app.get('/healthz', (_request: Request, response: Response<HealthResponse>) => {
    response.json(buildHealthResponse())
  })

  app.get('/readyz', readinessHandler)
  app.get('/ready', readinessHandler)

  app.get(
    tenantRoutePrefix,
    (_request: Request, response: Response<TenantListResponse>) => {
      const tenants = tenantRegistry.listTenants()
      response.json({ tenants })
    },
  )

  app.get(
    `${tenantRoutePrefix}/:tenantId`,
    (
      request: Request<{ tenantId: string }>,
      response: Response<TenantDetailResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params
      const tenant = tenantRegistry.getTenant(tenantId)

      if (!tenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      response.json({ tenant })
    },
  )

  app.post(
    tenantRoutePrefix,
    (
      request: Request,
      response: Response<TenantDetailResponse | ErrorResponse>,
    ) => {
      const parseResult = createTenantSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const { id, slug, ownerId, version } = parseResult.data

      const existingTenant = tenantRegistry.getTenant(id)
      if (existingTenant) {
        response.status(409).json({ error: 'Tenant ID already exists' })
        return
      }

      const existingSlug = tenantRegistry.getTenantBySlug(slug)
      if (existingSlug) {
        response.status(409).json({ error: 'Tenant slug already exists' })
        return
      }

      try {
        const tenant = tenantRegistry.createTenant({
          id,
          slug,
          ownerId,
          version,
        })
        response.status(201).json({ tenant })
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          response.status(409).json(getTenantConflictResponse(error))
          return
        }

        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        response.status(500).json({
          error: 'Failed to create tenant',
          details: errorMessage,
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/state`,
    (
      request: Request<{ tenantId: string }>,
      response: Response<TenantDetailResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params
      const parseResult = updateStateSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const { state, triggeredBy, reason } = parseResult.data

      const tenant = tenantRegistry.getTenant(tenantId)

      if (!tenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        tenantRegistry.updateTenantState(
          tenantId,
          state,
          triggeredBy,
          reason,
        )

        const updatedTenant = tenantRegistry.getTenant(tenantId)

        if (!updatedTenant) {
          response.status(500).json({ error: 'Failed to retrieve updated tenant' })
          return
        }

        response.json({ tenant: updatedTenant })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        response.status(500).json({
          error: 'Failed to update tenant state',
          details: errorMessage,
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/desired-state`,
    (
      request: Request<{ tenantId: string }>,
      response: Response<TenantDetailResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params
      const parseResult = updateDesiredStateSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const { desiredState } = parseResult.data

      const existingTenant = tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        tenantRegistry.updateTenantDesiredState(tenantId, desiredState)
        const tenant = tenantRegistry.getTenant(tenantId)

        if (!tenant) {
          response.status(404).json({ error: 'Tenant not found' })
          return
        }

        response.json({ tenant })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        response.status(500).json({
          error: 'Failed to update desired state',
          details: errorMessage,
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/storage`,
    (
      request: Request<{ tenantId: string }>,
      response: Response<TenantDetailResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params
      const parseResult = updateStorageSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const { storageReference } = parseResult.data

      const existingTenant = tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        tenantRegistry.updateTenantStorageReference(tenantId, storageReference)
        const tenant = tenantRegistry.getTenant(tenantId)

        if (!tenant) {
          response.status(404).json({ error: 'Tenant not found' })
          return
        }

        response.json({ tenant })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        response.status(500).json({
          error: 'Failed to update storage reference',
          details: errorMessage,
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/backup`,
    (
      request: Request<{ tenantId: string }>,
      response: Response<TenantDetailResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params
      const parseResult = updateBackupSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const { backupMetadata } = parseResult.data

      const existingTenant = tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        tenantRegistry.updateTenantBackupMetadata(tenantId, backupMetadata)
        const tenant = tenantRegistry.getTenant(tenantId)

        if (!tenant) {
          response.status(404).json({ error: 'Tenant not found' })
          return
        }

        response.json({ tenant })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        response.status(500).json({
          error: 'Failed to update backup metadata',
          details: errorMessage,
        })
      }
    },
  )

  app.get(
    `${tenantRoutePrefix}/:tenantId/transitions`,
    (
      request: Request<{ tenantId: string }>,
      response: Response<StateTransitionHistoryResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params

      const tenant = tenantRegistry.getTenant(tenantId)
      if (!tenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      const transitions = tenantRegistry.getStateTransitions(tenantId)
      response.json({ transitions })
    },
  )

  app.post(
    `${tenantRoutePrefix}/:tenantId/provision`,
    async (
      request: Request<{ tenantId: string }>,
      response: Response<TenantProvisioningResponse | ErrorResponse>,
    ) => {
      if (!tenantProvisioningService) {
        response.status(501).json({
          error: 'Tenant provisioning is not configured',
        })
        return
      }

      const { tenantId } = request.params
      const parseResult = provisionTenantSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const existingTenant = tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        const provisioningResult = await tenantProvisioningService.provisionTenant({
          tenantId,
          triggeredBy: parseResult.data.triggeredBy,
          reason: parseResult.data.reason,
          version: parseResult.data.version,
        })
        response.json(provisioningResult)
      } catch (error) {
        if (error instanceof TenantProvisioningValidationError) {
          response.status(400).json({
            error: 'Invalid tenant provisioning request',
            details: error.message,
          })
          return
        }

        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        response.status(500).json({
          error: 'Failed to provision tenant resources',
          details: errorMessage,
        })
      }
    },
  )

  app.post(
    `${tenantRoutePrefix}/:tenantId/deprovision`,
    async (
      request: Request<{ tenantId: string }>,
      response: Response<TenantDeprovisionResponse | ErrorResponse>,
    ) => {
      if (!tenantProvisioningService) {
        response.status(501).json({
          error: 'Tenant provisioning is not configured',
        })
        return
      }

      const { tenantId } = request.params
      const parseResult = deprovisionTenantSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const existingTenant = tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        const deprovisionResult =
          await tenantProvisioningService.deprovisionTenant({
            tenantId,
            triggeredBy: parseResult.data.triggeredBy,
            reason: parseResult.data.reason,
          })
        response.json(deprovisionResult)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        response.status(500).json({
          error: 'Failed to deprovision tenant resources',
          details: errorMessage,
        })
      }
    },
  )

  return app
}
