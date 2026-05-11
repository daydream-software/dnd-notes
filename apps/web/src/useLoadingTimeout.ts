import { useEffect, useRef, useState } from 'react'

/**
 * Returns true when `loading` has been true for longer than `delayMs`.
 * Resets to false as soon as `loading` becomes false.
 *
 * Use this to show a slow-connection fallback message without replacing
 * the skeleton — surface the alert below the skeleton after the delay.
 */
export function useLoadingTimeout(loading: boolean, delayMs = 8000): boolean {
  const [timedOut, setTimedOut] = useState(false)
  // Track whether the timeout fired so we can clear it correctly.
  const timedOutRef = useRef(false)

  // Effect 1: start / clear the timer when loading changes.
  useEffect(() => {
    if (!loading) {
      return
    }

    const id = setTimeout(() => {
      timedOutRef.current = true
      setTimedOut(true)
    }, delayMs)

    return () => {
      clearTimeout(id)
    }
  }, [loading, delayMs])

  // Effect 2: reset the flag once loading is done, but only if the
  // timeout had already fired (avoids an unnecessary render on every fast load).
  useEffect(() => {
    if (!loading && timedOutRef.current) {
      timedOutRef.current = false
      setTimedOut(false)
    }
  }, [loading])

  return timedOut
}
