import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl } from './api-base-url'

describe('resolveApiBaseUrl', () => {
  it('keeps explicit API origins trimmed', () => {
    expect(resolveApiBaseUrl(' https://api.example.com/// ', false)).toBe(
      'https://api.example.com',
    )
  })

  it('keeps the dev split-origin fallback when unset', () => {
    expect(resolveApiBaseUrl(undefined, true)).toBe('http://localhost:3001')
    expect(resolveApiBaseUrl('   ', true)).toBe('http://localhost:3001')
  })

  it('falls back to same-origin paths in production builds', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('')
    expect(resolveApiBaseUrl('   ', false)).toBe('')
  })
})
