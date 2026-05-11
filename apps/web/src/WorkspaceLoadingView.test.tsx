import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from '@dnd-notes/theme'
import { WorkspaceLoadingView } from './WorkspaceLoadingView'

function renderView(props: {
  loading: boolean
  onRetry: () => void
  timeoutMs?: number
}) {
  return render(
    <ThemeProvider theme={theme}>
      <WorkspaceLoadingView {...props} />
    </ThemeProvider>,
  )
}

describe('WorkspaceLoadingView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders skeleton placeholders on cold-load', () => {
    renderView({ loading: true, onRetry: vi.fn() })
    // MUI Skeleton components should be present
    const skeletons = document.querySelectorAll('.MuiSkeleton-root')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('does not show the timeout alert before the delay elapses', () => {
    renderView({ loading: true, onRetry: vi.fn(), timeoutMs: 8000 })
    act(() => {
      vi.advanceTimersByTime(7999)
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.queryByText(/loading is taking longer than usual/i),
    ).toBeNull()
  })

  it('shows the timeout alert after the configured delay', () => {
    renderView({ loading: true, onRetry: vi.fn(), timeoutMs: 8000 })
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(
      screen.getByText(/loading is taking longer than usual/i),
    ).toBeTruthy()
  })

  it('renders a retry button inside the timeout alert', () => {
    renderView({ loading: true, onRetry: vi.fn(), timeoutMs: 8000 })
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn()
    renderView({ loading: true, onRetry, timeoutMs: 500 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('hides the timeout alert once loading becomes false', () => {
    const { rerender } = renderView({
      loading: true,
      onRetry: vi.fn(),
      timeoutMs: 500,
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(
      screen.getByText(/loading is taking longer than usual/i),
    ).toBeTruthy()

    rerender(
      <ThemeProvider theme={theme}>
        <WorkspaceLoadingView loading={false} onRetry={vi.fn()} timeoutMs={500} />
      </ThemeProvider>,
    )
    expect(
      screen.queryByText(/loading is taking longer than usual/i),
    ).toBeNull()
  })
})
