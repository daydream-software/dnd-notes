import { describe, expect, it } from 'vitest'

import { joinBasePath, normalizeBasePath } from './base-path'

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

describe('joinBasePath', () => {
  it('keeps root-mounted APIs same-origin', () => {
    expect(joinBasePath('/', '/portal/catalog')).toBe('/portal/catalog')
  })

  it('prefixes non-root base paths without double slashes', () => {
    expect(joinBasePath('/portal-api', '/portal/catalog')).toBe(
      '/portal-api/portal/catalog',
    )
  })
})
