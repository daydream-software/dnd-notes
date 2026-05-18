import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import {
  AzureBlobConfigurationError,
  AzureBlobDownloadError,
  AzureBlobTenantBackupArtifactStore,
  AzureBlobUploadError,
  buildBlobName,
  extractBlobNameFromUrl,
  sanitizeAzureError,
} from '../src/tenant-backup-azure-blob.js'
import { TenantBackupValidationError } from '../src/tenant-backup-runner.js'

// ---------------------------------------------------------------------------
// In-memory BlobServiceClient stub
// ---------------------------------------------------------------------------

interface BlobEntry {
  content: Buffer
  lastModified: Date
}

class FakeBlobServiceClient {
  private readonly blobs = new Map<string, BlobEntry>()
  uploadErrors: Map<string, Error> = new Map()
  downloadErrors: Map<string, Error> = new Map()
  deleteErrors: Map<string, Error> = new Map()

  getContainerClient(containerName: string) {
    return new FakeContainerClient(
      containerName,
      this.blobs,
      this.uploadErrors,
      this.downloadErrors,
      this.deleteErrors,
    )
  }

  getBlobEntries(): Map<string, BlobEntry> {
    return this.blobs
  }
}

class FakeContainerClient {
  constructor(
    private readonly containerName: string,
    private readonly blobs: Map<string, BlobEntry>,
    private readonly uploadErrors: Map<string, Error>,
    private readonly downloadErrors: Map<string, Error>,
    private readonly deleteErrors: Map<string, Error>,
  ) {}

  getBlockBlobClient(blobName: string) {
    const key = `${this.containerName}/${blobName}`
    return new FakeBlockBlobClient(
      key,
      blobName,
      this.blobs,
      this.uploadErrors,
      this.downloadErrors,
      this.deleteErrors,
    )
  }

  async *listBlobsFlat() {
    for (const [key, entry] of this.blobs) {
      if (key.startsWith(`${this.containerName}/`)) {
        const name = key.slice(this.containerName.length + 1)
        yield {
          name,
          properties: { lastModified: entry.lastModified },
        }
      }
    }
  }
}

class FakeBlockBlobClient {
  constructor(
    private readonly key: string,
    private readonly blobName: string,
    private readonly blobs: Map<string, BlobEntry>,
    private readonly uploadErrors: Map<string, Error>,
    private readonly downloadErrors: Map<string, Error>,
    private readonly deleteErrors: Map<string, Error>,
  ) {}

  get url() {
    // Simulate Azure blob URL with embedded SAS.
    return `https://testaccount.blob.core.windows.net/${this.key}?sv=2024`
  }

  async uploadStream(stream: Readable): Promise<void> {
    const uploadError = this.uploadErrors.get(this.blobName)
    if (uploadError) throw uploadError

    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    this.blobs.set(this.key, {
      content: Buffer.concat(chunks),
      lastModified: new Date(),
    })
  }

  async download() {
    const downloadError = this.downloadErrors.get(this.blobName)
    if (downloadError) throw downloadError

    const entry = this.blobs.get(this.key)
    if (!entry) {
      throw Object.assign(new Error('BlobNotFound'), { statusCode: 404 })
    }

    return {
      readableStreamBody: Readable.from([entry.content]),
    }
  }

  async deleteIfExists() {
    const deleteError = this.deleteErrors.get(this.blobName)
    if (deleteError) throw deleteError

    this.blobs.delete(this.key)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(
  overrides: {
    fakeClient?: FakeBlobServiceClient
    containerName?: string
    accountName?: string
    sasToken?: string
    connectionString?: string
  } = {},
): { store: AzureBlobTenantBackupArtifactStore; fakeClient: FakeBlobServiceClient } {
  const fakeClient = overrides.fakeClient ?? new FakeBlobServiceClient()
  const store = new AzureBlobTenantBackupArtifactStore({
    blobServiceClient: fakeClient as never,
    containerName: overrides.containerName ?? 'tenant-backups',
  })
  return { store, fakeClient }
}

async function writeTempFile(content: string | Buffer): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'azure-blob-test-'))
  const path = join(dir, 'backup.dump')
  await writeFile(path, content)
  return { path, dir }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AzureBlobTenantBackupArtifactStore', () => {
  describe('constructor', () => {
    it('accepts a pre-built BlobServiceClient', () => {
      const fakeClient = new FakeBlobServiceClient()
      assert.doesNotThrow(() => {
        new AzureBlobTenantBackupArtifactStore({
          blobServiceClient: fakeClient as never,
        })
      })
    })

    it('throws when SAS token is provided without account name', () => {
      assert.throws(
        () =>
          new AzureBlobTenantBackupArtifactStore({
            sasToken: '?sv=2024&sig=abc',
          }),
        (error) =>
          error instanceof AzureBlobConfigurationError &&
          /AZURE_STORAGE_ACCOUNT is required/i.test(error.message),
      )
    })

    it('throws when neither SAS token nor connection string is provided', () => {
      assert.throws(
        () =>
          new AzureBlobTenantBackupArtifactStore({
            accountName: 'myaccount',
          }),
        (error) =>
          error instanceof AzureBlobConfigurationError &&
          /requires either.*SAS_TOKEN.*CONNECTION_STRING/i.test(error.message),
      )
    })
  })

  describe('storeBackup', () => {
    it('uploads a dump file to the correct blob path and returns the blob URL', async () => {
      const { store, fakeClient } = createStore()
      const { path, dir } = await writeTempFile('pg-dump-content')

      try {
        const result = await store.storeBackup({
          tenantId: 'tenant-123',
          sourcePath: path,
          capturedAt: '2026-05-18T03:00:00.000Z',
        })

        assert.ok(
          result.location.startsWith(
            'https://testaccount.blob.core.windows.net/tenant-backups/tenant-123/',
          ),
          `Expected Azure blob URL, got: ${result.location}`,
        )

        // SAS token must be stripped before persisting the URL.
        assert.doesNotMatch(result.location, /[?&]sv=/, 'SAS token must be stripped from stored URL')

        // Verify the blob was actually stored.
        const blobEntries = fakeClient.getBlobEntries()
        const stored = [...blobEntries.values()][0]
        assert.ok(stored, 'Expected a blob entry to be stored')
        assert.equal(stored.content.toString(), 'pg-dump-content')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('blob path contains sanitized tenant ID and timestamp', async () => {
      const { store } = createStore()
      const { path, dir } = await writeTempFile('dump')

      try {
        const result = await store.storeBackup({
          tenantId: 'Tenant/Special:Chars',
          sourcePath: path,
          capturedAt: '2026-05-18T03:00:00.000Z',
        })

        // The blob URL should include the sanitized tenant-id segment.
        assert.match(result.location, /tenant-special-chars/i)
        // The URL should be a valid Azure blob URL.
        assert.match(result.location, /\.blob\.core\.windows\.net/)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('throws AzureBlobUploadError when the Azure API fails', async () => {
      const fakeClient = new FakeBlobServiceClient()
      const blobName = buildBlobName('tenant-123', 'backup.dump', '2026-05-18T03:00:00.000Z')
      fakeClient.uploadErrors.set(blobName, new Error('Azure 503 Service Unavailable'))
      const { store } = createStore({ fakeClient })
      const { path, dir } = await writeTempFile('dump')

      try {
        await assert.rejects(
          () =>
            store.storeBackup({
              tenantId: 'tenant-123',
              sourcePath: path,
              capturedAt: '2026-05-18T03:00:00.000Z',
            }),
          (error) =>
            error instanceof AzureBlobUploadError &&
            /failed to upload/i.test(error.message) &&
            // Must not leak the raw error details directly (SAS token safety).
            !error.message.includes('sv='),
        )
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('throws TenantBackupValidationError when source file is missing', async () => {
      const { store } = createStore()

      await assert.rejects(
        () =>
          store.storeBackup({
            tenantId: 'tenant-123',
            sourcePath: '/does/not/exist/backup.dump',
            capturedAt: '2026-05-18T03:00:00.000Z',
          }),
        (error) => error instanceof TenantBackupValidationError,
      )
    })
  })

  describe('materializeBackup', () => {
    it('downloads a blob and writes it to the destination path', async () => {
      const { store } = createStore()
      const { path: sourcePath, dir: sourceDir } = await writeTempFile('pg-dump-data')
      const destDir = await mkdtemp(join(tmpdir(), 'azure-blob-dest-'))
      const destPath = join(destDir, 'downloaded.dump')

      try {
        const stored = await store.storeBackup({
          tenantId: 'tenant-123',
          sourcePath,
          capturedAt: '2026-05-18T03:00:00.000Z',
        })

        await store.materializeBackup({
          location: stored.location,
          destinationPath: destPath,
        })

        const downloaded = await readFile(destPath)
        assert.equal(downloaded.toString(), 'pg-dump-data')
      } finally {
        await rm(sourceDir, { recursive: true, force: true })
        await rm(destDir, { recursive: true, force: true })
      }
    })

    it('throws AzureBlobDownloadError when download fails', async () => {
      const fakeClient = new FakeBlobServiceClient()
      const { store } = createStore({ fakeClient })
      // Put a blob in so we can try to download it.
      const { path: sourcePath, dir: sourceDir } = await writeTempFile('data')
      const destDir = await mkdtemp(join(tmpdir(), 'azure-blob-dest-'))

      try {
        const stored = await store.storeBackup({
          tenantId: 'tenant-123',
          sourcePath,
          capturedAt: '2026-05-18T03:00:00.000Z',
        })

        // Now inject a download error for this blob name.
        const blobName = buildBlobName('tenant-123', 'backup.dump', '2026-05-18T03:00:00.000Z')
        fakeClient.downloadErrors.set(blobName, new Error('Network reset'))

        await assert.rejects(
          () =>
            store.materializeBackup({
              location: stored.location,
              destinationPath: join(destDir, 'out.dump'),
            }),
          (error) =>
            error instanceof AzureBlobDownloadError &&
            /failed to download/i.test(error.message),
        )
      } finally {
        await rm(sourceDir, { recursive: true, force: true })
        await rm(destDir, { recursive: true, force: true })
      }
    })

    it('throws TenantBackupValidationError for non-Azure locations', async () => {
      const { store } = createStore()
      const destDir = await mkdtemp(join(tmpdir(), 'azure-blob-dest-'))

      try {
        await assert.rejects(
          () =>
            store.materializeBackup({
              location: 'file:///tmp/not-azure.dump',
              destinationPath: join(destDir, 'out.dump'),
            }),
          (error) => error instanceof TenantBackupValidationError,
        )

        await assert.rejects(
          () =>
            store.materializeBackup({
              location: 'https://other-cdn.example.com/backup.dump',
              destinationPath: join(destDir, 'out.dump'),
            }),
          (error) => error instanceof TenantBackupValidationError,
        )
      } finally {
        await rm(destDir, { recursive: true, force: true })
      }
    })
  })

  describe('listBlobsOlderThan', () => {
    it('returns blobs with lastModified before the cutoff date', async () => {
      const fakeClient = new FakeBlobServiceClient()
      const { store } = createStore({ fakeClient })
      const { path: sourcePath, dir } = await writeTempFile('data')

      try {
        await store.storeBackup({
          tenantId: 'tenant-old',
          sourcePath,
          capturedAt: '2026-05-01T00:00:00.000Z',
        })

        // Manually backdate the blob's lastModified.
        const entries = fakeClient.getBlobEntries()
        for (const entry of entries.values()) {
          entry.lastModified = new Date('2026-05-01T00:00:00.000Z')
        }

        const cutoff = new Date('2026-05-15T00:00:00.000Z')
        const stale = await store.listBlobsOlderThan(cutoff)

        assert.equal(stale.length, 1)
        assert.ok(stale[0]?.lastModified < cutoff)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('returns an empty list when all blobs are within retention window', async () => {
      const { store } = createStore()
      const { path: sourcePath, dir } = await writeTempFile('data')

      try {
        await store.storeBackup({
          tenantId: 'tenant-fresh',
          sourcePath,
          capturedAt: '2026-05-18T00:00:00.000Z',
        })

        // Blob was just created — lastModified is "now".
        const cutoff = new Date('2026-05-01T00:00:00.000Z')
        const stale = await store.listBlobsOlderThan(cutoff)

        assert.equal(stale.length, 0)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('deleteBlob', () => {
    it('deletes a blob that exists', async () => {
      const { store, fakeClient } = createStore()
      const { path: sourcePath, dir } = await writeTempFile('data')

      try {
        const stored = await store.storeBackup({
          tenantId: 'tenant-del',
          sourcePath,
          capturedAt: '2026-05-18T03:00:00.000Z',
        })

        assert.equal(fakeClient.getBlobEntries().size, 1)

        const blobName = extractBlobNameFromUrl(stored.location)
        await store.deleteBlob(blobName)

        assert.equal(fakeClient.getBlobEntries().size, 0)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('does not throw when deleting a blob that does not exist', async () => {
      const { store } = createStore()
      // deleteIfExists on fake client is a no-op for missing blobs.
      await assert.doesNotReject(() => store.deleteBlob('tenant-x/nonexistent.dump'))
    })
  })
})

describe('buildBlobName', () => {
  it('produces a path of form <tenant-id>/<timestamp>-<filename>', () => {
    const name = buildBlobName(
      'tenant-abc',
      '/tmp/dnd-notes-tenant-backup-xyz/tenant-abc-2026-05-18.dump',
      '2026-05-18T03:00:00.000Z',
    )
    assert.match(name, /^tenant-abc\//)
    assert.match(name, /tenant-abc-2026-05-18\.dump$/)
  })

  it('sanitizes special characters in the tenant ID segment', () => {
    const name = buildBlobName(
      'Tenant/With:Specials!',
      '/tmp/x.dump',
      '2026-05-18T03:00:00.000Z',
    )
    // The tenant-id segment (before the first /) must not contain raw special chars.
    const tenantSegment = name.split('/')[0] ?? ''
    assert.doesNotMatch(tenantSegment, /[:!]/)
    // The overall blob name contains exactly one slash (tenant-prefix / filename).
    assert.equal(name.split('/').length, 2)
  })
})

describe('extractBlobNameFromUrl', () => {
  it('extracts the blob name from a blob URL without SAS', () => {
    const name = extractBlobNameFromUrl(
      'https://account.blob.core.windows.net/tenant-backups/tenant-abc/2026-05-18.dump',
    )
    assert.equal(name, 'tenant-abc/2026-05-18.dump')
  })

  it('extracts the blob name from a SAS-signed blob URL', () => {
    const name = extractBlobNameFromUrl(
      'https://account.blob.core.windows.net/tenant-backups/tenant-abc/2026-05-18.dump?sv=2024&sig=abc',
    )
    assert.equal(name, 'tenant-abc/2026-05-18.dump')
  })
})

describe('sanitizeAzureError', () => {
  it('redacts SAS query parameters from error message', () => {
    const original = new Error(
      'Upload failed: https://foo.blob.core.windows.net/container/blob?sv=secret&sig=abc123',
    )
    const sanitized = sanitizeAzureError(original)
    assert.doesNotMatch(sanitized.message, /sv=secret/)
    assert.match(sanitized.message, /<azure-url-redacted>/)
  })

  it('redacts SAS query parameters from error stack', () => {
    const original = new Error('Upload failed')
    // Embed a SAS URL in the stack to simulate what Node appends.
    original.stack =
      'Error: Upload failed\n' +
      '    at https://foo.blob.core.windows.net/x?sv=secret&sig=abc at line 1\n' +
      '    at Object.<anonymous> (/app/src/tenant-backup-azure-blob.ts:42:5)'
    const sanitized = sanitizeAzureError(original)
    assert.ok(sanitized.stack !== undefined)
    assert.doesNotMatch(sanitized.stack ?? '', /[?&]sv=/)
    assert.match(sanitized.stack ?? '', /<azure-url-redacted>/)
  })

  it('preserves error name', () => {
    const original = new Error('some message')
    original.name = 'StorageError'
    const sanitized = sanitizeAzureError(original)
    assert.equal(sanitized.name, 'StorageError')
  })

  it('wraps non-Error values', () => {
    const sanitized = sanitizeAzureError('plain string error')
    assert.ok(sanitized instanceof Error)
    assert.equal(sanitized.message, 'plain string error')
  })
})
