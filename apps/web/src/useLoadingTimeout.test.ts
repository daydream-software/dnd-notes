import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLoadingTimeout } from './useLoadingTimeout'

describe('useLoadingTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false immediately when loading is true', () => {
    const { result } = renderHook(() => useLoadingTimeout(true, 8000))
    expect(result.current).toBe(false)
  })

  it('returns false when loading is false', () => {
    const { result } = renderHook(() => useLoadingTimeout(false, 8000))
    expect(result.current).toBe(false)
  })

  it('returns false before the delay elapses', () => {
    const { result } = renderHook(() => useLoadingTimeout(true, 8000))
    act(() => {
      vi.advanceTimersByTime(7999)
    })
    expect(result.current).toBe(false)
  })

  it('returns true once the delay elapses', () => {
    const { result } = renderHook(() => useLoadingTimeout(true, 8000))
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(result.current).toBe(true)
  })

  it('resets to false when loading becomes false after timeout', () => {
    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) => useLoadingTimeout(loading, 8000),
      { initialProps: { loading: true } },
    )
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(result.current).toBe(true)

    rerender({ loading: false })
    expect(result.current).toBe(false)
  })

  it('uses the default delay of 8000ms when no delay is specified', () => {
    const { result } = renderHook(() => useLoadingTimeout(true))
    act(() => {
      vi.advanceTimersByTime(7999)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('respects a custom delay', () => {
    const { result } = renderHook(() => useLoadingTimeout(true, 3000))
    act(() => {
      vi.advanceTimersByTime(2999)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })
})
