import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  authTokenStorageKey,
  campaign,
  cleanupAppTestHarness,
  getVisibleNotes,
  registerOwnerAndLoadWorkspace,
  renderApp,
  selectedCampaignStorageKey,
  setupAppFetchMock,
} from './app-test-helpers'

describe('App owner auth and bootstrap', () => {
  beforeEach(() => {
    setupAppFetchMock()
  })

  afterEach(() => {
    cleanupAppTestHarness()
  })

  it('renders owner onboarding before authentication', () => {
    renderApp()

    expect(screen.getByLabelText('Owner display name')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create owner account' })).toBeTruthy()
  })

  it('loads the workspace after owner registration', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)

    expect(screen.getByLabelText('Search notes')).toBeTruthy()
    expect(screen.getAllByText('Moonshae Ledger').length).toBeGreaterThan(0)
    expect(getVisibleNotes()).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'New note' }).length).toBeGreaterThan(0)
  })

  it('restores a saved owner session into the selected campaign workspace', async () => {
    localStorage.setItem(authTokenStorageKey, 'smoke-token')
    localStorage.setItem(selectedCampaignStorageKey, campaign.id)

    renderApp()

    await screen.findByText('Storm ledger updated')

    expect(screen.queryByLabelText('Owner display name')).toBeNull()
    expect(screen.getByLabelText('Search notes')).toBeTruthy()
    expect(screen.getAllByText('Moonshae Ledger').length).toBeGreaterThan(0)
    expect(getVisibleNotes()).toHaveLength(2)
  })
})
