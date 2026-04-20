import dotenv from 'dotenv'
import type { Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import {
  createLiveTenantProvisioningService,
  type TenantProvisioningPort,
} from './provisioning.js'
import { createShutdownController } from './shutdown.js'
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

if (!ADMIN_TOKEN) {
  throw new Error('CONTROL_PLANE_ADMIN_TOKEN is required')
}

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

  const tenantAppPort = parsePortSetting(
    'TENANT_APP_PORT',
    process.env.TENANT_APP_PORT,
    3000,
  )
  const tenantReadyTimeoutMs = parsePositiveIntegerSetting(
    'TENANT_READY_TIMEOUT_MS',
    process.env.TENANT_READY_TIMEOUT_MS,
    120_000,
  )

  tenantProvisioningService = createLiveTenantProvisioningService({
    tenantRegistry,
    baseDomain: TENANT_BASE_DOMAIN,
    imageRepository: TENANT_IMAGE_REPOSITORY,
    databaseAdminUrl: TENANT_DATABASE_ADMIN_URL,
    imagePullSecretName: TENANT_IMAGE_PULL_SECRET,
    publicScheme: TENANT_PUBLIC_SCHEME,
    tenantPort: tenantAppPort,
    readyTimeoutMs: tenantReadyTimeoutMs,
  })
}

const app = createApp({
  tenantRegistry,
  adminToken: ADMIN_TOKEN,
  tenantProvisioningService,
})
const SHUTDOWN_TIMEOUT_MS = 5_000
const serverRef: { current?: Server } = {}
const shutdownController = createShutdownController({
  getServer: () => serverRef.current,
  closeResources: async () => {
    if (tenantProvisioningService) {
      await tenantProvisioningService.close()
    }

    tenantRegistry.close()
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

serverRef.current = app.listen(PORT, () => {
  console.log(`Control plane listening on port ${PORT}`)
  console.log(`Database: ${DATABASE_PATH}`)
})

const shutdown = () => {
  if (shutdownController.isShuttingDown()) {
    return
  }

  console.log('\nShutting down control plane...')
  shutdownController.shutdown(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
