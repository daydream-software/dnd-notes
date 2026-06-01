import { cleanup, render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuickCaptureBar from './QuickCaptureBar'

function renderBar({
  value = '',
  onValueChange = vi.fn(),
  onSubmit = vi.fn().mockResolvedValue(undefined),
  isSubmitting = false,
}: Partial<React.ComponentProps<typeof QuickCaptureBar>> = {}) {
  return render(
    <QuickCaptureBar
      value={value}
      onValueChange={onValueChange}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    />,
  )
}

describe('QuickCaptureBar', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  describe('disabled state', () => {
    it('disables the submit button when the input is empty', () => {
      renderBar({ value: '' })

      expect(
        (screen.getByRole('button', { name: 'Capture' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })

    it('disables the submit button when isSubmitting is true', () => {
      renderBar({ value: 'A note', isSubmitting: true })

      expect(
        (screen.getByRole('button', { name: 'Capturing…' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })

    it('enables the submit button when the input has text', () => {
      renderBar({ value: 'A note' })

      expect(
        (screen.getByRole('button', { name: 'Capture' }) as HTMLButtonElement).disabled,
      ).toBe(false)
    })
  })

  describe('submit behaviour', () => {
    it('calls onSubmit when the Capture button is clicked', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      renderBar({ value: 'Quick note', onSubmit })

      await user.click(screen.getByRole('button', { name: 'Capture' }))

      expect(onSubmit).toHaveBeenCalledOnce()
    })

    it('retains focus on the input after a successful submit', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      renderBar({ value: 'Quick note', onSubmit })

      const input = screen.getByRole('textbox', { name: 'Quick capture a note' })
      await user.click(screen.getByRole('button', { name: 'Capture' }))

      await act(async () => {
        await Promise.resolve()
      })

      expect(document.activeElement).toBe(input)
    })

    it('submits when Enter is pressed in the input', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      renderBar({ value: 'Enter note', onSubmit })

      await user.type(
        screen.getByRole('textbox', { name: 'Quick capture a note' }),
        '{Enter}',
      )

      expect(onSubmit).toHaveBeenCalledOnce()
    })

    it('does not enable the submit button when the input is only whitespace', () => {
      renderBar({ value: '   ' })

      expect(
        (screen.getByRole('button', { name: 'Capture' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })
  })

  describe('"Captured" flash', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows the "Captured" status after a successful submit', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      renderBar({ value: 'Quick note', onSubmit })

      await user.click(screen.getByRole('button', { name: 'Capture' }))

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeTruthy()
        expect(screen.getByText('Captured')).toBeTruthy()
      })
    })

    it('clears the "Captured" flash after ~1750ms', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      renderBar({ value: 'Quick note', onSubmit })

      await user.click(screen.getByRole('button', { name: 'Capture' }))

      await waitFor(() => {
        expect(screen.getByText('Captured')).toBeTruthy()
      })

      act(() => {
        vi.advanceTimersByTime(1750)
      })

      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.queryByText('Captured')).toBeNull()
    })
  })

  describe('keyboard shortcuts', () => {
    it('calls onValueChange with empty string when Escape is pressed', async () => {
      const user = userEvent.setup()
      const onValueChange = vi.fn()

      renderBar({ value: 'Draft note', onValueChange })

      await user.type(
        screen.getByRole('textbox', { name: 'Quick capture a note' }),
        '{Escape}',
      )

      expect(onValueChange).toHaveBeenCalledWith('')
    })
  })
})
