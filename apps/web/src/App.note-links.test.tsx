import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./keycloak-client', () => ({
  createRuntimeKeycloakClient: () => ({
    init: async (stored: { accessToken: string; refreshToken: string } | null) => stored,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: async () => {
      const raw = localStorage.getItem('dnd-notes:keycloak-auth-tokens')
      return raw ? JSON.parse(raw) : null
    },
    clear: vi.fn(),
  }),
  isKeycloakAuthConfig: (authConfig: { keycloak?: { url?: string; realm?: string; clientId?: string } } | null) => {
    const kc = authConfig?.keycloak
    return (
      typeof kc?.url === 'string' && kc.url.length > 0 &&
      typeof kc?.realm === 'string' && kc.realm.length > 0 &&
      typeof kc?.clientId === 'string' && kc.clientId.length > 0
    )
  },
}))

import {
  cleanupAppTestHarness,
  renderOwnerAndLoadWorkspace,
  setupAppFetchMock,
} from './app-test-helpers'

describe('App note relationship flows', () => {
  beforeEach(() => {
    setupAppFetchMock()
  })

  afterEach(() => {
    cleanupAppTestHarness()
  })

  it('shows inline body references in the backlinks panel', async () => {
    const user = userEvent.setup()

    await renderOwnerAndLoadWorkspace()
    const stormLedgerHeading = within(
      screen.getByRole('list', { name: 'Notes list' }),
    ).getByText('Storm ledger updated')
    const stormLedgerButton = stormLedgerHeading.closest('[role="button"]')

    expect(stormLedgerButton).toBeTruthy()
    await user.click(stormLedgerButton!)

    expect(screen.getByText('Referenced by (1)')).toBeTruthy()
    expect(
      screen.getByText('Vault sigils mapped searching for Storm ledger updated'),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Linked notes')).toBeNull()
  })

  it('shows inline link qualifiers in the linked notes panel', async () => {
    const user = userEvent.setup()

    await renderOwnerAndLoadWorkspace()
    const vaultSigilsHeading = within(
      screen.getByRole('list', { name: 'Notes list' }),
    ).getByText('Vault sigils mapped')
    const vaultSigilsButton = vaultSigilsHeading.closest('[role="button"]')

    expect(vaultSigilsButton).toBeTruthy()
    await user.click(vaultSigilsButton!)

    expect(screen.getByText('Linked notes (1)')).toBeTruthy()
    expect(
      screen.getByText('Vault sigils mapped searching for Storm ledger updated'),
    ).toBeTruthy()
  })

  it('keeps the followed linked note selected while search is active', async () => {
    const user = userEvent.setup()

    await renderOwnerAndLoadWorkspace()
    await user.type(screen.getByLabelText('Search notes'), 'vault')

    await user.click(
      within(screen.getByRole('list', { name: 'Notes list' })).getByText('Vault sigils mapped'),
    )

    const linkedRelationship = screen.getByText(
      'Vault sigils mapped searching for Storm ledger updated',
    )
    const linkedNoteCard = linkedRelationship.closest('.MuiCard-root')

    expect(linkedNoteCard).toBeTruthy()
    await user.click(linkedNoteCard!)

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Storm ledger updated',
    )
  })

  it('keeps the followed linked note selected while tag filters are active', async () => {
    const user = userEvent.setup()

    await renderOwnerAndLoadWorkspace()
    await user.type(screen.getByLabelText('Search notes'), 'vault')
    await user.click(screen.getAllByRole('button', { name: /sigils/ })[0])
    await user.click(
      within(screen.getByRole('list', { name: 'Notes list' })).getByText('Vault sigils mapped'),
    )

    const linkedRelationship = screen.getByText(
      'Vault sigils mapped searching for Storm ledger updated',
    )
    const linkedNoteCard = linkedRelationship.closest('.MuiCard-root')

    expect(linkedNoteCard).toBeTruthy()
    await user.click(linkedNoteCard!)

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Storm ledger updated',
    )
  })
})
