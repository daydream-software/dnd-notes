import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
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
  constructor(message: string) {
    super(message)
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
    const tenantDirectory = join(
      this.rootDirectory,
      sanitizePathComponent(params.tenantId),
    )
    await mkdir(tenantDirectory, { recursive: true })
    const targetPath = join(
      tenantDirectory,
      `${sanitizeTimestamp(params.capturedAt)}-${basename(params.sourcePath)}`,
    )
    await copyFile(params.sourcePath, targetPath)
    return {
      location: pathToFileURL(targetPath).toString(),
    }
  }

  async materializeBackup(params: {
    location: string
    destinationPath: string
  }): Promise<void> {
    const sourcePath = this.resolveLocation(params.location)
    await mkdir(dirname(params.destinationPath), { recursive: true })
    await copyFile(sourcePath, params.destinationPath)
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

    const relativePath = relative(this.rootDirectory, filePath)
    if (
      relativePath !== '' &&
      (relativePath === '..' ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath))
    ) {
      throw new TenantBackupValidationError(
        `Backup location ${JSON.stringify(location)} is outside the configured artifact store.`,
      )
    }

    return filePath
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

      const [fileStats, sha256, storedArtifact] = await Promise.all([
        stat(backupPath),
        calculateSha256(backupPath),
        this.artifactStore.storeBackup({
          tenantId: tenant.id,
          sourcePath: backupPath,
          capturedAt,
        }),
      ])

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

    const safetySnapshot = await this.backupTenant(tenant)
    const restoreDirectory = await mkdtemp(join(tmpdir(), 'dnd-notes-tenant-restore-'))
    const restorePath = join(restoreDirectory, 'tenant-backup.dump')
    const restoredAt = this.now().toISOString()

    try {
      await this.artifactStore.materializeBackup({
        location: backupLocation,
        destinationPath: restorePath,
      })
      await this.terminateActiveConnections(databaseName)
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

  private async terminateActiveConnections(databaseName: string): Promise<void> {
    const client = await this.pool.connect()

    try {
      await client.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()`,
        [databaseName],
      )
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
  return value.replace(/[^A-Za-z0-9._-]+/g, '-')
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
