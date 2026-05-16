import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from '@dnd-notes/theme'
import JoinPage from './JoinPage'

function renderJoinPage(displayName = '') {
  const onJoinDraftChange = vi.fn()
  const onJoin = vi.fn()

  render(
    <ThemeProvider theme={theme}>
      <JoinPage
        campaignName="Test Campaign"
        joinDraft={{ displayName }}
        isJoining={false}
        error={null}
        onJoinDraftChange={onJoinDraftChange}
        onJoin={onJoin}
      />
    </ThemeProvider>,
  )

  return { onJoinDraftChange, onJoin }
}

function getJoinButton() {
  // MUI disabled buttons still carry role="button"; use the native <button> element.
  // Matches both 'Join campaign' (idle) and 'Joining campaign…' (isJoining=true).
  return screen.getByRole('button', { name: /^Join(ing)? campaign/ }) as HTMLButtonElement
}

describe('JoinPage — join button disabled state', () => {
  afterEach(() => {
    cleanup()
  })

  it('is disabled when display name is empty', () => {
    renderJoinPage('')
    expect(getJoinButton().disabled).toBe(true)
  })

  it('is disabled when display name is whitespace only', () => {
    renderJoinPage('   ')
    expect(getJoinButton().disabled).toBe(true)
  })

  it('is enabled when display name has at least one non-whitespace character', () => {
    renderJoinPage('Mara')
    expect(getJoinButton().disabled).toBe(false)
  })

  it('becomes enabled after the parent updates the draft with a non-whitespace character', async () => {
    const user = userEvent.setup()
    const onJoinDraftChange = vi.fn()

    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <JoinPage
          campaignName="Test Campaign"
          joinDraft={{ displayName: '' }}
          isJoining={false}
          error={null}
          onJoinDraftChange={onJoinDraftChange}
          onJoin={vi.fn()}
        />
      </ThemeProvider>,
    )

    expect(getJoinButton().disabled).toBe(true)

    await user.type(screen.getByLabelText('Display name'), 'R')

    rerender(
      <ThemeProvider theme={theme}>
        <JoinPage
          campaignName="Test Campaign"
          joinDraft={{ displayName: 'R' }}
          isJoining={false}
          error={null}
          onJoinDraftChange={onJoinDraftChange}
          onJoin={vi.fn()}
        />
      </ThemeProvider>,
    )

    expect(getJoinButton().disabled).toBe(false)
  })

  it('is disabled when joining, even with a valid display name', () => {
    render(
      <ThemeProvider theme={theme}>
        <JoinPage
          campaignName="Test Campaign"
          joinDraft={{ displayName: 'Mara' }}
          isJoining={true}
          error={null}
          onJoinDraftChange={vi.fn()}
          onJoin={vi.fn()}
        />
      </ThemeProvider>,
    )
    expect(getJoinButton().disabled).toBe(true)
  })
})
