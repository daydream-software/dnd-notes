import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import {
  createLiveTenantProvisioningService,
  type TenantProvisioningPort,
} from './provisioning.js'
import { TenantRegistry } from './tenant-registry.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

const rawDatabasePath = process.env.DATABASE_PATH
const DATABASE_PATH = rawDatabasePath
  ? path.isAbsolute(rawDatabasePath)
    ? rawDatabasePath
    : path.resolve(__dirname, '..', rawDatabasePath)
  : path.join(__dirname, '../data/control-plane.sqlite')

const ADMIN_TOKEN = process.env.CONTROL_PLANE_ADMIN_TOKEN
const ENABLE_TENANT_PROVISIONING =
  process.env.CONTROL_PLANE_ENABLE_PROVISIONING === 'true'
const TENANT_BASE_DOMAIN = process.env.TENANT_BASE_DOMAIN
const TENANT_IMAGE_REPOSITORY = process.env.TENANT_IMAGE_REPOSITORY
const TENANT_DATABASE_ADMIN_URL = process.env.TENANT_DATABASE_ADMIN_URL
const TENANT_IMAGE_PULL_SECRET = process.env.TENANT_IMAGE_PULL_SECRET
const TENANT_PUBLIC_SCHEME =
  process.env.TENANT_PUBLIC_SCHEME === 'http' ? 'http' : 'https'
const rawTenantPort = process.env.TENANT_APP_PORT
const TENANT_APP_PORT =
  rawTenantPort === undefined
    ? 3000
    : /^\d+$/.test(rawTenantPort)
      ? Number(rawTenantPort)
      : Number.NaN
const rawReadyTimeoutMs = process.env.TENANT_READY_TIMEOUT_MS
const TENANT_READY_TIMEOUT_MS =
  rawReadyTimeoutMs === undefined
    ? 120_000
    : /^\d+$/.test(rawReadyTimeoutMs)
      ? Number(rawReadyTimeoutMs)
      : Number.NaN

if (!ADMIN_TOKEN) {
  throw new Error('CONTROL_PLANE_ADMIN_TOKEN is required')
}

if (!Number.isInteger(TENANT_APP_PORT) || TENANT_APP_PORT < 1 || TENANT_APP_PORT > 65535) {
  throw new Error(`Invalid TENANT_APP_PORT value: ${rawTenantPort}`)
}

if (
  !Number.isInteger(TENANT_READY_TIMEOUT_MS) ||
  TENANT_READY_TIMEOUT_MS < 1
) {
  throw new Error(`Invalid TENANT_READY_TIMEOUT_MS value: ${rawReadyTimeoutMs}`)
}

const databaseDir = path.dirname(DATABASE_PATH)

await import('node:fs/promises').then((fs) =>
  fs.mkdir(databaseDir, { recursive: true }),
)

const tenantRegistry = new TenantRegistry(DATABASE_PATH)
let tenantProvisioningService: TenantProvisioningPort | undefined

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

  tenantProvisioningService = createLiveTenantProvisioningService({
    tenantRegistry,
    baseDomain: TENANT_BASE_DOMAIN,
    imageRepository: TENANT_IMAGE_REPOSITORY,
    databaseAdminUrl: TENANT_DATABASE_ADMIN_URL,
    imagePullSecretName: TENANT_IMAGE_PULL_SECRET,
    publicScheme: TENANT_PUBLIC_SCHEME,
    tenantPort: TENANT_APP_PORT,
    readyTimeoutMs: TENANT_READY_TIMEOUT_MS,
  })
}

const app = createApp({
  tenantRegistry,
  adminToken: ADMIN_TOKEN,
  tenantProvisioningService,
})
const SHUTDOWN_TIMEOUT_MS = 5_000

const server = app.listen(PORT, () => {
  console.log(`Control plane listening on port ${PORT}`)
  console.log(`Database: ${DATABASE_PATH}`)
})

let shuttingDown = false
let shutdownCompleted = false
let shutdownTimeout: NodeJS.Timeout | undefined

const finishShutdown = async (exitCode: number) => {
  if (shutdownCompleted) {
    return
  }

  shutdownCompleted = true
  if (shutdownTimeout) {
    clearTimeout(shutdownTimeout)
  }

  try {
    if (tenantProvisioningService) {
      await tenantProvisioningService.close()
    }
  } finally {
    tenantRegistry.close()
    console.log('Control plane stopped')
    process.exit(exitCode)
  }
}

const shutdown = () => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log('\nShutting down control plane...')

  shutdownTimeout = setTimeout(() => {
    console.error(
      `Forcing control plane shutdown after ${SHUTDOWN_TIMEOUT_MS}ms timeout`,
    )
    void finishShutdown(1)
  }, SHUTDOWN_TIMEOUT_MS)

  server.close((error) => {
    if (error) {
      console.error('Control plane shutdown error:', error)
      void finishShutdown(1)
      return
    }

    void finishShutdown(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
