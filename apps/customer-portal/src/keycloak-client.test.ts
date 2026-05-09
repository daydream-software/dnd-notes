import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('keycloak-js', () => ({
  default: class MockKeycloak {},
}))

import {
  clearStoredKeycloakTokens,
  persistKeycloakTokens,
  readStoredKeycloakTokens,
} from './keycloak-client'

const storedTokensKey = 'dnd-notes:customer-portal:keycloak-tokens'

describe('readStoredKeycloakTokens', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it.each([
    ['missing refresh token', { accessToken: 'customer-access-token' }],
    ['non-string access token', { accessToken: 123, refreshToken: 'customer-refresh-token' }],
    ['invalid JSON', '{not-json'],
  ])('clears storage and returns null for %s', (_label, storedValue) => {
    sessionStorage.setItem(
      storedTokensKey,
      typeof storedValue === 'string' ? storedValue : JSON.stringify(storedValue),
    )

    expect(readStoredKeycloakTokens()).toBeNull()
    expect(sessionStorage.getItem(storedTokensKey)).toBeNull()
  })

  it('returns normalized stored tokens when the required fields are strings', () => {
    sessionStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken: 'customer-access-token',
        refreshToken: 'customer-refresh-token',
        idToken: 42,
      }),
    )

    expect(readStoredKeycloakTokens()).toEqual({
      accessToken: 'customer-access-token',
      refreshToken: 'customer-refresh-token',
    })
  })

  it('returns null when nothing is stored', () => {
    expect(readStoredKeycloakTokens()).toBeNull()
  })
})

describe('persistKeycloakTokens / clearStoredKeycloakTokens', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('persists tokens to sessionStorage', () => {
    persistKeycloakTokens({
      accessToken: 'customer-access-token',
      refreshToken: 'customer-refresh-token',
      idToken: 'customer-id-token',
    })

    const raw = sessionStorage.getItem(storedTokensKey)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as unknown
    expect(parsed).toEqual({
      accessToken: 'customer-access-token',
      refreshToken: 'customer-refresh-token',
      idToken: 'customer-id-token',
    })
  })

  it('clears tokens from sessionStorage', () => {
    sessionStorage.setItem(storedTokensKey, JSON.stringify({ accessToken: 'a', refreshToken: 'b' }))
    clearStoredKeycloakTokens()
    expect(sessionStorage.getItem(storedTokensKey)).toBeNull()
  })

  it('uses sessionStorage, not localStorage', () => {
    persistKeycloakTokens({
      accessToken: 'customer-access-token',
      refreshToken: 'customer-refresh-token',
    })

    // Should be in sessionStorage, not localStorage.
    expect(sessionStorage.getItem(storedTokensKey)).not.toBeNull()
    expect(localStorage.getItem(storedTokensKey)).toBeNull()
  })
})
