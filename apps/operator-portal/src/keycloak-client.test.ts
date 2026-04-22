import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('keycloak-js', () => ({
  default: class MockKeycloak {},
}))

import { readStoredKeycloakTokens } from './keycloak-client'

const storedTokensKey = 'dnd-notes:operator-portal:keycloak-tokens'

describe('readStoredKeycloakTokens', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it.each([
    ['missing refresh token', { accessToken: 'operator-access-token' }],
    ['non-string access token', { accessToken: 123, refreshToken: 'operator-refresh-token' }],
    ['invalid JSON', '{not-json'],
  ])('clears storage and returns null for %s', (_label, storedValue) => {
    localStorage.setItem(
      storedTokensKey,
      typeof storedValue === 'string' ? storedValue : JSON.stringify(storedValue),
    )

    expect(readStoredKeycloakTokens()).toBeNull()
    expect(localStorage.getItem(storedTokensKey)).toBeNull()
  })

  it('returns normalized stored tokens when the required fields are strings', () => {
    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken: 'operator-access-token',
        refreshToken: 'operator-refresh-token',
        idToken: 42,
      }),
    )

    expect(readStoredKeycloakTokens()).toEqual({
      accessToken: 'operator-access-token',
      refreshToken: 'operator-refresh-token',
    })
  })
})
