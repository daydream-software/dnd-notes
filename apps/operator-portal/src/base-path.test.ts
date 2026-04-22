import { describe, expect, it } from 'vitest'

import { normalizeBasePath } from './base-path'

describe('normalizeBasePath', () => {
  it('falls back when unset or blank', () => {
    expect(normalizeBasePath(undefined, '/operator-api')).toBe('/operator-api')
    expect(normalizeBasePath('   ', '/operator-api')).toBe('/operator-api')
  })

  it('preserves the root path', () => {
    expect(normalizeBasePath('/', '/operator-api')).toBe('/')
  })

  it('trims whitespace and removes trailing slashes', () => {
    expect(normalizeBasePath(' /operator-api/// ', '/fallback')).toBe(
      '/operator-api',
    )
  })
})
