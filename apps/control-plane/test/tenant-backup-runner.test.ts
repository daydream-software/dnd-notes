import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import type { Tenant } from '../src/types.js'
import {
  FileSystemTenantBackupArtifactStore,
  PostgresTenantBackupRunner,
  TenantBackupValidationError,
  resolveTenantDatabaseName,
} from '../src/tenant-backup-runner.js'

class FakeCommandExecutor {
  calls: Array<{
    command: string
    args: string[]
    env?: NodeJS.ProcessEnv
  }> = []
  dumpPayload = Buffer.from('synthetic-pg-dump-artifact')
  restoredPayloads: string[] = []

  async run(
    command: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv },
  ): Promise<void> {
    this.calls.push({ command, args, env: options?.env })

    if (command === 'pg_dump') {
      const fileIndex = args.indexOf('--file')
      const outputPath = args[fileIndex + 1]

      if (!outputPath) {
        throw new Error('Missing --file output path')
      }

      await writeFile(outputPath, this.dumpPayload)
      return
    }

    if (command === 'pg_restore') {
      const restorePath = args.at(-1)

      if (!restorePath) {
        throw new Error('Missing restore input path')
      }

      this.restoredPayloads.push((await readFile(restorePath)).toString('utf8'))
      return
    }

    throw new Error(`Unexpected command ${command}`)
  }
}

class FakePool {
  queries: Array<{ text: string; values?: readonly unknown[] }> = []
  activeConnectionCount = 0
  activeConnectionCounts: number[] = []

  async connect() {
    return {
      query: async (text: string, values?: readonly unknown[]) => {
        this.queries.push({ text, values })
        if (text.includes('COUNT(*)::integer AS active_connection_count')) {
          const activeConnectionCount =
            this.activeConnectionCounts.length > 0
              ? (this.activeConnectionCounts.shift() ?? 0)
              : this.activeConnectionCount
          return {
            rows: [{ active_connection_count: activeConnectionCount }],
          }
        }
        return { rows: [] }
      },
      release() {},
    }
  }

  async end() {}
}

function createTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-demo',
    slug: 'tenant-demo',
    subdomain: 't-demo',
    ownerId: 'owner-1',
    displayName: null,
    planTier: null,
    initialAdminEmail: null,
    desiredState: 'ready',
    currentState: 'ready',
    version: '1.0.0',
    storageReference: 'tenant_demo_t_demo',
    backupMetadata: null,
    createdAt: '2026-04-24T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
    ...overrides,
  }
}

describe('PostgresTenantBackupRunner', () => {
  it('creates a custom pg_dump artifact for Postgres-backed tenants', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const executor = new FakeCommandExecutor()
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:postgres@postgres.default:5432/postgres',
      artifactStore: new FileSystemTenantBackupArtifactStore(artifactRoot),
      commandExecutor: executor,
      now: () => new Date('2026-04-24T01:02:03.456Z'),
    })

    try {
      const tenant = createTenant()

      const artifact = await runner.backupTenant(tenant)

      assert.equal(executor.calls.length, 1)
      assert.equal(executor.calls[0]?.command, 'pg_dump')
      assert.deepEqual(executor.calls[0]?.args.slice(0, 3), [
        '--format=custom',
        '--no-owner',
        '--file',
      ])
      assert.equal(executor.calls[0]?.args[4], '--dbname')
      assert.equal(
        executor.calls[0]?.args.at(-1),
        'postgresql://postgres@postgres.default:5432/tenant_demo_t_demo',
      )
      assert.equal(executor.calls[0]?.env?.PGPASSWORD, 'postgres')
      assert.equal(artifact.tenantId, tenant.id)
      assert.equal(artifact.databaseName, 'tenant_demo_t_demo')
      assert.equal(artifact.format, 'custom')
      assert.equal(artifact.capturedAt, '2026-04-24T01:02:03.456Z')
      assert.equal(artifact.sizeBytes, executor.dumpPayload.length)
      assert.equal(
        artifact.sha256,
        createHash('sha256').update(executor.dumpPayload).digest('hex'),
      )

      const storedPath = fileURLToPath(artifact.location)
      const storedStats = await stat(storedPath)
      const tenantDirectoryStats = await stat(dirname(storedPath))
      assert.equal(storedStats.size, executor.dumpPayload.length)
      assert.equal(storedStats.mode & 0o777, 0o600)
      assert.equal(tenantDirectoryStats.mode & 0o777, 0o700)
    } finally {
      await runner.close()
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('decodes encoded database passwords exactly once for PGPASSWORD', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const executor = new FakeCommandExecutor()
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:pa%25ss@postgres.default:5432/postgres',
      artifactStore: new FileSystemTenantBackupArtifactStore(artifactRoot),
      commandExecutor: executor,
      now: () => new Date('2026-04-24T01:02:03.456Z'),
    })

    try {
      await runner.backupTenant(createTenant())

      assert.equal(executor.calls[0]?.env?.PGPASSWORD, 'pa%ss')
    } finally {
      await runner.close()
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('preserves literal percent characters in unescaped database passwords', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const executor = new FakeCommandExecutor()
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:pa%ss@postgres.default:5432/postgres',
      artifactStore: new FileSystemTenantBackupArtifactStore(artifactRoot),
      commandExecutor: executor,
      now: () => new Date('2026-04-24T01:02:03.456Z'),
    })

    try {
      await runner.backupTenant(createTenant())

      assert.equal(executor.calls[0]?.env?.PGPASSWORD, 'pa%ss')
    } finally {
      await runner.close()
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('rejects backup attempts for PVC-backed tenants that have not cut over yet', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:postgres@postgres.default:5432/postgres',
      artifactStore: new FileSystemTenantBackupArtifactStore(artifactRoot),
    })

    try {
      await assert.rejects(
        () =>
          runner.backupTenant(
            createTenant({
              storageReference: 'dnd-notes-data-t-demo',
            }),
          ),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /PVC-backed SQLite storage/i.test(error.message),
      )
    } finally {
      await runner.close()
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('restores a tenant backup after taking a pre-restore safety snapshot', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)
    const executor = new FakeCommandExecutor()
    const pool = new FakePool()
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:postgres@postgres.default:5432/postgres',
      artifactStore,
      commandExecutor: executor,
      pool,
      now: () => new Date('2026-04-24T01:10:00.000Z'),
    })

    let sourceDirectory: string | undefined
    try {
      sourceDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-source-'))
      const sourcePath = join(sourceDirectory, 'incoming.dump')
      await writeFile(sourcePath, 'restore-payload')
      const storedBackup = await artifactStore.storeBackup({
        tenantId: 'tenant-demo',
        sourcePath,
        capturedAt: '2026-04-24T01:00:00.000Z',
      })

      const result = await runner.restoreTenant({
        tenant: createTenant({
          currentState: 'restoring',
        }),
        backupLocation: storedBackup.location,
      })

      assert.equal(executor.calls.length, 2)
      assert.deepEqual(
        executor.calls.map((call) => call.command),
        ['pg_dump', 'pg_restore'],
      )
      assert.equal(pool.queries.length, 2)
      for (const query of pool.queries) {
        assert.match(query.text, /COUNT\(\*\)::integer AS active_connection_count/)
        assert.deepEqual(query.values, ['tenant_demo_t_demo'])
      }
      assert.equal(result.tenantId, 'tenant-demo')
      assert.equal(result.databaseName, 'tenant_demo_t_demo')
      assert.equal(result.backupLocation, storedBackup.location)
      assert.equal(result.restoredAt, '2026-04-24T01:10:00.000Z')
      assert.equal(result.safetySnapshot.format, 'custom')
      assert.equal(result.safetySnapshot.databaseName, 'tenant_demo_t_demo')
      assert.deepEqual(executor.restoredPayloads, ['restore-payload'])
      assert.equal(executor.calls[0]?.env?.PGPASSWORD, 'postgres')
      assert.equal(executor.calls[1]?.env?.PGPASSWORD, 'postgres')
    } finally {
      await runner.close()
      if (sourceDirectory) {
        await rm(sourceDirectory, { recursive: true, force: true })
      }
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('requires tenants to enter restoring state before pg_restore runs', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:postgres@postgres.default:5432/postgres',
      artifactStore: new FileSystemTenantBackupArtifactStore(artifactRoot),
    })

    try {
      await assert.rejects(
        () =>
          runner.restoreTenant({
            tenant: createTenant({
              currentState: 'ready',
            }),
            backupLocation: 'file:///tmp/does-not-matter.dump',
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /must be in restoring state/i.test(error.message),
      )
    } finally {
      await runner.close()
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('validates the requested backup before taking a safety snapshot', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const executor = new FakeCommandExecutor()
    const pool = new FakePool()
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:postgres@postgres.default:5432/postgres',
      artifactStore: new FileSystemTenantBackupArtifactStore(artifactRoot),
      commandExecutor: executor,
      pool,
    })

    try {
      await assert.rejects(
        () =>
          runner.restoreTenant({
            tenant: createTenant({
              currentState: 'restoring',
            }),
            backupLocation: 'https://example.com/not-a-backup.dump',
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /unsupported backup location/i.test(error.message),
      )
      assert.equal(executor.calls.length, 0)
      assert.equal(pool.queries.length, 0)
    } finally {
      await runner.close()
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('refuses restore when tenant database connections are still active', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)
    const executor = new FakeCommandExecutor()
    const pool = new FakePool()
    pool.activeConnectionCount = 2
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:postgres@postgres.default:5432/postgres',
      artifactStore,
      commandExecutor: executor,
      pool,
      now: () => new Date('2026-04-24T01:10:00.000Z'),
    })

    let sourceDirectory: string | undefined
    try {
      sourceDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-source-'))
      const sourcePath = join(sourceDirectory, 'incoming.dump')
      await writeFile(sourcePath, 'restore-payload')
      const storedBackup = await artifactStore.storeBackup({
        tenantId: 'tenant-demo',
        sourcePath,
        capturedAt: '2026-04-24T01:00:00.000Z',
      })

      await assert.rejects(
        () =>
          runner.restoreTenant({
            tenant: createTenant({
              currentState: 'restoring',
            }),
            backupLocation: storedBackup.location,
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /exclusive maintenance window; found 2 active database connection/i.test(
            error.message,
          ),
      )

      assert.equal(executor.calls.length, 0)
      assert.equal(pool.queries.length, 1)
    } finally {
      await runner.close()
      if (sourceDirectory) {
        await rm(sourceDirectory, { recursive: true, force: true })
      }
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })

  it('rechecks for active connections immediately before pg_restore runs', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-artifacts-'))
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)
    const executor = new FakeCommandExecutor()
    const pool = new FakePool()
    pool.activeConnectionCounts = [0, 1]
    const runner = new PostgresTenantBackupRunner({
      adminDatabaseUrl: 'postgresql://postgres:postgres@postgres.default:5432/postgres',
      artifactStore,
      commandExecutor: executor,
      pool,
      now: () => new Date('2026-04-24T01:10:00.000Z'),
    })

    let sourceDirectory: string | undefined
    try {
      sourceDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-source-'))
      const sourcePath = join(sourceDirectory, 'incoming.dump')
      await writeFile(sourcePath, 'restore-payload')
      const storedBackup = await artifactStore.storeBackup({
        tenantId: 'tenant-demo',
        sourcePath,
        capturedAt: '2026-04-24T01:00:00.000Z',
      })

      await assert.rejects(
        () =>
          runner.restoreTenant({
            tenant: createTenant({
              currentState: 'restoring',
            }),
            backupLocation: storedBackup.location,
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /exclusive maintenance window; found 1 active database connection/i.test(
            error.message,
          ),
      )

      assert.deepEqual(
        executor.calls.map((call) => call.command),
        ['pg_dump'],
      )
      assert.equal(executor.restoredPayloads.length, 0)
      assert.equal(pool.queries.length, 2)
    } finally {
      await runner.close()
      if (sourceDirectory) {
        await rm(sourceDirectory, { recursive: true, force: true })
      }
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })
})

describe('FileSystemTenantBackupArtifactStore', () => {
  it('rejects the filesystem root as an artifact store root directory', () => {
    assert.throws(
      () => new FileSystemTenantBackupArtifactStore('/'),
      /must not be the filesystem root/i,
    )
  })

  it('rejects backup locations outside the configured artifact store', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-root-'))
    const sourceDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-source-'))
    const destinationDirectory = await mkdtemp(
      join(tmpdir(), 'tenant-backup-destination-'),
    )
    const sourcePath = join(sourceDirectory, 'artifact.dump')
    const destinationPath = join(destinationDirectory, 'copied.dump')
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)

    try {
      await writeFile(sourcePath, 'outside-artifact')

      await assert.rejects(
        () =>
          artifactStore.materializeBackup({
            location: pathToFileURL(sourcePath).toString(),
            destinationPath,
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /outside the configured artifact store/i.test(error.message),
      )
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
      await rm(sourceDirectory, { recursive: true, force: true })
      await rm(destinationDirectory, { recursive: true, force: true })
    }
  })

  it('rejects non-file backup locations', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-root-'))
    const destinationDirectory = await mkdtemp(
      join(tmpdir(), 'tenant-backup-destination-'),
    )
    const destinationPath = join(destinationDirectory, 'copied.dump')
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)

    try {
      await assert.rejects(
        () =>
          artifactStore.materializeBackup({
            location: 'https://example.com/artifact.dump',
            destinationPath,
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /unsupported backup location/i.test(error.message),
      )
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
      await rm(destinationDirectory, { recursive: true, force: true })
    }
  })

  it('rejects path traversal tenant IDs when storing backups', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-root-'))
    const sourceDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-source-'))
    const sourcePath = join(sourceDirectory, 'artifact.dump')
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)

    try {
      await writeFile(sourcePath, 'backup-artifact')

      for (const tenantId of ['.', '..']) {
        await assert.rejects(
          () =>
            artifactStore.storeBackup({
              tenantId,
              sourcePath,
              capturedAt: '2026-04-24T01:00:00.000Z',
            }),
          (error) =>
            error instanceof TenantBackupValidationError &&
            /invalid backup path component/i.test(error.message),
        )
      }
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
      await rm(sourceDirectory, { recursive: true, force: true })
    }
  })

  it('adds a hash suffix when sanitizing tenant IDs would otherwise collide', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-root-'))
    const sourceDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-source-'))
    const sourcePath = join(sourceDirectory, 'artifact.dump')
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)

    try {
      await writeFile(sourcePath, 'backup-artifact')

      const firstArtifact = await artifactStore.storeBackup({
        tenantId: 'tenant/a',
        sourcePath,
        capturedAt: '2026-04-24T01:00:00.000Z',
      })
      const secondArtifact = await artifactStore.storeBackup({
        tenantId: 'tenant?a',
        sourcePath,
        capturedAt: '2026-04-24T01:00:00.000Z',
      })

      const firstDirectory = dirname(fileURLToPath(firstArtifact.location))
      const secondDirectory = dirname(fileURLToPath(secondArtifact.location))

      assert.notEqual(firstDirectory, secondDirectory)
      assert.match(firstDirectory, /tenant-a-[0-9a-f]{12}$/)
      assert.match(secondDirectory, /tenant-a-[0-9a-f]{12}$/)
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
      await rm(sourceDirectory, { recursive: true, force: true })
    }
  })

  it('rejects backup locations that do not reference a regular file', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-root-'))
    const destinationDirectory = await mkdtemp(
      join(tmpdir(), 'tenant-backup-destination-'),
    )
    const destinationPath = join(destinationDirectory, 'copied.dump')
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)

    try {
      await assert.rejects(
        () =>
          artifactStore.materializeBackup({
            location: pathToFileURL(artifactRoot).toString(),
            destinationPath,
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /must reference a regular file/i.test(error.message),
      )

      await assert.rejects(
        () =>
          artifactStore.materializeBackup({
            location: pathToFileURL(join(artifactRoot, 'missing.dump')).toString(),
            destinationPath,
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /does not reference a readable artifact file/i.test(error.message),
      )
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
      await rm(destinationDirectory, { recursive: true, force: true })
    }
  })

  it('rejects symlink escapes when storing backups', async () => {
    if (process.platform === 'win32') {
      return
    }

    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-root-'))
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-outside-'))
    const sourceDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-source-'))
    const sourcePath = join(sourceDirectory, 'artifact.dump')
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)

    try {
      await writeFile(sourcePath, 'backup-artifact')
      await symlink(outsideDirectory, join(artifactRoot, 'tenant-demo'))

      await assert.rejects(
        () =>
          artifactStore.storeBackup({
            tenantId: 'tenant-demo',
            sourcePath,
            capturedAt: '2026-04-24T01:00:00.000Z',
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /must not traverse symbolic links/i.test(error.message),
      )
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
      await rm(outsideDirectory, { recursive: true, force: true })
      await rm(sourceDirectory, { recursive: true, force: true })
    }
  })

  it('rejects symlink escapes when materializing backups', async () => {
    if (process.platform === 'win32') {
      return
    }

    const artifactRoot = await mkdtemp(join(tmpdir(), 'tenant-backup-root-'))
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'tenant-backup-outside-'))
    const destinationDirectory = await mkdtemp(
      join(tmpdir(), 'tenant-backup-destination-'),
    )
    const outsidePath = join(outsideDirectory, 'artifact.dump')
    const destinationPath = join(destinationDirectory, 'copied.dump')
    const tenantDirectory = join(artifactRoot, 'tenant-demo')
    const symlinkPath = join(tenantDirectory, 'artifact.dump')
    const artifactStore = new FileSystemTenantBackupArtifactStore(artifactRoot)

    try {
      await writeFile(outsidePath, 'outside-artifact')
      await mkdir(tenantDirectory, { recursive: true })
      await symlink(outsidePath, symlinkPath)

      await assert.rejects(
        () =>
          artifactStore.materializeBackup({
            location: pathToFileURL(symlinkPath).toString(),
            destinationPath,
          }),
        (error) =>
          error instanceof TenantBackupValidationError &&
          /must not traverse symbolic links/i.test(error.message),
      )
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
      await rm(outsideDirectory, { recursive: true, force: true })
      await rm(destinationDirectory, { recursive: true, force: true })
    }
  })
})

describe('resolveTenantDatabaseName', () => {
  it('returns the persisted Postgres database reference for cut-over tenants', () => {
    assert.equal(resolveTenantDatabaseName(createTenant()), 'tenant_demo_t_demo')
  })

  it('rejects tenants without a Postgres database reference', () => {
    assert.throws(
      () =>
        resolveTenantDatabaseName(
          createTenant({
            storageReference: null,
          }),
        ),
      /does not have a Postgres database reference/i,
    )
  })
})
