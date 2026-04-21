import {
  ApiException,
  KubeConfig,
  KubernetesObjectApi,
  type KubernetesObject,
  type V1ConfigMap,
  type V1DeleteOptions,
  type V1Deployment,
  type V1Namespace,
  type V1PersistentVolumeClaim,
  type V1PersistentVolumeClaimSpec,
  type V1Secret,
  type V1Service,
  type V1ServicePort,
} from '@kubernetes/client-node'
import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { assertPersistedTenantSubdomain } from './tenant-subdomain.js'
import type {
  Tenant,
  TenantDeprovisionResponse,
  TenantProvisioningResources,
  TenantProvisioningResponse,
} from './types.js'
import type { TenantRegistry } from './tenant-registry.js'

const opaqueSubdomainPrefix = 't'
const defaultTenantPort = 3000
const defaultReadyTimeoutMs = 120_000
const defaultReadyPollIntervalMs = 2_000
const defaultDeleteTimeoutMs = 120_000
const defaultTenantStorageRequest = '1Gi'
const defaultTenantStorageMountPath = '/app/data'
const maxKubernetesLabelValueLength = 63

type KubernetesObjectClient = Pick<
  KubernetesObjectApi,
  'create' | 'delete' | 'read' | 'replace'
>

interface TenantDatabase {
  databaseName: string
  runtimeConnectionString: string
}

interface TenantDatabaseManager {
  ensureTenantDatabase(tenant: Tenant, subdomain: string): Promise<TenantDatabase>
  deleteTenantDatabase(databaseName: string): Promise<void>
  close(): Promise<void>
}

interface TenantInfrastructureBundle {
  namespace: V1Namespace
  configMap: V1ConfigMap
  secret: V1Secret
  persistentVolumeClaim: V1PersistentVolumeClaim
  service: V1Service
  deployment: V1Deployment
  resources: TenantProvisioningResources
}

interface TenantInfrastructureManager {
  applyTenantResources(bundle: TenantInfrastructureBundle): Promise<void>
  waitForTenantReady(
    resources: TenantProvisioningResources,
    timeoutMs?: number,
  ): Promise<void>
  deleteTenantResources(resources: TenantProvisioningResources): Promise<void>
}

export interface TenantProvisioningPort {
  provisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
    version?: string
  }): Promise<TenantProvisioningResponse>
  deprovisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
  }): Promise<TenantDeprovisionResponse>
  close(): Promise<void>
}

interface TenantProvisioningServiceOptions {
  tenantRegistry: TenantRegistry
  infrastructureManager: TenantInfrastructureManager
  databaseManager: TenantDatabaseManager
  baseDomain: string
  imageRepository: string
  imagePullSecretName?: string
  publicScheme?: 'http' | 'https'
  tenantPort?: number
  readyTimeoutMs?: number
}

interface BuildTenantInfrastructureBundleOptions {
  tenant: Tenant
  subdomain: string
  database: TenantDatabase
  baseDomain: string
  imageRepository: string
  imagePullSecretName?: string
  publicScheme: 'http' | 'https'
  tenantPort: number
}

export class TenantProvisioningService implements TenantProvisioningPort {
  private readonly tenantRegistry: TenantRegistry
  private readonly infrastructureManager: TenantInfrastructureManager
  private readonly databaseManager: TenantDatabaseManager
  private readonly baseDomain: string
  private readonly imageRepository: string
  private readonly imagePullSecretName?: string
  private readonly publicScheme: 'http' | 'https'
  private readonly tenantPort: number
  private readonly readyTimeoutMs: number

  constructor(options: TenantProvisioningServiceOptions) {
    this.tenantRegistry = options.tenantRegistry
    this.infrastructureManager = options.infrastructureManager
    this.databaseManager = options.databaseManager
    this.baseDomain = options.baseDomain
    this.imageRepository = options.imageRepository
    this.imagePullSecretName = options.imagePullSecretName
    this.publicScheme = options.publicScheme ?? 'https'
    this.tenantPort = options.tenantPort ?? defaultTenantPort
    this.readyTimeoutMs = options.readyTimeoutMs ?? defaultReadyTimeoutMs
  }

  async provisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
    version?: string
  }): Promise<TenantProvisioningResponse> {
    const tenant = this.getExistingTenant(params.tenantId)
    const requestedVersion = params.version

    if (requestedVersion !== undefined && requestedVersion.trim().length === 0) {
      throw new Error('Tenant version must be a non-empty string')
    }

    const isVersionRollout =
      requestedVersion !== undefined && requestedVersion !== tenant.version

    if (tenant.currentState === 'deprovisioned') {
      throw new Error(`Tenant ${tenant.id} is already deprovisioned`)
    }

    if (requestedVersion !== undefined && requestedVersion !== tenant.version) {
      this.tenantRegistry.updateTenantVersion(tenant.id, requestedVersion)
    }

    const refreshedTenant = this.getExistingTenant(tenant.id)
    const shouldMarkUpgrading =
      isVersionRollout &&
      refreshedTenant.subdomain != null &&
      refreshedTenant.currentState === 'ready'

    try {
      this.tenantRegistry.updateTenantDesiredState(refreshedTenant.id, 'ready')
      if (shouldMarkUpgrading) {
        this.tenantRegistry.updateTenantState(
          refreshedTenant.id,
          'upgrading',
          params.triggeredBy,
          params.reason ?? 'Tenant rolling update started',
        )
      }
      const subdomain = assertPersistedTenantSubdomain(
        refreshedTenant.id,
        this.tenantRegistry.reserveTenantSubdomain(
          refreshedTenant.id,
          () => this.createOpaqueSubdomainCandidate(),
        ),
        'provisioning tenant resources',
      )
      const database = await this.databaseManager.ensureTenantDatabase(
        refreshedTenant,
        subdomain,
      )

      const bundle = buildTenantInfrastructureBundle({
        tenant: this.getExistingTenant(refreshedTenant.id),
        subdomain,
        database,
        baseDomain: this.baseDomain,
        imageRepository: this.imageRepository,
        imagePullSecretName: this.imagePullSecretName,
        publicScheme: this.publicScheme,
        tenantPort: this.tenantPort,
      })
      this.tenantRegistry.updateTenantStorageReference(
        refreshedTenant.id,
        bundle.resources.pvcName,
      )

      await this.infrastructureManager.applyTenantResources(bundle)
      await this.infrastructureManager.waitForTenantReady(
        bundle.resources,
        this.readyTimeoutMs,
      )

      const currentTenant = this.getExistingTenant(refreshedTenant.id)
      if (currentTenant.currentState !== 'ready') {
        this.tenantRegistry.updateTenantState(
          refreshedTenant.id,
          'ready',
          params.triggeredBy,
          params.reason ?? 'Tenant resources provisioned',
        )
      }

      return {
        tenant: this.getExistingTenant(refreshedTenant.id),
        resources: bundle.resources,
      }
    } catch (error) {
      const failedTenant = this.getExistingTenant(refreshedTenant.id)
      if (failedTenant.currentState !== 'failed') {
        this.tenantRegistry.updateTenantState(
          refreshedTenant.id,
          'failed',
          params.triggeredBy,
          params.reason ?? 'Tenant provisioning failed',
        )
      }
      throw error
    }
  }

  async deprovisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
  }): Promise<TenantDeprovisionResponse> {
    const tenant = this.getExistingTenant(params.tenantId)

    if (tenant.currentState === 'deprovisioned') {
      return {
        tenant,
        deprovisioned: true,
      }
    }

    if (tenant.subdomain != null) {
      const subdomain = assertPersistedTenantSubdomain(
        tenant.id,
        tenant.subdomain,
        'deprovisioning tenant resources',
      )
      const resources = buildTenantResourceNames({
        tenant,
        subdomain,
        baseDomain: this.baseDomain,
        imageRepository: this.imageRepository,
      })

      await this.infrastructureManager.deleteTenantResources(resources)
      await this.databaseManager.deleteTenantDatabase(resources.databaseName)
    }

    if (tenant.storageReference) {
      this.tenantRegistry.updateTenantStorageReference(tenant.id, null)
    }

    this.tenantRegistry.updateTenantDesiredState(tenant.id, 'deprovisioned')
    this.tenantRegistry.updateTenantState(
      tenant.id,
      'deprovisioned',
      params.triggeredBy,
      params.reason ?? 'Tenant resources deleted',
    )

    return {
      tenant: this.getExistingTenant(tenant.id),
      deprovisioned: true,
    }
  }

  async close(): Promise<void> {
    await this.databaseManager.close()
  }

  private createOpaqueSubdomainCandidate(): string {
    return `${opaqueSubdomainPrefix}-${randomBytes(6).toString('hex')}`
  }

  private getExistingTenant(tenantId: string): Tenant {
    const tenant = this.tenantRegistry.getTenant(tenantId)
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`)
    }

    return tenant
  }
}

export class PostgresTenantDatabaseManager implements TenantDatabaseManager {
  private readonly pool: Pool
  private readonly adminDatabaseUrl: string
  private readonly runtimeDatabaseUrl: string

  constructor(adminDatabaseUrl: string, runtimeDatabaseUrl?: string) {
    this.adminDatabaseUrl = adminDatabaseUrl
    this.runtimeDatabaseUrl =
      runtimeDatabaseUrl && runtimeDatabaseUrl.length > 0
        ? runtimeDatabaseUrl
        : adminDatabaseUrl
    this.pool = new Pool({
      connectionString: adminDatabaseUrl,
      max: 1,
    })
  }

  async ensureTenantDatabase(tenant: Tenant, subdomain: string): Promise<TenantDatabase> {
    const databaseName = buildTenantDatabaseName(tenant.id, subdomain)
    const client = await this.pool.connect()

    try {
      const existing = await client.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
        [databaseName],
      )

      if (!existing.rows[0]?.exists) {
        await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
      }
    } finally {
      client.release()
    }

    return {
      databaseName,
      runtimeConnectionString: buildTenantDatabaseConnectionString(
        this.runtimeDatabaseUrl,
        databaseName,
      ),
    }
  }

  async deleteTenantDatabase(databaseName: string): Promise<void> {
    const client = await this.pool.connect()

    try {
      const existing = await client.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
        [databaseName],
      )

      if (!existing.rows[0]?.exists) {
        return
      }

      await client.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()`,
        [databaseName],
      )
      await client.query(`DROP DATABASE ${quoteIdentifier(databaseName)}`)
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class KubernetesTenantInfrastructureManager
  implements TenantInfrastructureManager
{
  private readonly client: KubernetesObjectClient
  private readonly readyPollIntervalMs: number
  private readonly deleteTimeoutMs: number

  constructor(options?: {
    client?: KubernetesObjectClient
    kubeConfig?: KubeConfig
    readyPollIntervalMs?: number
    deleteTimeoutMs?: number
  }) {
    if (options?.client) {
      this.client = options.client
    } else {
      const kubeConfig = options?.kubeConfig ?? new KubeConfig()
      kubeConfig.loadFromDefault()
      this.client = KubernetesObjectApi.makeApiClient(kubeConfig)
    }
    this.readyPollIntervalMs =
      options?.readyPollIntervalMs ?? defaultReadyPollIntervalMs
    this.deleteTimeoutMs = options?.deleteTimeoutMs ?? defaultDeleteTimeoutMs
  }

  async applyTenantResources(bundle: TenantInfrastructureBundle): Promise<void> {
    await upsertKubernetesObject(this.client, bundle.namespace)
    await upsertKubernetesObject(this.client, bundle.configMap)
    await upsertKubernetesObject(this.client, bundle.secret)
    await upsertKubernetesObject(this.client, bundle.persistentVolumeClaim)
    await upsertKubernetesObject(this.client, bundle.service)
    await upsertKubernetesObject(this.client, bundle.deployment)
  }

  async waitForTenantReady(
    resources: TenantProvisioningResources,
    timeoutMs = defaultReadyTimeoutMs,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const deployment = await this.client.read<V1Deployment>({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: resources.deploymentName,
          namespace: resources.namespace,
        },
      })

      const generation = deployment.metadata?.generation ?? 0
      const observedGeneration = deployment.status?.observedGeneration ?? 0
      const specReplicas = deployment.spec?.replicas ?? 0
      const updatedReplicas = deployment.status?.updatedReplicas ?? 0
      const availableReplicas = deployment.status?.availableReplicas ?? 0
      const replicas = deployment.status?.replicas ?? 0
      const unavailableReplicas = deployment.status?.unavailableReplicas ?? 0

      const isFullyRolledOut =
        observedGeneration >= generation &&
        updatedReplicas === specReplicas &&
        availableReplicas === specReplicas &&
        replicas === specReplicas &&
        unavailableReplicas === 0 &&
        deployment.status?.conditions?.some(
          (condition) =>
            condition.type === 'Available' && condition.status === 'True',
        ) === true

      if (isFullyRolledOut) {
        return
      }

      await sleep(this.readyPollIntervalMs)
    }

    throw new Error(
      `Tenant workload ${resources.deploymentName} did not become ready within ${timeoutMs}ms`,
    )
  }

  async deleteTenantResources(resources: TenantProvisioningResources): Promise<void> {
    try {
      await this.client.delete({
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: {
          name: resources.pvcName,
          namespace: resources.namespace,
        },
      })
    } catch (error) {
      if (!isApiException(error, 404)) {
        throw error
      }
    }

    try {
      await this.client.delete(
        {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: resources.namespace,
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        'Foreground',
        {
          apiVersion: 'v1',
          kind: 'DeleteOptions',
        } as V1DeleteOptions,
      )
    } catch (error) {
      if (isApiException(error, 404)) {
        return
      }
      throw error
    }

    const deadline = Date.now() + this.deleteTimeoutMs

    while (Date.now() < deadline) {
      try {
        await this.client.read<V1Namespace>({
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: resources.namespace,
          },
        })
      } catch (error) {
        if (isApiException(error, 404)) {
          return
        }
        throw error
      }

      await sleep(this.readyPollIntervalMs)
    }

    throw new Error(
      `Tenant namespace ${resources.namespace} did not terminate within ${this.deleteTimeoutMs}ms`,
    )
  }
}

export function createLiveTenantProvisioningService(params: {
  tenantRegistry: TenantRegistry
  baseDomain: string
  imageRepository: string
  databaseAdminUrl: string
  databaseRuntimeUrl?: string
  imagePullSecretName?: string
  publicScheme?: 'http' | 'https'
  tenantPort?: number
  readyTimeoutMs?: number
}): TenantProvisioningService {
  return new TenantProvisioningService({
    tenantRegistry: params.tenantRegistry,
    infrastructureManager: new KubernetesTenantInfrastructureManager(),
    databaseManager: new PostgresTenantDatabaseManager(
      params.databaseAdminUrl,
      params.databaseRuntimeUrl,
    ),
    baseDomain: params.baseDomain,
    imageRepository: params.imageRepository,
    imagePullSecretName: params.imagePullSecretName,
    publicScheme: params.publicScheme,
    tenantPort: params.tenantPort,
    readyTimeoutMs: params.readyTimeoutMs,
  })
}

export function buildTenantInfrastructureBundle(
  options: BuildTenantInfrastructureBundleOptions,
): TenantInfrastructureBundle {
  const resources = buildTenantResourceNames({
    tenant: options.tenant,
    subdomain: options.subdomain,
    baseDomain: options.baseDomain,
    imageRepository: options.imageRepository,
  })
  const runtimeUrl = `${options.publicScheme}://${resources.hostname}`
  const namespaceLabels = buildTenantLabels(options.tenant, options.subdomain)

  return {
    resources,
    namespace: {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: resources.namespace,
        labels: namespaceLabels,
      },
    },
    configMap: {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: resources.configMapName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      data: {
        PORT: String(options.tenantPort),
        SERVE_WEB: 'true',
        PUBLIC_WEB_URL: runtimeUrl,
        ALLOWED_ORIGINS: runtimeUrl,
        NOTES_DB_PATH: `${defaultTenantStorageMountPath}/dnd-notes.sqlite`,
      },
    },
    secret: {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: resources.secretName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      type: 'Opaque',
      data: {
        DATABASE_URL: encodeSecretValue(options.database.runtimeConnectionString),
      },
    },
    persistentVolumeClaim: {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: resources.pvcName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: {
          requests: {
            storage: defaultTenantStorageRequest,
          },
        },
      },
    },
    service: {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: resources.serviceName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      spec: {
        selector: buildTenantSelectorLabels(options.tenant),
        ports: [
          {
            name: 'http',
            port: options.tenantPort,
            targetPort: options.tenantPort,
          },
        ],
      },
    },
    deployment: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: resources.deploymentName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      spec: {
        replicas: 1,
        minReadySeconds: 5,
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: {
            maxSurge: 0,
            maxUnavailable: 1,
          },
        },
        selector: {
          matchLabels: buildTenantSelectorLabels(options.tenant),
        },
        template: {
          metadata: {
            labels: namespaceLabels,
          },
          spec: {
            terminationGracePeriodSeconds: 30,
            imagePullSecrets: options.imagePullSecretName
              ? [{ name: options.imagePullSecretName }]
              : undefined,
            containers: [
              {
                name: 'tenant-app',
                image: resources.image,
                imagePullPolicy: 'IfNotPresent',
                ports: [
                  {
                    containerPort: options.tenantPort,
                    name: 'http',
                  },
                ],
                envFrom: [
                  {
                    configMapRef: { name: resources.configMapName },
                  },
                  {
                    secretRef: { name: resources.secretName },
                  },
                ],
                volumeMounts: [
                  {
                    name: 'tenant-data',
                    mountPath: defaultTenantStorageMountPath,
                  },
                ],
                livenessProbe: {
                  httpGet: {
                    path: '/healthz',
                    port: options.tenantPort,
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 10,
                  timeoutSeconds: 3,
                  failureThreshold: 3,
                },
                readinessProbe: {
                  httpGet: {
                    path: '/ready',
                    port: options.tenantPort,
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                  timeoutSeconds: 2,
                  failureThreshold: 2,
                },
              },
            ],
            volumes: [
              {
                name: 'tenant-data',
                persistentVolumeClaim: {
                  claimName: resources.pvcName,
                },
              },
            ],
          },
        },
      },
    },
  }
}

export function buildTenantDatabaseConnectionString(
  baseDatabaseUrl: string,
  databaseName: string,
): string {
  const connectionString = new URL(baseDatabaseUrl)
  connectionString.pathname = `/${databaseName}`
  return connectionString.toString()
}

export function buildTenantResourceNames(params: {
  tenant: Tenant
  subdomain: string
  baseDomain: string
  imageRepository: string
}): TenantProvisioningResources {
  const namespace = `tenant-${params.subdomain}`
  return {
    namespace,
    deploymentName: 'dnd-notes',
    serviceName: 'dnd-notes',
    pvcName: `dnd-notes-data-${params.subdomain}`,
    configMapName: 'dnd-notes-runtime',
    secretName: 'dnd-notes-runtime-secret',
    hostname: `${params.subdomain}.${params.baseDomain}`,
    databaseName: buildTenantDatabaseName(params.tenant.id, params.subdomain),
    image: `${params.imageRepository}:${params.tenant.version}`,
  }
}

function buildTenantSelectorLabels(tenant: Tenant): Record<string, string> {
  return {
    'app.kubernetes.io/name': 'dnd-notes',
    'app.kubernetes.io/component': 'tenant-app',
    'dnd-notes.dev/tenant-id': normalizeKubernetesLabelValue(tenant.id),
  }
}

function buildTenantLabels(
  tenant: Tenant,
  subdomain: string,
): Record<string, string> {
  return {
    ...buildTenantSelectorLabels(tenant),
    'app.kubernetes.io/managed-by': 'dnd-notes-control-plane',
    'dnd-notes.dev/tenant-slug': tenant.slug,
    'dnd-notes.dev/subdomain': subdomain,
  }
}

function buildTenantDatabaseName(tenantId: string, subdomain: string): string {
  const normalizedTenantId = tenantId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
  const normalizedSubdomain = subdomain.replace(/-/g, '_')

  const name = `tenant_${normalizedTenantId}_${normalizedSubdomain}`.slice(0, 63)

  return name.replace(/_+$/g, '')
}

function normalizeKubernetesLabelValue(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')

  if (normalized === '') {
    return `tenant-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
  }

  if (normalized.length <= maxKubernetesLabelValueLength) {
    return normalized
  }

  const digest = createHash('sha256').update(value).digest('hex').slice(0, 8)
  const maxPrefixLength = maxKubernetesLabelValueLength - digest.length - 1
  const trimmedPrefix = normalized
    .slice(0, maxPrefixLength)
    .replace(/[^a-z0-9]+$/g, '')

  return `${trimmedPrefix}-${digest}`
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`)
  }

  return `"${identifier.replace(/"/g, '""')}"`
}

function encodeSecretValue(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

async function upsertKubernetesObject<T extends KubernetesObject>(
  client: KubernetesObjectClient,
  spec: T,
): Promise<void> {
  try {
    const existing = await client.read<T>({
      apiVersion: spec.apiVersion,
      kind: spec.kind,
      metadata: {
        name: spec.metadata!.name!,
        namespace: spec.metadata?.namespace,
      },
    })
    const specForReplace = prepareKubernetesObjectForReplace(spec, existing)
    specForReplace.metadata = {
      ...specForReplace.metadata,
      resourceVersion: existing.metadata?.resourceVersion,
    }
    await client.replace(specForReplace)
  } catch (error) {
    if (isApiException(error, 404)) {
      await client.create(spec)
      return
    }

    throw error
  }
}

function prepareKubernetesObjectForReplace<T extends KubernetesObject>(
  spec: T,
  existing: T,
): T {
  if (spec.kind === 'Service' && existing.kind === 'Service') {
    const desiredService = spec as T & V1Service
    const existingService = existing as T & V1Service

    return {
      ...desiredService,
      metadata: {
        ...desiredService.metadata,
      },
      spec: {
        ...desiredService.spec,
        clusterIP: desiredService.spec?.clusterIP ?? existingService.spec?.clusterIP,
        clusterIPs: desiredService.spec?.clusterIPs ?? existingService.spec?.clusterIPs,
        healthCheckNodePort:
          desiredService.spec?.healthCheckNodePort ??
          existingService.spec?.healthCheckNodePort,
        ipFamilies:
          desiredService.spec?.ipFamilies ?? existingService.spec?.ipFamilies,
        ipFamilyPolicy:
          desiredService.spec?.ipFamilyPolicy ??
          existingService.spec?.ipFamilyPolicy,
        ports: mergeServicePorts(desiredService.spec?.ports, existingService.spec?.ports),
      },
    }
  }

  if (
    spec.kind === 'PersistentVolumeClaim' &&
    existing.kind === 'PersistentVolumeClaim'
  ) {
    const desiredPvc = spec as T & V1PersistentVolumeClaim
    const existingPvc = existing as T & V1PersistentVolumeClaim

    return {
      ...desiredPvc,
      metadata: {
        ...desiredPvc.metadata,
      },
      spec: mergePersistentVolumeClaimSpec(desiredPvc, existingPvc),
    }
  }

  return {
    ...spec,
    metadata: {
      ...spec.metadata,
    },
  }
}

function mergeServicePorts(
  desiredPorts: V1ServicePort[] | undefined,
  existingPorts: V1ServicePort[] | undefined,
): V1ServicePort[] | undefined {
  if (!desiredPorts) {
    return desiredPorts
  }

  return desiredPorts.map((desiredPort) => {
    const matchingExistingPort = existingPorts?.find((existingPort) => {
      if (desiredPort.name && existingPort.name) {
        return desiredPort.name === existingPort.name
      }

      return (
        desiredPort.port === existingPort.port &&
        (desiredPort.protocol ?? 'TCP') === (existingPort.protocol ?? 'TCP')
      )
    })

    if (!matchingExistingPort?.nodePort) {
      return desiredPort
    }

    return {
      ...desiredPort,
      nodePort: desiredPort.nodePort ?? matchingExistingPort.nodePort,
    }
  })
}

function mergePersistentVolumeClaimSpec(
  desiredPvc: V1PersistentVolumeClaim,
  existingPvc: V1PersistentVolumeClaim,
): V1PersistentVolumeClaimSpec | undefined {
  return {
    ...desiredPvc.spec,
    storageClassName:
      desiredPvc.spec?.storageClassName ?? existingPvc.spec?.storageClassName,
    volumeMode: desiredPvc.spec?.volumeMode ?? existingPvc.spec?.volumeMode,
    volumeName: desiredPvc.spec?.volumeName ?? existingPvc.spec?.volumeName,
  }
}

function isApiException(error: unknown, statusCode: number): error is ApiException<unknown> {
  return error instanceof ApiException && error.code === statusCode
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
