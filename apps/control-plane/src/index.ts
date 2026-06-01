import dotenv from 'dotenv'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import { createApp } from './app.js'
import { createControlPlaneAdminAuth, createPortalKeycloakAuth } from './keycloak-auth.js'
import { KeycloakAdminClient } from './keycloak-admin-client.js'
import {
  createLiveTenantProvisioningService,
  defaultTenantReadyTimeoutMs,
  type TenantProvisioningPort,
} from './provisioning.js'
import { markOrphanRunningRolloutsFailed } from './fleet-rollout-orchestrator.js'
import { startRoleSyncRetryLoop } from './role-sync-retry.js'
import { createShutdownController } from './shutdown.js'
import {
  AzureBlobConfigurationError,
  AzureBlobTenantBackupArtifactStore,
} from './tenant-backup-azure-blob.js'
import { parseBackupDestination } from './backup-config.js'
import { startBackupScheduler, type BackupSchedulerLoop } from './backup-scheduler.js'
import {
  createPostgresTenantBackupDispatcher,
  type TenantBackupDispatcher,
} from './tenant-backup-dispatcher.js'
import { PostgresTenantBackupRunner } from './tenant-backup-runner.js'
import {
  createHttpTenantControlClient,
  type TenantControlClient,
} from './tenant-control-client.js'
import { TenantRegistry } from './tenant-registry.js'

dotenv.config()

const rawPort = process.env.PORT
const PORT =
  rawPort === undefined
    ? 3001
    : /^\d+$/.test(rawPort)
      ? Number(rawPort)
      : Number.NaN

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error(`Invalid PORT value: ${rawPort}`)
}

const CONTROL_PLANE_DATABASE_URL = process.env.CONTROL_PLANE_DATABASE_URL?.trim()

const CONTROL_PLANE_AUTH_MODE =
  process.env.CONTROL_PLANE_AUTH_MODE === 'keycloak' ? 'keycloak' : 'static'
const ADMIN_TOKEN = process.env.CONTROL_PLANE_ADMIN_TOKEN
const ENABLE_TENANT_PROVISIONING =
  process.env.CONTROL_PLANE_ENABLE_PROVISIONING === 'true'
const CONTROL_PLANE_KEYCLOAK_URL = process.env.CONTROL_PLANE_KEYCLOAK_URL
const rawControlPlaneKeycloakJwksUrl =
  process.env.CONTROL_PLANE_KEYCLOAK_JWKS_URL?.trim()
const CONTROL_PLANE_KEYCLOAK_JWKS_URL =
  rawControlPlaneKeycloakJwksUrl === undefined || rawControlPlaneKeycloakJwksUrl === ''
    ? undefined
    : rawControlPlaneKeycloakJwksUrl
const CONTROL_PLANE_KEYCLOAK_REALM = process.env.CONTROL_PLANE_KEYCLOAK_REALM
const CONTROL_PLANE_KEYCLOAK_CLIENT_ID =
  process.env.CONTROL_PLANE_KEYCLOAK_CLIENT_ID
const CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES =
  process.env.CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES
    ?.split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0) ?? []
const CUSTOMER_PORTAL_KEYCLOAK_URL = process.env.CUSTOMER_PORTAL_KEYCLOAK_URL
const rawCustomerPortalKeycloakJwksUrl =
  process.env.CUSTOMER_PORTAL_KEYCLOAK_JWKS_URL?.trim()
const CUSTOMER_PORTAL_KEYCLOAK_JWKS_URL =
  rawCustomerPortalKeycloakJwksUrl === undefined || rawCustomerPortalKeycloakJwksUrl === ''
    ? undefined
    : rawCustomerPortalKeycloakJwksUrl
const CUSTOMER_PORTAL_KEYCLOAK_REALM = process.env.CUSTOMER_PORTAL_KEYCLOAK_REALM
const CUSTOMER_PORTAL_KEYCLOAK_CLIENT_ID = process.env.CUSTOMER_PORTAL_KEYCLOAK_CLIENT_ID
const KEYCLOAK_ADMIN_BASE_URL = process.env.KEYCLOAK_ADMIN_BASE_URL
const KEYCLOAK_ADMIN_REALM = process.env.KEYCLOAK_ADMIN_REALM
const KEYCLOAK_ADMIN_CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID
const KEYCLOAK_ADMIN_CLIENT_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET
const rawCustomerPortalDefaultTenantVersion =
  process.env.CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION?.trim()
const CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION =
  rawCustomerPortalDefaultTenantVersion &&
  rawCustomerPortalDefaultTenantVersion.length > 0
    ? rawCustomerPortalDefaultTenantVersion
    : undefined
const TENANT_KEYCLOAK_URL = process.env.TENANT_KEYCLOAK_URL
const rawTenantKeycloakJwksUrl = process.env.TENANT_KEYCLOAK_JWKS_URL?.trim()
const TENANT_KEYCLOAK_JWKS_URL =
  rawTenantKeycloakJwksUrl === undefined || rawTenantKeycloakJwksUrl === ''
    ? undefined
    : rawTenantKeycloakJwksUrl
const TENANT_KEYCLOAK_REALM = process.env.TENANT_KEYCLOAK_REALM
const TENANT_BASE_DOMAIN = process.env.TENANT_BASE_DOMAIN
const rawTenantIngressClassName = process.env.TENANT_INGRESS_CLASS_NAME?.trim()
const TENANT_INGRESS_CLASS_NAME =
  rawTenantIngressClassName && rawTenantIngressClassName.length > 0
    ? rawTenantIngressClassName
    : 'nginx'
const TENANT_IMAGE_REPOSITORY = process.env.TENANT_IMAGE_REPOSITORY
const TENANT_DATABASE_ADMIN_URL = process.env.TENANT_DATABASE_ADMIN_URL
const TENANT_DATABASE_RUNTIME_URL = process.env.TENANT_DATABASE_RUNTIME_URL
const TENANT_IMAGE_PULL_SECRET = process.env.TENANT_IMAGE_PULL_SECRET
const TENANT_PUBLIC_SCHEME =
  process.env.TENANT_PUBLIC_SCHEME === 'http' ? 'http' : 'https'
const rawTenantTlsClusterIssuer = process.env.TENANT_TLS_CLUSTER_ISSUER?.trim()
const TENANT_TLS_CLUSTER_ISSUER =
  rawTenantTlsClusterIssuer && rawTenantTlsClusterIssuer.length > 0
    ? rawTenantTlsClusterIssuer
    : undefined
const rawControlPlaneTrustProxy = process.env.CONTROL_PLANE_TRUST_PROXY

function parseTrustProxySetting(rawValue: string | undefined): boolean | number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return false
  }

  const normalizedValue = rawValue.trim().toLowerCase()

  if (normalizedValue === 'true') {
    return true
  }

  if (normalizedValue === 'false') {
    return false
  }

  if (/^\d+$/.test(normalizedValue)) {
    return Number(normalizedValue)
  }

  throw new Error(`Invalid CONTROL_PLANE_TRUST_PROXY value: ${rawValue}`)
}

const CONTROL_PLANE_TRUST_PROXY = parseTrustProxySetting(rawControlPlaneTrustProxy)

if (CONTROL_PLANE_AUTH_MODE === 'static' && !ADMIN_TOKEN) {
  throw new Error('CONTROL_PLANE_ADMIN_TOKEN is required')
}

if (
  CONTROL_PLANE_AUTH_MODE === 'keycloak' &&
  (!CONTROL_PLANE_KEYCLOAK_URL ||
    !CONTROL_PLANE_KEYCLOAK_REALM ||
    !CONTROL_PLANE_KEYCLOAK_CLIENT_ID)
) {
  throw new Error(
    'CONTROL_PLANE_AUTH_MODE=keycloak requires CONTROL_PLANE_KEYCLOAK_URL, CONTROL_PLANE_KEYCLOAK_REALM, and CONTROL_PLANE_KEYCLOAK_CLIENT_ID.',
  )
}

const adminAuth = createControlPlaneAdminAuth({
  mode: CONTROL_PLANE_AUTH_MODE,
  keycloakUrl: CONTROL_PLANE_KEYCLOAK_URL,
  jwksUrl: CONTROL_PLANE_KEYCLOAK_JWKS_URL,
  keycloakRealm: CONTROL_PLANE_KEYCLOAK_REALM,
  clientId: CONTROL_PLANE_KEYCLOAK_CLIENT_ID,
  requiredRoles: CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES,
})

if (
  !CUSTOMER_PORTAL_KEYCLOAK_URL ||
  !CUSTOMER_PORTAL_KEYCLOAK_REALM ||
  !CUSTOMER_PORTAL_KEYCLOAK_CLIENT_ID
) {
  throw new Error(
    'Portal Keycloak auth requires CUSTOMER_PORTAL_KEYCLOAK_URL, CUSTOMER_PORTAL_KEYCLOAK_REALM, and CUSTOMER_PORTAL_KEYCLOAK_CLIENT_ID.',
  )
}

const portalKeycloakAuth = createPortalKeycloakAuth({
  keycloakUrl: CUSTOMER_PORTAL_KEYCLOAK_URL,
  jwksUrl: CUSTOMER_PORTAL_KEYCLOAK_JWKS_URL,
  keycloakRealm: CUSTOMER_PORTAL_KEYCLOAK_REALM,
  clientId: CUSTOMER_PORTAL_KEYCLOAK_CLIENT_ID,
})

// Instantiate the Keycloak admin client when credentials are provided.
// This is used at startup to ensure static portal clients exist in the realm.
const keycloakAdminClient =
  KEYCLOAK_ADMIN_BASE_URL &&
  KEYCLOAK_ADMIN_REALM &&
  KEYCLOAK_ADMIN_CLIENT_ID &&
  KEYCLOAK_ADMIN_CLIENT_SECRET
    ? new KeycloakAdminClient({
        baseUrl: KEYCLOAK_ADMIN_BASE_URL,
        realm: KEYCLOAK_ADMIN_REALM,
        clientId: KEYCLOAK_ADMIN_CLIENT_ID,
        clientSecret: KEYCLOAK_ADMIN_CLIENT_SECRET,
      })
    : null

function parsePortSetting(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
): number {
  const parsedValue =
    rawValue === undefined
      ? defaultValue
      : /^\d+$/.test(rawValue)
        ? Number(rawValue)
        : Number.NaN

  if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 65535) {
    throw new Error(`Invalid ${name} value: ${rawValue}`)
  }

  return parsedValue
}

function parsePositiveIntegerSetting(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
): number {
  const parsedValue =
    rawValue === undefined
      ? defaultValue
      : /^\d+$/.test(rawValue)
        ? Number(rawValue)
        : Number.NaN

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`Invalid ${name} value: ${rawValue}`)
  }

  return parsedValue
}

if (!CONTROL_PLANE_DATABASE_URL) {
  throw new Error('CONTROL_PLANE_DATABASE_URL is required')
}

const tenantRegistry = new TenantRegistry(CONTROL_PLANE_DATABASE_URL)

// Fleet rollout pool: a separate small pool from the same DB for the advisory
// lock + orchestrator. This pool is independent from the registry pool so that
// the fleet orchestrator's long-lived locked connection does not starve other
// registry operations.
const fleetRolloutPool = new Pool({
  connectionString: CONTROL_PLANE_DATABASE_URL,
  max: 3,
})
let tenantProvisioningService: TenantProvisioningPort | undefined
let tenantControlClient: TenantControlClient | undefined

const rawTenantControlPlaneToken = process.env.TENANT_CONTROL_PLANE_TOKEN?.trim()
const TENANT_CONTROL_PLANE_TOKEN =
  rawTenantControlPlaneToken && rawTenantControlPlaneToken.length > 0
    ? rawTenantControlPlaneToken
    : undefined

if (TENANT_CONTROL_PLANE_TOKEN && TENANT_BASE_DOMAIN) {
  tenantControlClient = createHttpTenantControlClient({
    controlPlaneToken: TENANT_CONTROL_PLANE_TOKEN,
    baseDomain: TENANT_BASE_DOMAIN,
    publicScheme: TENANT_PUBLIC_SCHEME,
  })
}

if (ENABLE_TENANT_PROVISIONING) {
  if (!TENANT_BASE_DOMAIN) {
    throw new Error('TENANT_BASE_DOMAIN is required when provisioning is enabled')
  }

  if (!TENANT_IMAGE_REPOSITORY) {
    throw new Error(
      'TENANT_IMAGE_REPOSITORY is required when provisioning is enabled',
    )
  }

  if (!TENANT_DATABASE_ADMIN_URL) {
    throw new Error(
      'TENANT_DATABASE_ADMIN_URL is required when provisioning is enabled',
    )
  }

  if (!TENANT_KEYCLOAK_URL || !TENANT_KEYCLOAK_REALM) {
    throw new Error(
      'Provisioning requires TENANT_KEYCLOAK_URL and TENANT_KEYCLOAK_REALM. The per-tenant client ID is derived automatically from the tenant ID.',
    )
  }

  const tenantAppPort = parsePortSetting(
    'TENANT_APP_PORT',
    process.env.TENANT_APP_PORT,
    3000,
  )
  const tenantReadyTimeoutMs = parsePositiveIntegerSetting(
    'TENANT_READY_TIMEOUT_MS',
    process.env.TENANT_READY_TIMEOUT_MS,
    defaultTenantReadyTimeoutMs,
  )
  const activatorExternalNameTrimmed = process.env.ACTIVATOR_EXTERNAL_NAME?.trim()
  const rawActivatorPort = process.env.ACTIVATOR_PORT?.trim()
  const activatorPort =
    rawActivatorPort !== undefined && rawActivatorPort !== ''
      ? parsePortSetting('ACTIVATOR_PORT', rawActivatorPort, 8080)
      : undefined

  tenantProvisioningService = createLiveTenantProvisioningService({
    tenantRegistry,
    baseDomain: TENANT_BASE_DOMAIN,
    ingressClassName: TENANT_INGRESS_CLASS_NAME,
    imageRepository: TENANT_IMAGE_REPOSITORY,
    databaseAdminUrl: TENANT_DATABASE_ADMIN_URL,
    databaseRuntimeUrl: TENANT_DATABASE_RUNTIME_URL,
    tenantRuntimeAuth: {
      keycloakUrl: TENANT_KEYCLOAK_URL,
      keycloakJwksUrl: TENANT_KEYCLOAK_JWKS_URL,
      keycloakRealm: TENANT_KEYCLOAK_REALM,
    },
    // Pass the admin client (may be null when KEYCLOAK_ADMIN_* is not configured)
    // so the provisioner can create per-tenant Keycloak clients. When absent the
    // step is silently skipped.
    keycloakAdminClient: keycloakAdminClient ?? undefined,
    imagePullSecretName: TENANT_IMAGE_PULL_SECRET,
    publicScheme: TENANT_PUBLIC_SCHEME,
    tenantPort: tenantAppPort,
    readyTimeoutMs: tenantReadyTimeoutMs,
    controlPlaneToken: TENANT_CONTROL_PLANE_TOKEN,
    tlsClusterIssuer: TENANT_TLS_CLUSTER_ISSUER,
    // When ACTIVATOR_EXTERNAL_NAME is set (e.g.
    // "dnd-notes-activator.dnd-notes-platform.svc.cluster.local"), new tenant
    // IngressRoutes are routed through the activator shim for scale-to-zero
    // wake-on-request support (Pattern B). Leave unset to disable.
    activatorExternalName: activatorExternalNameTrimmed !== '' ? activatorExternalNameTrimmed : undefined,
    activatorPort,
  })
}

// ---------------------------------------------------------------------------
// Backup dispatcher wiring (#330)
// ---------------------------------------------------------------------------

const BACKUP_DESTINATION = parseBackupDestination(process.env.BACKUP_DESTINATION)

const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT?.trim()
const rawAzureContainer = process.env.AZURE_STORAGE_CONTAINER?.trim()
const AZURE_STORAGE_CONTAINER =
  rawAzureContainer && rawAzureContainer.length > 0 ? rawAzureContainer : 'tenant-backups'
const AZURE_STORAGE_SAS_TOKEN = process.env.AZURE_STORAGE_SAS_TOKEN?.trim()
const AZURE_STORAGE_CONNECTION_STRING =
  process.env.AZURE_STORAGE_CONNECTION_STRING?.trim()
const rawBackupCron = process.env.BACKUP_SCHEDULE_CRON?.trim()
const BACKUP_SCHEDULE_CRON =
  rawBackupCron && rawBackupCron.length > 0 ? rawBackupCron : '0 3 * * *'
const rawRetentionDays = process.env.BACKUP_RETENTION_DAYS?.trim()
const BACKUP_RETENTION_DAYS = rawRetentionDays
  ? parseInt(rawRetentionDays, 10)
  : 14

if (BACKUP_DESTINATION === 'azure-blob') {
  if (!AZURE_STORAGE_ACCOUNT) {
    throw new Error(
      'AZURE_STORAGE_ACCOUNT is required when BACKUP_DESTINATION=azure-blob.',
    )
  }

  if (!AZURE_STORAGE_SAS_TOKEN && !AZURE_STORAGE_CONNECTION_STRING) {
    throw new Error(
      'BACKUP_DESTINATION=azure-blob requires either AZURE_STORAGE_SAS_TOKEN or AZURE_STORAGE_CONNECTION_STRING.',
    )
  }

  if (
    !Number.isInteger(BACKUP_RETENTION_DAYS) ||
    BACKUP_RETENTION_DAYS < 1
  ) {
    throw new Error(
      `Invalid BACKUP_RETENTION_DAYS value: ${rawRetentionDays}. Expected a positive integer.`,
    )
  }
}

let tenantBackupDispatcher: TenantBackupDispatcher | undefined
let azureBlobArtifactStore: AzureBlobTenantBackupArtifactStore | undefined

if (BACKUP_DESTINATION === 'azure-blob') {
  try {
    azureBlobArtifactStore = new AzureBlobTenantBackupArtifactStore({
      accountName: AZURE_STORAGE_ACCOUNT,
      sasToken: AZURE_STORAGE_SAS_TOKEN && AZURE_STORAGE_SAS_TOKEN.length > 0
        ? AZURE_STORAGE_SAS_TOKEN
        : undefined,
      connectionString: AZURE_STORAGE_CONNECTION_STRING && AZURE_STORAGE_CONNECTION_STRING.length > 0
        ? AZURE_STORAGE_CONNECTION_STRING
        : undefined,
      containerName: AZURE_STORAGE_CONTAINER,
    })
  } catch (error) {
    if (error instanceof AzureBlobConfigurationError) {
      throw new Error(
        `Backup configuration error: ${error.message}`,
        { cause: error },
      )
    }
    throw error
  }

  const tenantDatabaseAdminUrl = TENANT_DATABASE_ADMIN_URL

  if (!tenantDatabaseAdminUrl) {
    throw new Error(
      'TENANT_DATABASE_ADMIN_URL is required when BACKUP_DESTINATION=azure-blob.',
    )
  }

  const backupRunner = new PostgresTenantBackupRunner({
    adminDatabaseUrl: tenantDatabaseAdminUrl,
    artifactStore: azureBlobArtifactStore,
  })

  tenantBackupDispatcher = createPostgresTenantBackupDispatcher(backupRunner)
  console.log('Backup dispatcher: azure-blob configured.')
}

const app = createApp({
  tenantRegistry,
  adminToken: ADMIN_TOKEN,
  adminAuth,
  tenantProvisioningService,
  tenantBackupDispatcher,
  trustProxy: CONTROL_PLANE_TRUST_PROXY,
  portalKeycloakAuth,
  portalDefaultTenantVersion: CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION,
  tenantBaseDomain: TENANT_BASE_DOMAIN,
  tenantPublicScheme: TENANT_PUBLIC_SCHEME,
  tenantControlClient,
  // Used by the portal middleware for the #196 transition path: when an
  // existing local owner is auto-linked to a Keycloak identity, assign the
  // per-tenant member role for every tenant they already own.
  keycloakAdminClient: keycloakAdminClient ?? undefined,
  // Fleet rolling-update pool (#415). Separate pool so the orchestrator's
  // dedicated advisory-lock connection does not starve the registry pool.
  fleetRolloutPool: tenantProvisioningService ? fleetRolloutPool : undefined,
})
const SHUTDOWN_TIMEOUT_MS = 5_000
const serverRef: { current?: Server } = {}

// Role-sync retry loop (#201). Started after migrations succeed and the server
// is ready. Only active when a Keycloak admin client is configured — without
// it the sweep in the middleware is also skipped, so there are no 'pending'
// rows to retry. Stopped during graceful shutdown so in-flight ticks complete
// before the process exits.
let roleSyncRetryLoop: ReturnType<typeof startRoleSyncRetryLoop> | undefined

// Nightly backup scheduler (#330). Active only when BACKUP_DESTINATION is
// not 'disabled'. Stopped during graceful shutdown.
let backupSchedulerLoop: BackupSchedulerLoop | undefined

const shutdownController = createShutdownController({
  getServer: () => serverRef.current,
  closeResources: async () => {
    roleSyncRetryLoop?.stop()
    backupSchedulerLoop?.stop()

    if (tenantProvisioningService) {
      await tenantProvisioningService.close()
    }

    await tenantRegistry.close()
    await fleetRolloutPool.end()
  },
  exit: (exitCode) => {
    console.log('Control plane stopped')
    process.exit(exitCode)
  },
  shutdownGracePeriodMs: SHUTDOWN_TIMEOUT_MS,
  logError: (message, error) => {
    console.error(message, error)
  },
})

try {
  await tenantRegistry.whenReady()
} catch (error) {
  console.error('Control-plane migrations failed; refusing to start:', error)
  process.exit(1)
}

// Process-restart safety (#415): mark any rollout rows that were stuck in
// 'running' when the previous process died as 'failed'. The advisory lock
// dies with the session, so a follow-up rollout can start immediately.
// V1 trade-off: no resume logic — operators must start a new rollout.
try {
  await markOrphanRunningRolloutsFailed(fleetRolloutPool)
} catch (error) {
  // Non-fatal: log and continue. The rollout table may not exist yet if
  // migration 0010 is being applied for the first time on this boot.
  console.warn('Failed to mark orphaned running rollouts as failed:', error)
}

// Ensure static portal Keycloak clients exist in the realm. This is a soft
// failure: if Keycloak is temporarily unreachable the control-plane still
// starts so that local-auth fallback and non-Keycloak routes remain available.
// The upsert will succeed on the next control-plane restart.
if (keycloakAdminClient) {
  const staticPortalClients = [
    {
      clientId: 'dnd-notes-control-plane',
      enabled: true,
      publicClient: true,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: true,
      redirectUris: [
        'https://operator.127.0.0.1.nip.io/*',
        'http://operator.127.0.0.1.nip.io/*',
        'http://localhost:5173/*',
        'http://localhost:5174/*',
      ],
      webOrigins: [
        'https://operator.127.0.0.1.nip.io',
        'http://operator.127.0.0.1.nip.io',
        'http://localhost:5173',
        'http://localhost:5174',
      ],
    },
    {
      clientId: 'dnd-notes-customer-portal',
      enabled: true,
      publicClient: true,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      redirectUris: [
        'https://portal.127.0.0.1.nip.io/*',
        'http://portal.127.0.0.1.nip.io/*',
        'http://localhost:5175/*',
      ],
      webOrigins: [
        'https://portal.127.0.0.1.nip.io',
        'http://portal.127.0.0.1.nip.io',
        'http://localhost:5175',
      ],
    },
  ]

  for (const clientSpec of staticPortalClients) {
    try {
      await keycloakAdminClient.ensureClient(clientSpec)
      console.log(`Keycloak client "${clientSpec.clientId}" is in sync.`)
    } catch (error) {
      console.error(
        `Keycloak startup upsert failed for "${clientSpec.clientId}" — continuing without it:`,
        error,
      )
    }
  }
}

serverRef.current = app.listen(PORT, () => {
  console.log(`Control plane listening on port ${PORT}`)
  console.log('Registry backend: postgres')
})

// Start role-sync retry loop after the server is listening.
if (keycloakAdminClient) {
  roleSyncRetryLoop = startRoleSyncRetryLoop({
    tenantRegistry,
    keycloakAdminClient,
  })
  console.log('Role-sync retry loop started (60 s base interval, 5 min cap).')
}

// Start nightly backup scheduler after the server is listening (#330).
if (tenantBackupDispatcher && BACKUP_DESTINATION !== 'disabled') {
  backupSchedulerLoop = startBackupScheduler({
    tenantRegistry,
    tenantBackupDispatcher,
    artifactStore: azureBlobArtifactStore,
    scheduleExpression: BACKUP_SCHEDULE_CRON,
    retentionDays: BACKUP_RETENTION_DAYS,
  })
  console.log(
    `Backup scheduler started (schedule="${BACKUP_SCHEDULE_CRON}", retention=${BACKUP_RETENTION_DAYS} days).`,
  )
}

const shutdown = () => {
  if (shutdownController.isShuttingDown()) {
    return
  }

  console.log('\nShutting down control plane...')
  shutdownController.shutdown(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
