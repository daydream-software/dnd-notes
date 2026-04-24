import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import { buildTenantDatabaseConnectionString } from './provisioning.js'
import { tenantPvcNamePrefix } from './tenant-subdomain.js'
import type { Tenant } from './types.js'

interface PostgresClientLike {
  query<Row extends { [key: string]: unknown } = Record<string, never>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>
  release(): void
}

interface PostgresPoolLike {
  connect(): Promise<PostgresClientLike>
  end(): Promise<void>
}

export interface TenantBackupArtifact {
  tenantId: string
  databaseName: string
  format: 'custom'
  location: string
  sha256: string
  sizeBytes: number
  capturedAt: string
}

export interface TenantRestoreResult {
  tenantId: string
  databaseName: string
  backupLocation: string
  restoredAt: string
  safetySnapshot: TenantBackupArtifact
}

interface CommandExecutionOptions {
  env?: NodeJS.ProcessEnv
}

const maxCapturedCommandStderrBytes = 32 * 1024

export interface CommandExecutor {
  run(
    command: string,
    args: string[],
    options?: CommandExecutionOptions,
  ): Promise<void>
}

export interface TenantBackupArtifactStore {
  storeBackup(params: {
    tenantId: string
    sourcePath: string
    capturedAt: string
  }): Promise<{ location: string }>
  materializeBackup(params: {
    location: string
    destinationPath: string
  }): Promise<void>
}

export class TenantBackupValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TenantBackupValidationError'
  }
}

class SpawnCommandExecutor implements CommandExecutor {
  async run(
    command: string,
    args: string[],
    options?: CommandExecutionOptions,
  ): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(command, args, {
        env: {
          ...process.env,
          ...options?.env,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      let stderrWasTruncated = false

      child.stderr.on('data', (chunk: Buffer | string) => {
        const nextStderr = `${stderr}${chunk.toString()}`
        const nextStderrBuffer = Buffer.from(nextStderr)

        if (nextStderrBuffer.length <= maxCapturedCommandStderrBytes) {
          stderr = nextStderr
          return
        }

        stderrWasTruncated = true
        stderr = nextStderrBuffer
          .subarray(nextStderrBuffer.length - maxCapturedCommandStderrBytes)
          .toString()
      })
      child.on('error', rejectPromise)
      child.on('close', (code) => {
        if (code === 0) {
          resolvePromise()
          return
        }

        const details = stderr.trim()
        const formattedDetails = stderrWasTruncated
          ? `[stderr truncated to last ${maxCapturedCommandStderrBytes} bytes]\n${details}`
          : details
        rejectPromise(
          new Error(
            formattedDetails.length > 0
              ? `${command} failed: ${formattedDetails}`
              : `${command} exited with code ${code ?? 'unknown'}`,
          ),
        )
      })
    })
  }
}

export class FileSystemTenantBackupArtifactStore
  implements TenantBackupArtifactStore
{
  private readonly rootDirectory: string

  constructor(rootDirectory: string) {
    const resolvedRootDirectory = resolve(rootDirectory)

    if (dirname(resolvedRootDirectory) === resolvedRootDirectory) {
      throw new Error('Artifact store rootDirectory must not be the filesystem root.')
    }

    this.rootDirectory = resolvedRootDirectory
  }

  async storeBackup(params: {
    tenantId: string
    sourcePath: string
    capturedAt: string
  }): Promise<{ location: string }> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 })
    await chmod(this.rootDirectory, 0o700)
    const tenantDirectory = resolveContainedArtifactPath(
      this.rootDirectory,
      join(this.rootDirectory, sanitizePathComponent(params.tenantId)),
      `Backup artifact directory for tenant ${JSON.stringify(params.tenantId)}`,
    )
    await mkdir(tenantDirectory, { recursive: true, mode: 0o700 })
    await chmod(tenantDirectory, 0o700)
    const targetPath = resolveContainedArtifactPath(
      this.rootDirectory,
      join(
        tenantDirectory,
        `${sanitizeTimestamp(params.capturedAt)}-${basename(params.sourcePath)}`,
      ),
      `Backup artifact path for tenant ${JSON.stringify(params.tenantId)}`,
    )
    await copyFile(params.sourcePath, targetPath)
    await chmod(targetPath, 0o600)
    return {
      location: pathToFileURL(targetPath).toString(),
    }
  }

  async materializeBackup(params: {
    location: string
    destinationPath: string
  }): Promise<void> {
    const sourcePath = this.resolveLocation(params.location)
    await assertBackupArtifactFile(sourcePath, params.location)
    const destinationDirectory = dirname(params.destinationPath)
    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 })
    await chmod(destinationDirectory, 0o700)
    await copyFile(sourcePath, params.destinationPath)
    await chmod(params.destinationPath, 0o600)
  }

  private resolveLocation(location: string): string {
    let filePath: string

    try {
      const url = new URL(location)
      if (url.protocol !== 'file:') {
        throw new TenantBackupValidationError(
          `Unsupported backup location ${JSON.stringify(location)}.`,
        )
      }
      filePath = resolve(fileURLToPath(url))
    } catch (error) {
      if (error instanceof TenantBackupValidationError) {
        throw error
      }

      throw new TenantBackupValidationError(
        `Unsupported backup location ${JSON.stringify(location)}.`,
      )
    }

    return resolveContainedArtifactPath(
      this.rootDirectory,
      filePath,
      `Backup location ${JSON.stringify(location)}`,
    )
  }
}

export class PostgresTenantBackupRunner {
  private readonly adminDatabaseUrl: string
  private readonly artifactStore: TenantBackupArtifactStore
  private readonly commandExecutor: CommandExecutor
  private readonly now: () => Date
  private readonly pool: PostgresPoolLike

  constructor(options: {
    adminDatabaseUrl: string
    artifactStore: TenantBackupArtifactStore
    commandExecutor?: CommandExecutor
    now?: () => Date
    pool?: PostgresPoolLike
  }) {
    this.adminDatabaseUrl = options.adminDatabaseUrl
    this.artifactStore = options.artifactStore
    this.commandExecutor = options.commandExecutor ?? new SpawnCommandExecutor()
    this.now = options.now ?? (() => new Date())
    this.pool =
      options.pool ??
      new Pool({
        connectionString: options.adminDatabaseUrl,
        max: 1,
      })
  }

  async backupTenant(tenant: Tenant): Promise<TenantBackupArtifact> {
    const databaseName = resolveTenantDatabaseName(tenant)
    const capturedAt = this.now().toISOString()
    const connectionTarget = buildPgCommandConnectionTarget(
      buildTenantDatabaseConnectionString(this.adminDatabaseUrl, databaseName),
    )
    const backupDirectory = await mkdtemp(join(tmpdir(), 'dnd-notes-tenant-backup-'))
    const backupPath = join(
      backupDirectory,
      `${sanitizePathComponent(tenant.id)}-${sanitizeTimestamp(capturedAt)}.dump`,
    )

    try {
      await this.commandExecutor.run(
        'pg_dump',
        [
          '--format=custom',
          '--no-owner',
          '--file',
          backupPath,
          '--dbname',
          connectionTarget.connectionString,
        ],
        {
          env: connectionTarget.env,
        },
      )

      const [fileStats, storedArtifact] = await Promise.all([
        stat(backupPath),
        this.artifactStore.storeBackup({
          tenantId: tenant.id,
          sourcePath: backupPath,
          capturedAt,
        }),
      ])
      const sha256 = await calculateSha256(
        resolveBackupArtifactPath(storedArtifact.location) ?? backupPath,
      )

      return {
        tenantId: tenant.id,
        databaseName,
        format: 'custom',
        location: storedArtifact.location,
        sha256,
        sizeBytes: fileStats.size,
        capturedAt,
      }
    } finally {
      await rm(backupDirectory, { recursive: true, force: true })
    }
  }

  async restoreTenant(params: {
    tenant: Tenant
    backupLocation: string
  }): Promise<TenantRestoreResult> {
    const { tenant, backupLocation } = params
    const databaseName = resolveTenantDatabaseName(tenant)
    const connectionTarget = buildPgCommandConnectionTarget(
      buildTenantDatabaseConnectionString(this.adminDatabaseUrl, databaseName),
    )

    if (tenant.currentState !== 'restoring') {
      throw new TenantBackupValidationError(
        `Tenant ${tenant.id} must be in restoring state before pg_restore can run.`,
      )
    }

    const restoreDirectory = await mkdtemp(join(tmpdir(), 'dnd-notes-tenant-restore-'))
    const restorePath = join(restoreDirectory, 'tenant-backup.dump')

    try {
      await this.artifactStore.materializeBackup({
        location: backupLocation,
        destinationPath: restorePath,
      })
      await this.assertNoActiveConnections(databaseName, tenant.id)
      const safetySnapshot = await this.backupTenant(tenant)
      const restoredAt = this.now().toISOString()
      await this.commandExecutor.run(
        'pg_restore',
        [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--dbname',
          connectionTarget.connectionString,
          restorePath,
        ],
        {
          env: connectionTarget.env,
        },
      )

      return {
        tenantId: tenant.id,
        databaseName,
        backupLocation,
        restoredAt,
        safetySnapshot,
      }
    } finally {
      await rm(restoreDirectory, { recursive: true, force: true })
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async assertNoActiveConnections(
    databaseName: string,
    tenantId: string,
  ): Promise<void> {
    const client = await this.pool.connect()

    try {
      const result = await client.query<{ active_connection_count: number | string }>(
        `SELECT COUNT(*)::integer AS active_connection_count
           FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()`,
        [databaseName],
      )

      const activeConnectionCount = Number(
        result.rows[0]?.active_connection_count ?? 0,
      )

      if (activeConnectionCount > 0) {
        throw new TenantBackupValidationError(
          `Tenant ${tenantId} restore requires an exclusive maintenance window; found ${activeConnectionCount} active database connection(s).`,
        )
      }
    } finally {
      client.release()
    }
  }
}

export function resolveTenantDatabaseName(tenant: Tenant): string {
  const storageReference = tenant.storageReference?.trim() ?? ''

  if (storageReference.length === 0) {
    throw new TenantBackupValidationError(
      `Tenant ${tenant.id} does not have a Postgres database reference to back up.`,
    )
  }

  if (storageReference.startsWith(tenantPvcNamePrefix)) {
    throw new TenantBackupValidationError(
      `Tenant ${tenant.id} still uses PVC-backed SQLite storage; pg_dump/pg_restore is not available until cutover completes.`,
    )
  }

  return storageReference
}

function sanitizePathComponent(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '-')

  if (sanitized.length === 0 || sanitized === '.' || sanitized === '..') {
    throw new TenantBackupValidationError(
      `Invalid backup path component ${JSON.stringify(value)}.`,
    )
  }

  if (sanitized !== value) {
    const hashSuffix = createHash('sha256').update(value).digest('hex').slice(0, 12)
    return `${sanitized}-${hashSuffix}`
  }

  return sanitized
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-')
}

async function calculateSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)

  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.on('error', rejectPromise)
    stream.on('end', () => {
      resolvePromise()
    })
  })

  return hash.digest('hex')
}

function buildPgCommandConnectionTarget(connectionString: string): {
  connectionString: string
  env?: NodeJS.ProcessEnv
} {
  const url = new URL(connectionString)
  const password = decodePgConnectionPassword(url.password)

  url.password = ''

  return {
    connectionString: url.toString(),
    env: password.length > 0 ? { PGPASSWORD: password } : undefined,
  }
}

function decodePgConnectionPassword(password: string): string {
  if (!password.includes('%') || /%(?![0-9A-Fa-f]{2})/.test(password)) {
    return password
  }

  return decodeURIComponent(password)
}

function resolveBackupArtifactPath(location: string): string | null {
  if (location.startsWith('file:')) {
    return fileURLToPath(location)
  }

  return isAbsolute(location) ? location : null
}

function resolveContainedArtifactPath(
  rootDirectory: string,
  filePath: string,
  label: string,
): string {
  const resolvedPath = resolve(filePath)
  const relativePath = relative(rootDirectory, resolvedPath)

  if (
    relativePath !== '' &&
    (relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath))
  ) {
    throw new TenantBackupValidationError(
      `${label} is outside the configured artifact store.`,
    )
  }

  return resolvedPath
}

async function assertBackupArtifactFile(
  sourcePath: string,
  location: string,
): Promise<void> {
  let sourceStats

  try {
    sourceStats = await stat(sourcePath)
  } catch (error) {
    throw new TenantBackupValidationError(
      `Backup location ${JSON.stringify(location)} does not reference a readable artifact file.`,
      { cause: error },
    )
  }

  if (!sourceStats.isFile()) {
    throw new TenantBackupValidationError(
      `Backup location ${JSON.stringify(location)} must reference a regular file.`,
    )
  }
}
