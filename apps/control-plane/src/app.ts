import { createRequire } from 'node:module'
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { z } from 'zod'
import {
  ControlPlaneAuthError,
  createControlPlaneAdminAuth,
  type ControlPlaneAdminAuth,
} from './keycloak-auth.js'
import {
  TenantProvisioningConflictError,
  TenantProvisioningValidationError,
  type TenantProvisioningPort,
} from './provisioning.js'
import type { TenantRegistry } from './tenant-registry.js'
import { tenantStates } from './types.js'
import type {
  FleetStatusResponse,
  PortalAccount,
  PortalCatalogResponse,
  PortalDashboardResponse,
  PortalLogoutResponse,
  PortalSession,
  PortalSessionResponse,
  PortalTenantSummary,
  TenantDeprovisionResponse,
  ErrorResponse,
  HealthResponse,
  StateTransitionHistoryResponse,
  TenantDetailResponse,
  TenantListResponse,
  TenantProvisioningResponse,
} from './types.js'
import { portalBillingProviders } from './types.js'

function createTenantStateCounts() {
  return Object.fromEntries(tenantStates.map((state) => [state, 0])) as Record<
    (typeof tenantStates)[number],
    number
  >
}

function readMetadataString(
  metadata: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string') {
      const trimmedValue = value.trim()
      if (trimmedValue.length > 0) {
        return trimmedValue
      }
    }
  }

  return null
}

function parseBackupMetadata(rawMetadata: string | null) {
  const normalizedRawMetadata =
    rawMetadata && hasBackupMetadata(rawMetadata) ? rawMetadata.trim() : null
  const emptyStatus = {
    rawMetadata: normalizedRawMetadata,
    location: null,
    lastBackupAt: null,
    lastBackupStatus: null,
    lastRestoreDrillAt: null,
    lastRestoreDrillStatus: null,
  }

  if (!normalizedRawMetadata) {
    return emptyStatus
  }

  try {
    const parsed = JSON.parse(normalizedRawMetadata)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return emptyStatus
    }

    const metadata = parsed as Record<string, unknown>

    return {
      rawMetadata: normalizedRawMetadata,
      location: readMetadataString(metadata, ['location', 'backupLocation']),
      lastBackupAt: readMetadataString(metadata, ['lastBackupAt', 'lastBackup']),
      lastBackupStatus: readMetadataString(metadata, [
        'lastBackupStatus',
        'backupStatus',
      ]),
      lastRestoreDrillAt: readMetadataString(metadata, [
        'lastRestoreDrillAt',
        'lastRestoreDrill',
      ]),
      lastRestoreDrillStatus: readMetadataString(metadata, [
        'lastRestoreDrillStatus',
        'restoreDrillStatus',
        'lastRestoreStatus',
      ]),
    }
  } catch {
    return emptyStatus
  }
}

function hasBackupMetadata(rawMetadata: string | null) {
  return rawMetadata !== null && rawMetadata.trim().length > 0
}

interface RateLimitBucket {
  count: number
  resetAt: number
}

interface RateLimitPolicy {
  maxRequests: number
  windowMs: number
  errorMessage: string
}

interface CreateAppOptions {
  tenantRegistry: TenantRegistry
  adminToken?: string
  adminAuth?: ControlPlaneAdminAuth
  tenantProvisioningService?: TenantProvisioningPort
  trustProxy?: boolean | number
  portalAuthMode?: 'local' | 'keycloak'
  portalDefaultTenantVersion?: string
  tenantBaseDomain?: string
  tenantPublicScheme?: 'http' | 'https'
}

const require = createRequire(import.meta.url)
const { version: appVersion } = require('../package.json') as { version: string }

const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const portalSessionLifetimeMs = 30 * 24 * 60 * 60 * 1000
const internalRoutePrefix = '/internal'
const tenantRoutePrefix = `${internalRoutePrefix}/tenants`
const portalRoutePrefix = '/portal'
const dummyPortalPasswordHash = `${'0'.repeat(32)}:${'0'.repeat(128)}`
const portalPlanCatalog = [
  {
    id: 'adventurer',
    name: 'Adventurer',
    priceLabel: '$9/mo placeholder',
    description: 'A focused home for a single campaign and its session notes.',
    features: ['One tenant instance', 'Core notes workspace', 'Billing integration placeholder'],
  },
  {
    id: 'guild',
    name: 'Guild',
    priceLabel: '$29/mo placeholder',
    description: 'Adds room for multiple groups with future team-management hooks.',
    features: ['Expanded collaboration headroom', 'Priority onboarding queue', 'Team invites placeholder'],
  },
  {
    id: 'realm',
    name: 'Realm',
    priceLabel: 'Contact us placeholder',
    description: 'For larger communities that want guided rollout and future analytics.',
    features: ['Dedicated launch planning', 'Usage analytics placeholder', 'White-glove support lane'],
  },
] as const
const portalPlanSchema = z.enum(['adventurer', 'guild', 'realm'])
const rateLimitBucketSweepIntervalMs = 60 * 1000
const portalSignupRateLimitPolicy: RateLimitPolicy = {
  maxRequests: 5,
  windowMs: 1000 * 60 * 15,
  errorMessage: 'Too many portal signup attempts. Please wait before trying again.',
}
const portalLoginRateLimitPolicy: RateLimitPolicy = {
  maxRequests: 5,
  windowMs: 1000 * 60 * 15,
  errorMessage: 'Too many portal login attempts. Please wait before trying again.',
}

const createTenantSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(63).regex(tenantSlugPattern),
  ownerId: z.string().min(1),
  initialAdminEmail: z.string().trim().email().optional(),
  version: z.string().min(1),
})

const tenantStateSchema = z.enum(tenantStates)
const portalBillingProviderSchema = z.enum(portalBillingProviders)

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

const portalSignupSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(200),
  billingEmail: z.string().trim().email().optional(),
  paymentProvider: portalBillingProviderSchema,
  tenantName: z.string().trim().min(1).max(80),
  tenantSlug: z.string().min(1).max(63).regex(tenantSlugPattern),
  planTier: portalPlanSchema,
  acceptTerms: z.literal(true),
})

const portalLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
})

const portalCreateTenantSchema = z.object({
  tenantName: z.string().trim().min(1).max(80),
  tenantSlug: z.string().min(1).max(63).regex(tenantSlugPattern),
  planTier: portalPlanSchema,
  paymentProvider: portalBillingProviderSchema,
  billingEmail: z.string().trim().email().optional(),
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

function buildRolloutFailureDetails(tenantId: string) {
  return `Rolling update failed for tenant ${tenantId}. The control plane marked the tenant failed; inspect the latest transition and control-plane logs before retrying.`
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

function readRateLimitClientId(request: Request) {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown'
}

function normalizePortalEmail(email: string) {
  return email.trim().toLowerCase()
}

function createPortalSessionToken() {
  return randomBytes(32).toString('hex')
}

function hashPortalSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function formatSqliteUtcDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds(),
  )}`
}

function derivePortalPasswordKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }

      resolve(derivedKey as Buffer)
    })
  })
}

async function createPortalPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = (await derivePortalPasswordKey(password, salt)).toString('hex')
  return `${salt}:${derivedKey}`
}

async function verifyPortalPassword(password: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(':')

  if (!salt || !expectedHex) {
    return false
  }

  const provided = await derivePortalPasswordKey(password, salt)
  const expected = Buffer.from(expectedHex, 'hex')

  if (provided.length !== expected.length) {
    return false
  }

  return timingSafeEqual(provided, expected)
}

function buildPortalSessionExpiry() {
  return formatSqliteUtcDateTime(new Date(Date.now() + portalSessionLifetimeMs))
}

interface PortalAuthenticatedRequest extends Request {
  portalAccount?: PortalAccount
  portalSession?: PortalSession
}

function createAdminAuthMiddleware(
  adminToken: string | undefined,
  adminAuth: ControlPlaneAdminAuth,
): express.RequestHandler {
  return async (request, response, next) => {
    const authorizationHeader = request.header('authorization')

    if (!authorizationHeader?.startsWith('Bearer ')) {
      request.resume()
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const token = authorizationHeader.slice('Bearer '.length).trim()

    if (adminAuth.mode === 'static') {
      if (!adminToken || token !== adminToken) {
        request.resume()
        response.status(401).json({ error: 'Unauthorized' })
        return
      }

      next()
      return
    }

    try {
      await adminAuth.authorizeBearerToken(token)
      next()
    } catch (error) {
      if (error instanceof ControlPlaneAuthError) {
        request.resume()
        response.status(error.statusCode).json({ error: error.message })
        return
      }

      next(error)
    }
  }
}

function createPortalSessionMiddleware(
  tenantRegistry: TenantRegistry,
): express.RequestHandler {
  return (request, response, next) => {
    const authorizationHeader = request.header('authorization')

    if (!authorizationHeader?.startsWith('Bearer ')) {
      request.resume()
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const rawToken = authorizationHeader.slice('Bearer '.length).trim()
    const tokenHash = hashPortalSessionToken(rawToken)
    const portalSession = tenantRegistry.getPortalSessionByTokenHash(tokenHash)

    if (!portalSession) {
      request.resume()
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const portalAccount = tenantRegistry.getPortalAccount(portalSession.accountId)

    if (!portalAccount) {
      request.resume()
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const portalRequest = request as PortalAuthenticatedRequest
    portalRequest.portalSession = portalSession
    portalRequest.portalAccount = portalAccount
    next()
  }
}

export function createApp({
  tenantRegistry,
  adminToken,
  adminAuth = createControlPlaneAdminAuth({ mode: 'static' }),
  tenantProvisioningService,
  trustProxy = false,
  portalAuthMode = 'local',
  portalDefaultTenantVersion = appVersion,
  tenantBaseDomain,
  tenantPublicScheme = 'https',
}: CreateAppOptions): Express {
  const app = express()
  app.set('trust proxy', trustProxy)
  const portalJsonParser = express.json({ limit: '16kb' })
  const rateLimitBuckets = new Map<string, RateLimitBucket>()
  let nextRateLimitBucketSweepAt = 0
  const buildHealthResponse = (): HealthResponse => ({
    status: 'healthy',
    uptime: process.uptime(),
    version: appVersion,
  })
  const buildFleetStatusResponse = (): FleetStatusResponse => {
    const latestTransitionsByTenant = tenantRegistry.getLatestStateTransitions()
    const tenantsByCurrentState = createTenantStateCounts()
    const tenantsByDesiredState = createTenantStateCounts()
    const tenantsByVersion: Record<string, number> = {}
    let tenantsWithBackupMetadata = 0
    let tenantsMissingBackupMetadata = 0
    let tenantsNeedingAttention = 0

    const tenants = tenantRegistry.listTenants().map((tenant) => {
      tenantsByCurrentState[tenant.currentState] += 1
      tenantsByDesiredState[tenant.desiredState] += 1
      tenantsByVersion[tenant.version] = (tenantsByVersion[tenant.version] ?? 0) + 1

      if (hasBackupMetadata(tenant.backupMetadata)) {
        tenantsWithBackupMetadata += 1
      } else {
        tenantsMissingBackupMetadata += 1
      }

      const needsAttention =
        tenant.currentState !== 'ready' ||
        tenant.currentState !== tenant.desiredState ||
        !hasBackupMetadata(tenant.backupMetadata)
      const health: 'healthy' | 'attention' = needsAttention
        ? 'attention'
        : 'healthy'

      if (needsAttention) {
        tenantsNeedingAttention += 1
      }

      return {
        tenant,
        health,
        backup: parseBackupMetadata(tenant.backupMetadata),
        latestTransition: latestTransitionsByTenant.get(tenant.id) ?? null,
      }
    })

    return {
      generatedAt: new Date().toISOString(),
      controlPlane: buildHealthResponse(),
      dependencies: {
        tenantRegistry: {
          status: 'healthy',
        },
        tenantProvisioning: tenantProvisioningService
          ? {
              status: 'healthy',
              details: 'Tenant provisioning service configured.',
            }
          : {
              status: 'disabled',
              details: 'Tenant provisioning is disabled in this environment.',
            },
      },
      summary: {
        totalTenants: tenants.length,
        tenantsByCurrentState,
        tenantsByDesiredState,
        tenantsByVersion,
        tenantsWithBackupMetadata,
        tenantsMissingBackupMetadata,
        tenantsNeedingAttention,
      },
      tenants,
    }
  }
  const buildPortalCatalogResponse = (): PortalCatalogResponse => ({
    authMode: portalAuthMode,
    defaultTenantVersion: portalDefaultTenantVersion,
    provisioningConfigured: tenantProvisioningService !== undefined,
    slugPolicy: {
      pattern: tenantSlugPattern.source,
      maxLength: 63,
      example: 'misty-harbor',
    },
    plans: portalPlanCatalog.map((plan) => ({
      id: plan.id,
      name: plan.name,
      priceLabel: plan.priceLabel,
      description: plan.description,
      features: [...plan.features],
    })),
    placeholders: {
      billingStatus: 'placeholder',
      teamInvites: 'coming-soon',
      usageAnalytics: 'coming-soon',
    },
  })
  const buildPortalAppUrl = (subdomain: string | null) => {
    if (!subdomain || !tenantBaseDomain) {
      return null
    }

    return `${tenantPublicScheme}://${subdomain}.${tenantBaseDomain}`
  }
  const buildPortalTenantSummary = (
    tenantId: string,
  ): PortalTenantSummary | null => {
    const latestTransitionsByTenant = tenantRegistry.getLatestStateTransitions()
    const tenant = tenantRegistry.getTenant(tenantId)

    if (!tenant) {
      return null
    }

    return {
      tenant,
      latestTransition: latestTransitionsByTenant.get(tenant.id) ?? null,
      backup: parseBackupMetadata(tenant.backupMetadata),
      appUrl: buildPortalAppUrl(tenant.subdomain),
      settingsPath: `/dashboard/tenants/${tenant.id}`,
    }
  }
  const buildPortalDashboardResponse = (
    account: PortalAccount,
  ): PortalDashboardResponse => {
    const latestTransitionsByTenant = tenantRegistry.getLatestStateTransitions()
    const tenants = tenantRegistry.listTenantsByOwnerId(account.id).map((tenant) => ({
      tenant,
      latestTransition: latestTransitionsByTenant.get(tenant.id) ?? null,
      backup: parseBackupMetadata(tenant.backupMetadata),
      appUrl: buildPortalAppUrl(tenant.subdomain),
      settingsPath: `/dashboard/tenants/${tenant.id}`,
    }))

    return {
      account,
      catalog: buildPortalCatalogResponse(),
      tenants,
    }
  }
  const buildPortalSessionResponse = (account: PortalAccount): PortalSessionResponse => {
    const token = createPortalSessionToken()
    tenantRegistry.createPortalSession({
      id: randomUUID(),
      accountId: account.id,
      tokenHash: hashPortalSessionToken(token),
      expiresAt: buildPortalSessionExpiry(),
    })

    return {
      token,
      dashboard: buildPortalDashboardResponse(account),
    }
  }
  const isRateLimited = (
    request: Request,
    response: Response<ErrorResponse>,
    policyKey: string,
    policy: RateLimitPolicy,
  ) => {
    const now = Date.now()

    if (now >= nextRateLimitBucketSweepAt) {
      for (const [key, bucket] of rateLimitBuckets) {
        if (bucket.resetAt <= now) {
          rateLimitBuckets.delete(key)
        }
      }

      nextRateLimitBucketSweepAt = now + rateLimitBucketSweepIntervalMs
    }

    const bucketKey = [policyKey, readRateLimitClientId(request)].join(':')
    const existingBucket = rateLimitBuckets.get(bucketKey)

    if (!existingBucket || existingBucket.resetAt <= now) {
      rateLimitBuckets.set(bucketKey, {
        count: 1,
        resetAt: now + policy.windowMs,
      })
      return false
    }

    if (existingBucket.count >= policy.maxRequests) {
      request.resume()
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
  const ensurePortalLocalAuthEnabled = (
    response: Response<ErrorResponse>,
  ): boolean => {
    if (portalAuthMode === 'local') {
      return true
    }

    response.status(501).json({
      error:
        'Portal Keycloak auth is not implemented yet. Use local portal auth for this slice.',
    })
    return false
  }
  const createPortalRateLimitMiddleware = (
    policyKey: string,
    policy: RateLimitPolicy,
  ) => {
    return (
      request: Request,
      response: Response<ErrorResponse>,
      next: NextFunction,
    ) => {
      if (isRateLimited(request, response, policyKey, policy)) {
        return
      }

      next()
    }
  }
  const rollbackPortalTenant = async (params: {
    tenantId: string
    ownerId: string
    reason: string
  }) => {
    const existingTenant = tenantRegistry.getTenant(params.tenantId)

    if (!existingTenant) {
      return
    }

    let deprovisionError: Error | null = null

    if (tenantProvisioningService) {
      try {
        await tenantProvisioningService.deprovisionTenant({
          tenantId: params.tenantId,
          triggeredBy: `portal:${params.ownerId}`,
          reason: params.reason,
        })
      } catch (error) {
        deprovisionError =
          error instanceof Error ? error : new Error(getErrorMessage(error))
      }
    }

    if (tenantRegistry.getTenant(params.tenantId)) {
      tenantRegistry.deleteTenant(params.tenantId)
    }

    if (deprovisionError) {
      throw deprovisionError
    }
  }
  const provisionPortalTenant = async (params: {
    ownerId: string
    ownerEmail: string
    tenantName: string
    tenantSlug: string
    planTier: z.infer<typeof portalPlanSchema>
    paymentProvider: z.infer<typeof portalBillingProviderSchema>
  }): Promise<PortalTenantSummary> => {
    const { ownerId, ownerEmail, tenantName, tenantSlug, planTier, paymentProvider } = params
    const existingSlug = tenantRegistry.getTenantBySlug(tenantSlug)

    if (existingSlug) {
      throw new Error('Tenant slug already exists')
    }

    const tenant = tenantRegistry.createTenant({
      id: `tenant-${randomBytes(8).toString('hex')}`,
      slug: tenantSlug,
      ownerId,
      displayName: tenantName,
      planTier,
      initialAdminEmail: ownerEmail,
      version: portalDefaultTenantVersion,
    })

    try {
      if (tenantProvisioningService) {
        await tenantProvisioningService.provisionTenant({
          tenantId: tenant.id,
          triggeredBy: `portal:${ownerId}`,
          reason: `Portal self-serve (${planTier}, ${paymentProvider})`,
          version: portalDefaultTenantVersion,
        })
      }

      const summary = buildPortalTenantSummary(tenant.id)

      if (!summary) {
        throw new Error('Failed to build portal tenant summary')
      }

      return summary
    } catch (error) {
      try {
        await rollbackPortalTenant({
          tenantId: tenant.id,
          ownerId,
          reason: `Portal rollback after failed tenant provisioning (${planTier}, ${paymentProvider})`,
        })
      } catch (cleanupError) {
        throw new Error(
          `${getErrorMessage(error)}; cleanup failed: ${getErrorMessage(cleanupError)}`,
          { cause: cleanupError },
        )
      }

      throw error
    }
  }
  const createPortalTenant = async (params: {
    account: PortalAccount
    tenantName: string
    tenantSlug: string
    planTier: z.infer<typeof portalPlanSchema>
    paymentProvider: z.infer<typeof portalBillingProviderSchema>
    billingEmail?: string
  }): Promise<{ tenantSummary: PortalTenantSummary; account: PortalAccount }> => {
    const { account, tenantName, tenantSlug, planTier, paymentProvider, billingEmail } =
      params
    const normalizedBillingEmail =
      billingEmail?.trim() ?? account.billingEmail ?? account.email
    const tenantSummary = await provisionPortalTenant({
      ownerId: account.id,
      ownerEmail: account.email,
      tenantName,
      tenantSlug,
      planTier,
      paymentProvider,
    })

    try {
      return {
        tenantSummary,
        account: tenantRegistry.updatePortalAccount(account.id, {
          displayName: account.displayName,
          billingEmail: normalizedBillingEmail,
          billingProvider: paymentProvider,
        }),
      }
    } catch (error) {
      try {
        await rollbackPortalTenant({
          tenantId: tenantSummary.tenant.id,
          ownerId: account.id,
          reason: 'Portal rollback after failed account update',
        })
      } catch (cleanupError) {
        throw new Error(
          `${getErrorMessage(error)}; cleanup failed: ${getErrorMessage(cleanupError)}`,
          { cause: cleanupError },
        )
      }

      throw error
    }
  }
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
  app.use(internalRoutePrefix, createAdminAuthMiddleware(adminToken, adminAuth))
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
    `${portalRoutePrefix}/catalog`,
    (_request: Request, response: Response<PortalCatalogResponse>) => {
      response.json(buildPortalCatalogResponse())
    },
  )

  app.post(
    `${portalRoutePrefix}/signup`,
    createPortalRateLimitMiddleware('portal-signup', portalSignupRateLimitPolicy),
    portalJsonParser,
    async (
      request: Request,
      response: Response<PortalSessionResponse | ErrorResponse>,
    ) => {
      if (!ensurePortalLocalAuthEnabled(response)) {
        return
      }

      const parseResult = portalSignupSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const normalizedEmail = normalizePortalEmail(parseResult.data.email)
      const normalizedBillingEmail =
        parseResult.data.billingEmail?.trim() ?? normalizedEmail

      let createdAccount: PortalAccount | null = null

      try {
        const existingAccount = tenantRegistry.getPortalAccountByEmail(normalizedEmail)
        if (existingAccount) {
          response.status(409).json({
            error: 'Portal account already exists',
            details:
              'An account already exists for that email. Sign in instead of signing up again.',
          })
          return
        }

        createdAccount = tenantRegistry.createPortalAccount({
          id: randomUUID(),
          email: normalizedEmail,
          displayName: parseResult.data.displayName,
          passwordHash: await createPortalPasswordHash(parseResult.data.password),
          billingEmail: normalizedBillingEmail,
          billingProvider: parseResult.data.paymentProvider,
        })

        const { account } = await createPortalTenant({
          account: createdAccount,
          tenantName: parseResult.data.tenantName,
          tenantSlug: parseResult.data.tenantSlug,
          planTier: parseResult.data.planTier,
          paymentProvider: parseResult.data.paymentProvider,
          billingEmail: normalizedBillingEmail,
        })

        response.status(201).json(buildPortalSessionResponse(account))
      } catch (error) {
        let effectiveError = error

        if (createdAccount) {
          try {
            tenantRegistry.deletePortalAccount(createdAccount.id)
          } catch (accountCleanupError) {
            effectiveError = new Error(
              `${getErrorMessage(error)}; account cleanup failed: ${getErrorMessage(accountCleanupError)}`,
              { cause: accountCleanupError },
            )
          }
        }

        if (isSqliteConstraintError(effectiveError) || effectiveError instanceof Error) {
          const errorMessage = effectiveError.message
          const conflictStatus = errorMessage.includes('already exists') ? 409 : 500
          response.status(conflictStatus).json({
            error:
              conflictStatus === 409
                ? 'Portal signup conflict'
                : 'Failed to complete portal signup',
            details: errorMessage,
          })
          return
        }

        response.status(500).json({ error: 'Failed to complete portal signup' })
      }
    },
  )

  app.post(
    `${portalRoutePrefix}/login`,
    createPortalRateLimitMiddleware('portal-login', portalLoginRateLimitPolicy),
    portalJsonParser,
    async (
      request: Request,
      response: Response<PortalSessionResponse | ErrorResponse>,
    ) => {
      if (!ensurePortalLocalAuthEnabled(response)) {
        return
      }

      const parseResult = portalLoginSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      const normalizedEmail = normalizePortalEmail(parseResult.data.email)
      const authRecord = tenantRegistry.getPortalAccountAuthByEmail(normalizedEmail)
      const storedHash =
        authRecord?.account.authProvider === 'local' && authRecord.passwordHash
          ? authRecord.passwordHash
          : dummyPortalPasswordHash
      const passwordMatches = await verifyPortalPassword(
        parseResult.data.password,
        storedHash,
      )
      const passwordIsValid =
        authRecord?.account.authProvider === 'local' &&
        authRecord.passwordHash !== null &&
        passwordMatches

      if (!authRecord || !passwordIsValid) {
        response.status(401).json({
          error: 'Unauthorized',
          details: 'Email or password is incorrect.',
        })
        return
      }

      response.json(buildPortalSessionResponse(authRecord.account))
    },
  )

  app.get(
    `${portalRoutePrefix}/me`,
    createPortalSessionMiddleware(tenantRegistry),
    (
      request: Request,
      response: Response<PortalDashboardResponse | ErrorResponse>,
    ) => {
      const portalRequest = request as PortalAuthenticatedRequest
      const portalAccount = portalRequest.portalAccount

      if (!portalAccount) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }

      response.json(buildPortalDashboardResponse(portalAccount))
    },
  )

  app.post(
    `${portalRoutePrefix}/me/tenants`,
    createPortalSessionMiddleware(tenantRegistry),
    portalJsonParser,
    async (
      request: Request,
      response: Response<PortalDashboardResponse | ErrorResponse>,
    ) => {
      const portalRequest = request as PortalAuthenticatedRequest
      const portalAccount = portalRequest.portalAccount

      if (!portalAccount) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }

      const parseResult = portalCreateTenantSchema.safeParse(request.body)

      if (!parseResult.success) {
        response.status(400).json({
          error: 'Invalid request body',
          details: parseResult.error.message,
        })
        return
      }

      try {
        await createPortalTenant({
          account: portalAccount,
          tenantName: parseResult.data.tenantName,
          tenantSlug: parseResult.data.tenantSlug,
          planTier: parseResult.data.planTier,
          paymentProvider: parseResult.data.paymentProvider,
          billingEmail: parseResult.data.billingEmail,
        })

        const refreshedAccount = tenantRegistry.getPortalAccount(portalAccount.id)

        if (!refreshedAccount) {
          response.status(500).json({ error: 'Portal account not found' })
          return
        }

        response.status(201).json(buildPortalDashboardResponse(refreshedAccount))
      } catch (error) {
        if (isSqliteConstraintError(error) || error instanceof Error) {
          const errorMessage = error.message
          const conflictStatus = errorMessage.includes('already exists') ? 409 : 500
          response.status(conflictStatus).json({
            error:
              conflictStatus === 409
                ? 'Portal tenant conflict'
                : 'Failed to create portal tenant',
            details: errorMessage,
          })
          return
        }

        response.status(500).json({ error: 'Failed to create portal tenant' })
      }
    },
  )

  app.post(
    `${portalRoutePrefix}/logout`,
    createPortalSessionMiddleware(tenantRegistry),
    portalJsonParser,
    (
      request: Request,
      response: Response<PortalLogoutResponse | ErrorResponse>,
    ) => {
      const portalRequest = request as PortalAuthenticatedRequest
      const portalSession = portalRequest.portalSession

      if (!portalSession) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }

      tenantRegistry.deletePortalSessionByTokenHash(portalSession.tokenHash)
      response.json({ signedOut: true })
    },
  )

  app.get(
    '/internal/fleet/status',
    (
      _request: Request,
      response: Response<FleetStatusResponse | ErrorResponse>,
    ) => {
      try {
        tenantRegistry.checkHealth()
        response.json(buildFleetStatusResponse())
      } catch {
        response.status(503).json({
          error: 'Tenant registry unavailable',
        })
      }
    },
  )

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

      const { id, slug, ownerId, initialAdminEmail, version } = parseResult.data

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
          initialAdminEmail,
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

      const requestedProvisionVersion = parseResult.data.version?.trim()
      const isRolloutRequest =
        requestedProvisionVersion !== undefined &&
        requestedProvisionVersion !== existingTenant.version

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
            code: error.code,
            error: 'Invalid tenant provisioning request',
            details: error.message,
          })
          return
        }

        if (error instanceof TenantProvisioningConflictError) {
          response.status(409).json({
            code: error.code,
            error: 'Tenant rolling update conflict',
            details: error.message,
          })
          return
        }

        if (isRolloutRequest) {
          response.status(500).json({
            code: 'tenant_rollout_failed',
            error: 'Tenant rolling update failed',
            details: buildRolloutFailureDetails(tenantId),
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
