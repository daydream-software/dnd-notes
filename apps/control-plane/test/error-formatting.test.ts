import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatUnknownError,
  normalizeUnknownError,
} from '../src/error-formatting.js'

describe('formatUnknownError', () => {
  it('trims string errors before returning them', () => {
    assert.equal(formatUnknownError('  synthetic failure  '), 'synthetic failure')
  })

  it('falls back to Unknown error for blank string errors', () => {
    assert.equal(formatUnknownError('   '), 'Unknown error')
    assert.equal(
      normalizeUnknownError('   ', 'Tenant registry operation failed').message,
      'Tenant registry operation failed: Unknown error',
    )
  })
})
