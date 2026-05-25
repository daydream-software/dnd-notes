/**
 * Tiny framework-agnostic store tracking whether the API layer is currently
 * retrying a request against a sleeping/maintenance tenant (see api-fetch.ts).
 *
 * The retry loop lives in the API layer (plain async functions), but the
 * "reconnecting" feedback lives in the React tree. This store bridges the two:
 * apiFetch calls beginWakeRetry/endWakeRetry around a retry sequence, and the
 * UI subscribes via useWakeRetryActive().
 *
 * A counter (not a boolean) so concurrent in-flight requests that are all
 * waiting on a wake keep the indicator up until the last one resolves.
 */

import { useSyncExternalStore } from 'react'

let activeCount = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Mark the start of a retry sequence. Shows the indicator on the 0 -> 1 edge. */
export function beginWakeRetry(): void {
  activeCount += 1
  if (activeCount === 1) {
    emit()
  }
}

/** Mark the end of a retry sequence. Hides the indicator on the 1 -> 0 edge. */
export function endWakeRetry(): void {
  if (activeCount === 0) {
    return
  }
  activeCount -= 1
  if (activeCount === 0) {
    emit()
  }
}

export function isWakeRetryActive(): boolean {
  return activeCount > 0
}

export function subscribeWakeRetry(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React hook: true while any API request is retrying against a waking tenant. */
export function useWakeRetryActive(): boolean {
  return useSyncExternalStore(subscribeWakeRetry, isWakeRetryActive, isWakeRetryActive)
}

// Reset module state on hot-module replacement so a retry that was in flight
// when the module reloaded does not leave the indicator stuck visible in dev.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeCount = 0
    listeners.clear()
  })
}
