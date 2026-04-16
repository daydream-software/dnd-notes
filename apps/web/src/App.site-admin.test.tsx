import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('shows the site admin panel for site admins', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)

    expect(await screen.findByRole('heading', { name: 'Site admin panel' })).toBeTruthy()
    expect(screen.getByText('Site admins 1')).toBeTruthy()
    expect(screen.getByText('ally@example.com')).toBeTruthy()
    expect(screen.getByText('Owned campaigns 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh admin metrics' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download SQLite backup' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore SQLite backup' })).toBeTruthy()
  })

  it('requires confirmation before restoring a site backup', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await registerOwnerAndLoadWorkspace(user)

    const backupInput = screen.getByLabelText('Select SQLite backup to restore')
    const backupFile = new File(['SQLite format 3\0restore'], 'restore.sqlite', {
      type: 'application/octet-stream',
    })

    await user.upload(backupInput, backupFile)

    expect(confirmSpy).toHaveBeenCalledWith(
      'Restore "restore.sqlite"? This will replace the current SQLite database.',
    )
    expect(appTestContext.countRequests('/api/admin/restore', 'POST')).toBe(0)
  })

  it('restores a site backup from the admin panel', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await registerOwnerAndLoadWorkspace(user)

    const backupInput = screen.getByLabelText('Select SQLite backup to restore')
    const backupFile = new File(['SQLite format 3\0restore'], 'restore.sqlite', {
      type: 'application/octet-stream',
    })

    await user.upload(backupInput, backupFile)

    expect(confirmSpy).toHaveBeenCalled()
    expect(appTestContext.countRequests('/api/admin/restore', 'POST')).toBe(1)
    expect(await screen.findByText('Backup restored successfully.')).toBeTruthy()
  })
})
