import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatUnknownError,
  normalizeUnknownError,
} from '../src/error-formatting.js'

describe('error formatting', () => {
  it('trims non-empty string errors', () => {
    assert.equal(formatUnknownError('  spaced failure  '), 'spaced failure')
  })

  it('falls back for blank string errors', () => {
    assert.equal(formatUnknownError('   '), 'Unknown error')
    assert.equal(
      normalizeUnknownError('   ', 'Tenant registry operation failed').message,
      'Tenant registry operation failed: Unknown error',
    )
  })
})
