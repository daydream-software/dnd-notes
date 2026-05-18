/**
 * Azure Blob Storage implementation of TenantBackupArtifactStore.
 *
 * Auth precedence (evaluated at construction time):
 *   1. SAS token  — pass sasToken to the constructor. The SDK builds a
 *      SAS-authenticated BlobServiceClient from the account name + token.
 *   2. Connection string — pass connectionString. The SDK parses the key.
 *   3. Pre-built BlobServiceClient — pass blobServiceClient directly (test
 *      injection and managed-identity paths).
 *
 * Never include the SAS token or account key in error messages — they are
 * extracted from credentials and must stay out of logs.
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { BlobServiceClient } from '@azure/storage-blob'
import type { TenantBackupArtifactStore } from './tenant-backup-runner.js'
import { TenantBackupValidationError } from './tenant-backup-runner.js'

export { BlobServiceClient }

export interface AzureBlobArtifactStoreOptions {
  /**
   * Azure Storage account name.
   * Required when authenticating via SAS token.
   * Ignored when a pre-built `blobServiceClient` is provided.
   */
  accountName?: string
  /**
   * SAS token for the storage account (starts with '?sv=...' or 'sv=...').
   * When present, takes priority over `connectionString`.
   */
  sasToken?: string
  /**
   * Connection string (AccountName=...;AccountKey=...;...).
   * Used when `sasToken` is absent and `blobServiceClient` is not provided.
   */
  connectionString?: string
  /**
   * Pre-built BlobServiceClient — injected in tests or for managed-identity
   * paths. When provided, accountName / sasToken / connectionString are unused.
   */
  blobServiceClient?: BlobServiceClient
  /**
   * Container name. Defaults to 'tenant-backups'.
   */
  containerName?: string
}

export class AzureBlobConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AzureBlobConfigurationError'
  }
}

export class AzureBlobTenantBackupArtifactStore
  implements TenantBackupArtifactStore
{
  private readonly client: BlobServiceClient
  private readonly containerName: string

  constructor(options: AzureBlobArtifactStoreOptions) {
    this.containerName = options.containerName ?? 'tenant-backups'

    if (options.blobServiceClient) {
      // Injection path — used in tests and managed-identity scenarios.
      this.client = options.blobServiceClient
      return
    }

    if (options.sasToken) {
      // SAS token auth — preferred for test releases.
      if (!options.accountName) {
        throw new AzureBlobConfigurationError(
          'AZURE_STORAGE_ACCOUNT is required when AZURE_STORAGE_SAS_TOKEN is set.',
        )
      }
      const token = options.sasToken.startsWith('?')
        ? options.sasToken
        : `?${options.sasToken}`
      this.client = new BlobServiceClient(
        `https://${options.accountName}.blob.core.windows.net${token}`,
      )
      return
    }

    if (options.connectionString) {
      // Connection string auth — alternative to SAS token.
      this.client = BlobServiceClient.fromConnectionString(
        options.connectionString,
      )
      return
    }

    throw new AzureBlobConfigurationError(
      'Azure Blob artifact store requires either AZURE_STORAGE_SAS_TOKEN or AZURE_STORAGE_CONNECTION_STRING.',
    )
  }

  /**
   * Upload a local pg_dump file to Azure Blob.
   * Blob path: <containerName>/<tenantId>/<timestamp>-<filename>
   * Returns the blob URL as the artifact location.
   */
  async storeBackup(params: {
    tenantId: string
    sourcePath: string
    capturedAt: string
  }): Promise<{ location: string }> {
    const blobName = buildBlobName(params.tenantId, params.sourcePath, params.capturedAt)
    const containerClient = this.client.getContainerClient(this.containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)

    let sourceSize: number
    try {
      const stats = await stat(params.sourcePath)
      sourceSize = stats.size
    } catch (error) {
      throw new TenantBackupValidationError(
        `Backup source file is not readable: ${params.sourcePath}`,
        { cause: error },
      )
    }

    try {
      await blockBlobClient.uploadStream(
        createReadStream(params.sourcePath),
        undefined,
        undefined,
        {
          blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
          metadata: {
            tenantId: params.tenantId,
            capturedAt: params.capturedAt,
          },
          // Report progress during large uploads but don't expose creds.
          onProgress: (progress) => {
            const pct = sourceSize > 0
              ? Math.round((progress.loadedBytes / sourceSize) * 100)
              : 0
            process.stdout.write(`\r[azure-blob] uploading ${blobName}: ${pct}%`)
          },
        },
      )
      if (sourceSize > 0) {
        process.stdout.write('\n')
      }
    } catch (error) {
      throw new AzureBlobUploadError(
        `Failed to upload backup artifact for tenant ${JSON.stringify(params.tenantId)} to Azure Blob.`,
        { cause: sanitizeAzureError(error) },
      )
    }

    return { location: blockBlobClient.url }
  }

  /**
   * Download a blob at `location` (a blob URL) to a local file at
   * `destinationPath`.
   */
  async materializeBackup(params: {
    location: string
    destinationPath: string
  }): Promise<void> {
    const blockBlobClient = this.resolveBlockBlobClient(params.location)
    const destinationDirectory = dirname(params.destinationPath)

    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 })

    try {
      const downloadResponse = await blockBlobClient.download()

      if (!downloadResponse.readableStreamBody) {
        throw new Error('Download response has no readable stream body.')
      }

      const writeStream = createWriteStream(params.destinationPath, { mode: 0o600 })
      await pipeline(downloadResponse.readableStreamBody, writeStream)
    } catch (error) {
      // Clean up partial download on failure.
      await rm(params.destinationPath, { force: true })
      throw new AzureBlobDownloadError(
        `Failed to download backup artifact from Azure Blob location ${JSON.stringify(params.location)}.`,
        { cause: sanitizeAzureError(error) },
      )
    }
  }

  /**
   * List all blobs in the container whose Last-Modified is older than
   * `olderThanDate`. Used by the retention sweep.
   * Returns { name, lastModified } tuples.
   */
  async listBlobsOlderThan(
    olderThanDate: Date,
  ): Promise<Array<{ name: string; lastModified: Date }>> {
    const containerClient = this.client.getContainerClient(this.containerName)
    const stale: Array<{ name: string; lastModified: Date }> = []

    for await (const blob of containerClient.listBlobsFlat({
      includeMetadata: false,
    })) {
      const lastModified = blob.properties.lastModified
      if (lastModified && lastModified < olderThanDate) {
        stale.push({ name: blob.name, lastModified })
      }
    }

    return stale
  }

  /**
   * Delete a blob by name. Used by the retention sweep.
   * Tolerates 404 (already deleted) gracefully.
   */
  async deleteBlob(name: string): Promise<void> {
    const containerClient = this.client.getContainerClient(this.containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(name)

    try {
      await blockBlobClient.deleteIfExists()
    } catch (error) {
      throw new AzureBlobDeleteError(
        `Failed to delete blob ${JSON.stringify(name)} during retention sweep.`,
        { cause: sanitizeAzureError(error) },
      )
    }
  }

  private resolveBlockBlobClient(location: string) {
    // The location is the full blob URL returned by storeBackup.
    // We reconstruct the client from the URL — the SAS token (if any) is
    // embedded in the URL by the Azure SDK at upload time.
    try {
      const url = new URL(location)
      if (!url.hostname.endsWith('.blob.core.windows.net')) {
        throw new TenantBackupValidationError(
          `Unsupported backup location ${JSON.stringify(location)}: expected an Azure Blob URL.`,
        )
      }
    } catch (error) {
      if (error instanceof TenantBackupValidationError) throw error
      throw new TenantBackupValidationError(
        `Unsupported backup location ${JSON.stringify(location)}.`,
      )
    }

    return this.client
      .getContainerClient(this.containerName)
      .getBlockBlobClient(extractBlobNameFromUrl(location))
  }
}

export class AzureBlobUploadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AzureBlobUploadError'
  }
}

export class AzureBlobDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AzureBlobDownloadError'
  }
}

export class AzureBlobDeleteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AzureBlobDeleteError'
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildBlobName(
  tenantId: string,
  sourcePath: string,
  capturedAt: string,
): string {
  // Sanitize the tenant ID to a safe path component.
  const safeId = tenantId.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()
  // ISO timestamp → filesystem-safe (colons and dots are fine in blob names
  // but we normalise for consistency with the FS store convention).
  const safeTs = capturedAt.replace(/[:.]/g, '-')
  // Extract the original filename from the dump path.
  const fileName = sourcePath.split('/').pop() ?? 'backup.dump'
  return `${safeId}/${safeTs}-${fileName}`
}

function extractBlobNameFromUrl(blobUrl: string): string {
  // Azure blob URL format:
  //   https://<account>.blob.core.windows.net/<container>/<blobName>[?sas]
  const url = new URL(blobUrl)
  // pathname starts with "/<container>/<blobName>"
  const pathParts = url.pathname.split('/').filter(Boolean)
  // First segment is the container name, rest is the blob name.
  return pathParts.slice(1).join('/')
}

/**
 * Strip any credential fragments from Azure SDK errors before rethrowing.
 * Azure error messages can include request URLs with SAS tokens embedded.
 */
function sanitizeAzureError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error))
  }

  // Replace any query strings from URLs in the message to avoid leaking SAS tokens.
  const sanitizedMessage = error.message.replace(
    /https?:\/\/[^\s]+\?[^\s]*/g,
    '<azure-url-redacted>',
  )

  const sanitized = new Error(sanitizedMessage)
  sanitized.name = error.name
  sanitized.stack = error.stack
  return sanitized
}

/** Exported for tests only. */
export { buildBlobName, extractBlobNameFromUrl }

export interface TempFileHandle {
  path: string
  cleanup: () => Promise<void>
}

/** Create a temp file path in a new temp dir (caller must clean up). */
export async function createTempFile(prefix: string): Promise<TempFileHandle> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'artifact.dump')
  return {
    path,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  }
}
