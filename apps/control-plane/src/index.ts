import dotenv from 'dotenv'
import type { Server } from 'node:http'
import { createApp } from './app.js'
import { createControlPlaneAdminAuth } from './keycloak-auth.js'
import {
  createLiveTenantProvisioningService,
  type TenantProvisioningPort,
} from './provisioning.js'
import { createShutdownController } from './shutdown.js'
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
const CUSTOMER_PORTAL_AUTH_MODE =
  process.env.CUSTOMER_PORTAL_AUTH_MODE === 'keycloak' ? 'keycloak' : 'local'
const rawCustomerPortalDefaultTenantVersion =
  process.env.CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION?.trim()
const CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION =
  rawCustomerPortalDefaultTenantVersion &&
  rawCustomerPortalDefaultTenantVersion.length > 0
    ? rawCustomerPortalDefaultTenantVersion
    : undefined
const TENANT_AUTH_MODE =
  process.env.TENANT_AUTH_MODE === 'keycloak' ? 'keycloak' : 'local'
const TENANT_KEYCLOAK_URL = process.env.TENANT_KEYCLOAK_URL
const rawTenantKeycloakJwksUrl = process.env.TENANT_KEYCLOAK_JWKS_URL?.trim()
const TENANT_KEYCLOAK_JWKS_URL =
  rawTenantKeycloakJwksUrl === undefined || rawTenantKeycloakJwksUrl === ''
    ? undefined
    : rawTenantKeycloakJwksUrl
const TENANT_KEYCLOAK_REALM = process.env.TENANT_KEYCLOAK_REALM
const TENANT_KEYCLOAK_CLIENT_ID = process.env.TENANT_KEYCLOAK_CLIENT_ID
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

  if (
    TENANT_AUTH_MODE === 'keycloak' &&
    (!TENANT_KEYCLOAK_URL || !TENANT_KEYCLOAK_REALM || !TENANT_KEYCLOAK_CLIENT_ID)
  ) {
    throw new Error(
      'Provisioning with TENANT_AUTH_MODE=keycloak requires TENANT_KEYCLOAK_URL, TENANT_KEYCLOAK_REALM, and TENANT_KEYCLOAK_CLIENT_ID.',
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
    ingressClassName: TENANT_INGRESS_CLASS_NAME,
    imageRepository: TENANT_IMAGE_REPOSITORY,
    databaseAdminUrl: TENANT_DATABASE_ADMIN_URL,
    databaseRuntimeUrl: TENANT_DATABASE_RUNTIME_URL,
    tenantRuntimeAuth:
      TENANT_AUTH_MODE === 'keycloak'
        ? {
            mode: 'keycloak',
            keycloakUrl: TENANT_KEYCLOAK_URL,
            keycloakJwksUrl: TENANT_KEYCLOAK_JWKS_URL,
            keycloakRealm: TENANT_KEYCLOAK_REALM,
            keycloakClientId: TENANT_KEYCLOAK_CLIENT_ID,
          }
        : { mode: 'local' },
    imagePullSecretName: TENANT_IMAGE_PULL_SECRET,
    publicScheme: TENANT_PUBLIC_SCHEME,
    tenantPort: tenantAppPort,
    readyTimeoutMs: tenantReadyTimeoutMs,
  })
}

const app = createApp({
  tenantRegistry,
  adminToken: ADMIN_TOKEN,
  adminAuth,
  tenantProvisioningService,
  trustProxy: CONTROL_PLANE_TRUST_PROXY,
  portalAuthMode: CUSTOMER_PORTAL_AUTH_MODE,
  portalDefaultTenantVersion: CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION,
  tenantBaseDomain: TENANT_BASE_DOMAIN,
  tenantPublicScheme: TENANT_PUBLIC_SCHEME,
})
const SHUTDOWN_TIMEOUT_MS = 5_000
const serverRef: { current?: Server } = {}
const shutdownController = createShutdownController({
  getServer: () => serverRef.current,
  closeResources: async () => {
    if (tenantProvisioningService) {
      await tenantProvisioningService.close()
    }

    await tenantRegistry.close()
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
  console.log('Registry backend: postgres')
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
