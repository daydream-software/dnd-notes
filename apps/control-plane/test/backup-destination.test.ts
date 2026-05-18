import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseBackupDestination } from '../src/backup-config.js'

describe('parseBackupDestination', () => {
  it('returns "disabled" for undefined', () => {
    assert.equal(parseBackupDestination(undefined), 'disabled')
  })

  it('returns "disabled" for empty string', () => {
    assert.equal(parseBackupDestination(''), 'disabled')
  })

  it('returns "disabled" for explicit "disabled" value', () => {
    assert.equal(parseBackupDestination('disabled'), 'disabled')
  })

  it('returns "azure-blob" for valid azure-blob value', () => {
    assert.equal(parseBackupDestination('azure-blob'), 'azure-blob')
  })

  it('normalises to lowercase', () => {
    assert.equal(parseBackupDestination('Azure-Blob'), 'azure-blob')
    assert.equal(parseBackupDestination('DISABLED'), 'disabled')
  })

  it('trims whitespace before validating', () => {
    assert.equal(parseBackupDestination('  azure-blob  '), 'azure-blob')
  })

  it('throws for an unrecognised non-empty value', () => {
    assert.throws(
      () => parseBackupDestination('s3'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /Invalid BACKUP_DESTINATION value: s3/)
        assert.match(err.message, /Expected "disabled" or "azure-blob"/)
        return true
      },
    )
  })

  it('throws for a value that looks almost right', () => {
    assert.throws(
      () => parseBackupDestination('azure_blob'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /Invalid BACKUP_DESTINATION value/)
        return true
      },
    )
  })
})
