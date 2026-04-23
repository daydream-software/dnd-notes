import { describe, expect, it } from 'vitest'

import { normalizeBasePath } from './base-path'

describe('normalizeBasePath', () => {
  it('falls back when unset or blank', () => {
    expect(normalizeBasePath(undefined, '/portal-api')).toBe('/portal-api')
    expect(normalizeBasePath('   ', '/portal-api')).toBe('/portal-api')
  })

  it('preserves the root path', () => {
    expect(normalizeBasePath('/', '/portal-api')).toBe('/')
  })

  it('trims whitespace and removes trailing slashes', () => {
    expect(normalizeBasePath(' /portal-api/// ', '/fallback')).toBe(
      '/portal-api',
    )
  })
})
