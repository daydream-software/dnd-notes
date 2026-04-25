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
import {
  TenantControlError,
  type TenantControlClient,
} from './tenant-control-client.js'
import { formatUnknownError } from './error-formatting.js'
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
  TenantStorageBackupReadiness,
  TenantStorageSnapshot,
  TenantStorageStatus,
  TenantStorageStatusResponse,
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

const successfulCutoverBackupStatuses = new Set([
  'ok',
  'passed',
  'success',
  'succeeded',
  'completed',
])

function describeTenantCutoverBackupReadiness(
  rawMetadata: string | null,
): TenantStorageBackupReadiness {
  const backup = parseBackupMetadata(rawMetadata)

  if (!backup.rawMetadata) {
    return {
      ...backup,
      status: 'missing',
      details: 'Record a successful backup before tenant cutover can start.',
    }
  }

  if (!backup.location || !backup.lastBackupAt) {
    return {
      ...backup,
      status: 'invalid',
      details: 'Backup metadata must include both location and lastBackupAt before cutover.',
    }
  }

  const normalizedStatus = backup.lastBackupStatus?.trim().toLowerCase() ?? null

  if (!normalizedStatus) {
    return {
      ...backup,
      status: 'invalid',
      details:
        'Backup metadata must include a successful lastBackupStatus before cutover.',
    }
  }

  if (normalizedStatus && !successfulCutoverBackupStatuses.has(normalizedStatus)) {
    return {
      ...backup,
      status: 'invalid',
      details: `Latest backup status "${backup.lastBackupStatus}" is not cutover-ready.`,
    }
  }

  return {
    ...backup,
    status: 'ready',
    details: 'Latest backup metadata is sufficient for cutover gating.',
  }
}

function buildTenantStorageStatus(snapshot: TenantStorageSnapshot): TenantStorageStatus {
  const backup = describeTenantCutoverBackupReadiness(snapshot.backupMetadata)
  const blockers: string[] = []

  if (snapshot.currentState !== 'ready') {
    blockers.push(
      `Tenant must be ready before cutover (current state: ${snapshot.currentState}).`,
    )
  }

  if (snapshot.desiredState !== 'ready') {
    blockers.push(
      `Tenant desired state must be ready before cutover (desired state: ${snapshot.desiredState}).`,
    )
  }

  if (snapshot.mode === 'unknown') {
    blockers.push('Tenant storage mode is unknown; inspect runtime wiring before cutover.')
  }

  if (snapshot.migrationStatus === 'in-progress') {
    blockers.push('Tenant storage cutover is already in progress.')
  }

  if (
    snapshot.mode === 'postgres-dedicated-user' &&
    (snapshot.migrationStatus === 'not-required' ||
      snapshot.migrationStatus === 'completed')
  ) {
    blockers.push('Tenant already uses the target dedicated Postgres runtime shape.')
  }

  if (backup.status !== 'ready') {
    blockers.push(backup.details)
  }

  return {
    tenantId: snapshot.tenantId,
    currentState: snapshot.currentState,
    desiredState: snapshot.desiredState,
    storageReference: snapshot.storageReference,
    mode: snapshot.mode,
    migrationStatus: snapshot.migrationStatus,
    lastMigrationFailure: snapshot.lastMigrationFailure,
    migrationUpdatedAt: snapshot.migrationUpdatedAt,
    cutoverReady: blockers.length === 0,
    blockers,
    backup,
  }
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
  tenantControlClient?: TenantControlClient
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

type ConstraintConflictError = Error & { code?: string; constraint?: string }

function readConstraintName(error: Error): string | undefined {
  const constraint = (error as ConstraintConflictError).constraint
  if (typeof constraint !== 'string') {
    return undefined
  }

  const normalizedConstraint = constraint.trim()
  return normalizedConstraint.length > 0 ? normalizedConstraint : undefined
}

function isConstraintConflictError(
  error: unknown,
): error is ConstraintConflictError {
  if (!(error instanceof Error)) {
    return false
  }

  const errorCode = (error as Error & { code?: string }).code

  if (
    errorCode === '23505' ||
    errorCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    errorCode === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  ) {
    return true
  }

  return (
    (errorCode === 'SQLITE_CONSTRAINT' || typeof errorCode !== 'string') &&
    (error.message.includes('UNIQUE constraint failed') ||
      error.message.includes('PRIMARY KEY constraint failed') ||
      error.message.includes('duplicate key value violates unique constraint'))
  )
}

function getTenantConflictResponse(error: ConstraintConflictError): ErrorResponse {
  const constraint = readConstraintName(error)

  if (constraint === 'tenants_pkey') {
    return { error: 'Tenant ID already exists' }
  }

  if (constraint === 'tenants_slug_key') {
    return { error: 'Tenant slug already exists' }
  }

  if (
    error.message.includes('tenants.id') ||
    error.message.includes('tenants_pkey')
  ) {
    return { error: 'Tenant ID already exists' }
  }

  if (
    error.message.includes('tenants.slug') ||
    error.message.includes('tenants_slug_key')
  ) {
    return { error: 'Tenant slug already exists' }
  }

  return { error: 'Tenant already exists' }
}

function getPortalSignupConflictResponse(
  error: ConstraintConflictError,
): ErrorResponse {
  const constraint = readConstraintName(error)

  if (constraint === 'portal_accounts_email_key') {
    return {
      error: 'Portal account already exists',
      details:
        'An account already exists for that email. Sign in instead of signing up again.',
    }
  }

  if (
    error.message.includes('portal_accounts.email') ||
    error.message.includes('portal_accounts_email_key')
  ) {
    return {
      error: 'Portal account already exists',
      details:
        'An account already exists for that email. Sign in instead of signing up again.',
    }
  }

  return {
    error: 'Portal signup conflict',
    details: 'A portal account or tenant already exists for the supplied signup details.',
  }
}

function getPortalTenantConflictResponse(): ErrorResponse {
  return {
    error: 'Portal tenant conflict',
    details: 'A tenant already exists for the supplied tenant details.',
  }
}

function getPortalSignupFailureResponse(): ErrorResponse {
  return {
    error: 'Failed to complete portal signup',
    details: 'An unexpected error occurred while creating your account. Please try again later.',
  }
}

function getPortalTenantFailureResponse(): ErrorResponse {
  return {
    error: 'Failed to create portal tenant',
    details: 'An unexpected error occurred while creating the tenant. Please try again later.',
  }
}

function buildRolloutFailureDetails(tenantId: string) {
  return `Rolling update failed for tenant ${tenantId}. The control plane marked the tenant failed; inspect the latest transition and control-plane logs before retrying.`
}

function getErrorMessage(error: unknown) {
  return formatUnknownError(error)
}

function logUnexpectedError(message: string, error: unknown) {
  if (error instanceof Error) {
    console.error(message, error)
    return
  }

  console.error(`${message}: ${getErrorMessage(error)}`)
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
  return new Date(Date.now() + portalSessionLifetimeMs).toISOString()
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
  return async (request, response, next) => {
    const authorizationHeader = request.header('authorization')

    if (!authorizationHeader?.startsWith('Bearer ')) {
      request.resume()
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const rawToken = authorizationHeader.slice('Bearer '.length).trim()
    const tokenHash = hashPortalSessionToken(rawToken)
    const portalSession = await tenantRegistry.getPortalSessionByTokenHash(tokenHash)

    if (!portalSession) {
      request.resume()
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const portalAccount = await tenantRegistry.getPortalAccount(portalSession.accountId)

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
  tenantControlClient,
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
  const buildFleetStatusResponse = async (): Promise<FleetStatusResponse> => {
    const latestTransitionsByTenant = await tenantRegistry.getLatestStateTransitions()
    const tenantsByCurrentState = createTenantStateCounts()
    const tenantsByDesiredState = createTenantStateCounts()
    const tenantsByVersion: Record<string, number> = {}
    let tenantsWithBackupMetadata = 0
    let tenantsMissingBackupMetadata = 0
    let tenantsNeedingAttention = 0

    const tenants = (await tenantRegistry.listTenants()).map((tenant) => {
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
  const buildPortalTenantSummary = async (
    tenantId: string,
  ): Promise<PortalTenantSummary | null> => {
    const latestTransitionsByTenant = await tenantRegistry.getLatestStateTransitions()
    const tenant = await tenantRegistry.getTenant(tenantId)

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
  const buildPortalDashboardResponse = async (
    account: PortalAccount,
  ): Promise<PortalDashboardResponse> => {
    const latestTransitionsByTenant = await tenantRegistry.getLatestStateTransitions()
    const tenants = (await tenantRegistry.listTenantsByOwnerId(account.id)).map((tenant) => ({
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
  const buildPortalSessionResponse = async (
    account: PortalAccount,
  ): Promise<PortalSessionResponse> => {
    const token = createPortalSessionToken()
    await tenantRegistry.createPortalSession({
      id: randomUUID(),
      accountId: account.id,
      tokenHash: hashPortalSessionToken(token),
      expiresAt: buildPortalSessionExpiry(),
    })

    return {
      token,
      dashboard: await buildPortalDashboardResponse(account),
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
    const existingTenant = await tenantRegistry.getTenant(params.tenantId)

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

    if (await tenantRegistry.getTenant(params.tenantId)) {
      await tenantRegistry.deleteTenant(params.tenantId)
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
    const existingSlug = await tenantRegistry.getTenantBySlug(tenantSlug)

    if (existingSlug) {
      throw new Error('Tenant slug already exists')
    }

    const tenant = await tenantRegistry.createTenant({
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

      const summary = await buildPortalTenantSummary(tenant.id)

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
        account: await tenantRegistry.updatePortalAccount(account.id, {
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
  const readinessHandler = async (
    _request: Request,
    response: Response<HealthResponse | ErrorResponse>,
  ) => {
    try {
      await tenantRegistry.checkHealth()
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
        const existingAccount = await tenantRegistry.getPortalAccountByEmail(
          normalizedEmail,
        )
        if (existingAccount) {
          response.status(409).json({
            error: 'Portal account already exists',
            details:
              'An account already exists for that email. Sign in instead of signing up again.',
          })
          return
        }

        createdAccount = await tenantRegistry.createPortalAccount({
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

        response.status(201).json(await buildPortalSessionResponse(account))
      } catch (error) {
        let effectiveError = error

        if (createdAccount) {
          try {
            await tenantRegistry.deletePortalAccount(createdAccount.id)
          } catch (accountCleanupError) {
            effectiveError = new Error(
              `${getErrorMessage(error)}; account cleanup failed: ${getErrorMessage(accountCleanupError)}`,
              { cause: accountCleanupError },
            )
          }
        }

        if (
          isConstraintConflictError(effectiveError) ||
          (effectiveError instanceof Error && effectiveError.message.includes('already exists'))
        ) {
          response.status(409).json(getPortalSignupConflictResponse(effectiveError))
          return
        }

        if (effectiveError instanceof Error) {
          console.error('Portal signup failed', effectiveError)
          response.status(500).json(getPortalSignupFailureResponse())
          return
        }

        console.error('Portal signup failed', effectiveError)
        response.status(500).json(getPortalSignupFailureResponse())
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
      const authRecord = await tenantRegistry.getPortalAccountAuthByEmail(
        normalizedEmail,
      )
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

      response.json(await buildPortalSessionResponse(authRecord.account))
    },
  )

  app.get(
    `${portalRoutePrefix}/me`,
    createPortalSessionMiddleware(tenantRegistry),
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

      response.json(await buildPortalDashboardResponse(portalAccount))
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

        const refreshedAccount = await tenantRegistry.getPortalAccount(
          portalAccount.id,
        )

        if (!refreshedAccount) {
          response.status(500).json({ error: 'Portal account not found' })
          return
        }

        response.status(201).json(await buildPortalDashboardResponse(refreshedAccount))
      } catch (error) {
        if (
          isConstraintConflictError(error) ||
          (error instanceof Error && error.message.includes('already exists'))
        ) {
          response.status(409).json(getPortalTenantConflictResponse())
          return
        }

        if (error instanceof Error) {
          console.error('Failed to create portal tenant', error)
          response.status(500).json(getPortalTenantFailureResponse())
          return
        }

        console.error('Failed to create portal tenant', error)
        response.status(500).json(getPortalTenantFailureResponse())
      }
    },
  )

  app.post(
    `${portalRoutePrefix}/logout`,
    createPortalSessionMiddleware(tenantRegistry),
    portalJsonParser,
    async (
      request: Request,
      response: Response<PortalLogoutResponse | ErrorResponse>,
    ) => {
      const portalRequest = request as PortalAuthenticatedRequest
      const portalSession = portalRequest.portalSession

      if (!portalSession) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }

      await tenantRegistry.deletePortalSessionByTokenHash(portalSession.tokenHash)
      response.json({ signedOut: true })
    },
  )

  app.get(
    '/internal/fleet/status',
    async (
      _request: Request,
      response: Response<FleetStatusResponse | ErrorResponse>,
    ) => {
      try {
        await tenantRegistry.checkHealth()
        response.json(await buildFleetStatusResponse())
      } catch {
        response.status(503).json({
          error: 'Tenant registry unavailable',
        })
      }
    },
  )

  app.get(
    tenantRoutePrefix,
    async (_request: Request, response: Response<TenantListResponse>) => {
      const tenants = await tenantRegistry.listTenants()
      response.json({ tenants })
    },
  )

  app.get(
    `${tenantRoutePrefix}/:tenantId`,
    async (
      request: Request<{ tenantId: string }>,
      response: Response<TenantDetailResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params
      const tenant = await tenantRegistry.getTenant(tenantId)

      if (!tenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      response.json({ tenant })
    },
  )

  app.get(
    `${tenantRoutePrefix}/:tenantId/storage`,
    async (
      request: Request<{ tenantId: string }>,
      response: Response<TenantStorageStatusResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params
      const storage = await tenantRegistry.getTenantStorageSnapshot(tenantId)

      if (!storage) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      response.json({ storage: buildTenantStorageStatus(storage) })
    },
  )

  app.post(
    tenantRoutePrefix,
    async (
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

      const existingTenant = await tenantRegistry.getTenant(id)
      if (existingTenant) {
        response.status(409).json({ error: 'Tenant ID already exists' })
        return
      }

      const existingSlug = await tenantRegistry.getTenantBySlug(slug)
      if (existingSlug) {
        response.status(409).json({ error: 'Tenant slug already exists' })
        return
      }

      try {
        const tenant = await tenantRegistry.createTenant({
          id,
          slug,
          ownerId,
          initialAdminEmail,
          version,
        })
        response.status(201).json({ tenant })
      } catch (error) {
        if (isConstraintConflictError(error)) {
          response.status(409).json(getTenantConflictResponse(error))
          return
        }

        logUnexpectedError('Failed to create tenant', error)
        response.status(500).json({
          error: 'Failed to create tenant',
          details: getErrorMessage(error),
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/state`,
    async (
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

      const tenant = await tenantRegistry.getTenant(tenantId)

      if (!tenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      const previousState = tenant.currentState
      const isMaintenanceTransition =
        (previousState === 'ready' && state === 'maintenance') ||
        (previousState === 'maintenance' && state === 'ready')
      const maintenanceMode = isMaintenanceTransition
        ? state === 'maintenance'
          ? 'enable'
          : 'disable'
        : null

      try {
        if (maintenanceMode) {
          if (!tenantControlClient) {
            const details = `Cannot propagate maintenance transition ${previousState} -> ${state} for tenant ${tenantId}: tenant control client is not configured.`
            console.error(details)
            response.status(503).json({
              error: 'Tenant maintenance propagation is not configured',
              details,
            })
            return
          }

          try {
            await tenantControlClient.setMaintenanceMode({
              tenant,
              mode: maintenanceMode,
              reason,
            })
          } catch (controlError) {
            const status =
              controlError instanceof TenantControlError
                ? controlError.status
                : 0
            logUnexpectedError(
              `Failed to propagate maintenance transition ${previousState} -> ${state} (${maintenanceMode}) to tenant ${tenantId} via /_control/maintenance (status ${status})`,
              controlError,
            )
            response.status(502).json({
              error: 'Failed to propagate maintenance state to tenant',
              details: getErrorMessage(controlError),
            })
            return
          }
        }

        await tenantRegistry.updateTenantState(
          tenantId,
          state,
          triggeredBy,
          reason,
        )

        const updatedTenant = await tenantRegistry.getTenant(tenantId)

        if (!updatedTenant) {
          response.status(500).json({ error: 'Failed to retrieve updated tenant' })
          return
        }

        response.json({ tenant: updatedTenant })
      } catch (error) {
        logUnexpectedError('Failed to update tenant state', error)
        response.status(500).json({
          error: 'Failed to update tenant state',
          details: getErrorMessage(error),
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/desired-state`,
    async (
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

      const existingTenant = await tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        await tenantRegistry.updateTenantDesiredState(tenantId, desiredState)
        const tenant = await tenantRegistry.getTenant(tenantId)

        if (!tenant) {
          response.status(404).json({ error: 'Tenant not found' })
          return
        }

        response.json({ tenant })
      } catch (error) {
        logUnexpectedError('Failed to update desired state', error)
        response.status(500).json({
          error: 'Failed to update desired state',
          details: getErrorMessage(error),
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/storage`,
    async (
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

      const existingTenant = await tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        await tenantRegistry.updateTenantStorageReference(
          tenantId,
          storageReference,
        )
        const tenant = await tenantRegistry.getTenant(tenantId)

        if (!tenant) {
          response.status(404).json({ error: 'Tenant not found' })
          return
        }

        response.json({ tenant })
      } catch (error) {
        logUnexpectedError('Failed to update storage reference', error)
        response.status(500).json({
          error: 'Failed to update storage reference',
          details: getErrorMessage(error),
        })
      }
    },
  )

  app.patch(
    `${tenantRoutePrefix}/:tenantId/backup`,
    async (
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

      const existingTenant = await tenantRegistry.getTenant(tenantId)
      if (!existingTenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      try {
        await tenantRegistry.updateTenantBackupMetadata(tenantId, backupMetadata)
        const tenant = await tenantRegistry.getTenant(tenantId)

        if (!tenant) {
          response.status(404).json({ error: 'Tenant not found' })
          return
        }

        response.json({ tenant })
      } catch (error) {
        logUnexpectedError('Failed to update backup metadata', error)
        response.status(500).json({
          error: 'Failed to update backup metadata',
          details: getErrorMessage(error),
        })
      }
    },
  )

  app.get(
    `${tenantRoutePrefix}/:tenantId/transitions`,
    async (
      request: Request<{ tenantId: string }>,
      response: Response<StateTransitionHistoryResponse | ErrorResponse>,
    ) => {
      const { tenantId } = request.params

      const tenant = await tenantRegistry.getTenant(tenantId)
      if (!tenant) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }

      const transitions = await tenantRegistry.getStateTransitions(tenantId)
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

      const existingTenant = await tenantRegistry.getTenant(tenantId)
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
          logUnexpectedError('Tenant rolling update failed', error)
          response.status(500).json({
            code: 'tenant_rollout_failed',
            error: 'Tenant rolling update failed',
            details: buildRolloutFailureDetails(tenantId),
          })
          return
        }

        logUnexpectedError('Failed to provision tenant resources', error)
        response.status(500).json({
          error: 'Failed to provision tenant resources',
          details: getErrorMessage(error),
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

      const existingTenant = await tenantRegistry.getTenant(tenantId)
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
        logUnexpectedError('Failed to deprovision tenant resources', error)
        response.status(500).json({
          error: 'Failed to deprovision tenant resources',
          details: getErrorMessage(error),
        })
      }
    },
  )

  return app
}
