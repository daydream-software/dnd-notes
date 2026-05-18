/**
 * Parse and validate backup-related environment variables.
 * Extracted from index.ts so these helpers can be imported in tests
 * without triggering module-level startup side effects.
 */

/**
 * Parse and validate the BACKUP_DESTINATION env var.
 *
 * @throws if the value is non-empty and not a recognised destination.
 */
export function parseBackupDestination(
  raw: string | undefined,
): 'disabled' | 'azure-blob' {
  const trimmed = raw?.trim()
  const value = (trimmed != null && trimmed.length > 0 ? trimmed : 'disabled').toLowerCase()
  if (value !== 'disabled' && value !== 'azure-blob') {
    throw new Error(
      `Invalid BACKUP_DESTINATION value: ${value}. Expected "disabled" or "azure-blob".`,
    )
  }
  return value
}
