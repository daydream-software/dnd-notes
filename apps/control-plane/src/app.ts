import express, { type Express, type Request, type Response } from 'express'
import { z } from 'zod'
import type { TenantRegistry } from './tenant-registry.js'
import { tenantStates } from './types.js'
import type {
  ErrorResponse,
  HealthResponse,
  StateTransitionHistoryResponse,
  TenantDetailResponse,
  TenantListResponse,
  TenantState,
} from './types.js'

interface CreateAppOptions {
  tenantRegistry: TenantRegistry
}

const createTenantSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  ownerId: z.string().min(1),
  version: z.string().min(1),
})

const tenantStateSchema = z.enum(tenantStates)

const updateStateSchema = z.object({
  state: tenantStateSchema,
  triggeredBy: z.string().min(1),
  reason: z.string().optional(),
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

function isSqliteConstraintError(
  error: unknown,
): error is Error & { code?: string } {
  const sqliteCode = (error as Error & { code?: string })?.code

  return (
    error instanceof Error &&
    (typeof sqliteCode === 'string'
      ? sqliteCode.startsWith('SQLITE_CONSTRAINT')
      : error.message.includes('UNIQUE constraint failed'))
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

export function createApp({ tenantRegistry }: CreateAppOptions): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())

  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json({
      status: 'healthy',
      uptime: process.uptime(),
      version: '0.1.0',
    })
  })

  app.get(
    '/api/tenants',
    (_request: Request, response: Response<TenantListResponse>) => {
      const tenants = tenantRegistry.listTenants()
      response.json({ tenants })
    },
  )

  app.get(
    '/api/tenants/:tenantId',
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
    '/api/tenants',
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
    '/api/tenants/:tenantId/state',
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
          state as TenantState,
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
    '/api/tenants/:tenantId/desired-state',
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
        tenantRegistry.updateTenantDesiredState(
          tenantId,
          desiredState as TenantState,
        )
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
    '/api/tenants/:tenantId/storage',
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
    '/api/tenants/:tenantId/backup',
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
    '/api/tenants/:tenantId/transitions',
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

  return app
}
