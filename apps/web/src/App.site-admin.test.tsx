import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupAppTestHarness,
  registerOwnerAndLoadWorkspace,
  setupAppFetchMock,
  siteAdminOwner,
} from './app-test-helpers'

describe('App site admin flows', () => {
  let appTestContext: ReturnType<typeof setupAppFetchMock>

  beforeEach(() => {
    appTestContext = setupAppFetchMock()
    appTestContext.setActiveOwner(siteAdminOwner)
  })

  afterEach(() => {
    cleanupAppTestHarness()
  })

  it('shows the site admin panel for site admins without backup controls', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)

    expect(await screen.findByRole('heading', { name: 'Site admin panel' })).toBeTruthy()
    expect(screen.getByText('Site admins 1')).toBeTruthy()
    expect(screen.getByText('ally@example.com')).toBeTruthy()
    expect(screen.getByText('Owned campaigns 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh admin metrics' })).toBeTruthy()
    expect(screen.queryByText(/backup/i)).toBeNull()
    expect(screen.queryByText(/restore/i)).toBeNull()
  })
})
