import * as React from 'react'
import {
  ApiError,
  abortFleetRollout,
  fetchFleetRollout,
  startFleetRollout,
  type AbortFleetRolloutRequest,
  type StartFleetRolloutRequest,
} from '../control-plane-api'
import type { AbortFleetRolloutResponse, FleetRollout, StartFleetRolloutResponse } from '../types'

const { useCallback, useEffect, useRef, useState } = React

// Polling cadence constants
const POLL_INTERVAL_RUNNING_MS = 2500
const POLL_INTERVAL_IDLE_MS = 10_000

export interface UseFleetRolloutResult {
  rollout: FleetRollout | null
  isPolling: boolean
  isStarting: boolean
  isAborting: boolean
  error: string | null
  /** Set when the backend reports 501 — provisioning not configured. */
  provisioningNotConfigured: boolean
  startRollout: (params: Omit<StartFleetRolloutRequest, never>) => Promise<StartFleetRolloutResponse>
  abortRollout: (params?: AbortFleetRolloutRequest) => Promise<AbortFleetRolloutResponse>
}

export function useFleetRollout(authToken: string | null): UseFleetRolloutResult {
  const [rollout, setRollout] = useState<FleetRollout | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isAborting, setIsAborting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provisioningNotConfigured, setProvisioningNotConfigured] = useState(false)

  // Stable ref for the auth token so the poll loop doesn't need to restart
  // when Keycloak refreshes the access token (which happens every 15s).
  const authTokenRef = useRef<string | null>(authToken)
  useEffect(() => {
    authTokenRef.current = authToken
  }, [authToken])

  // Poll loop — uses recursive setTimeout so the interval can vary depending
  // on whether a rollout is currently running.
  useEffect(() => {
    if (!authToken) {
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (cancelled) {
        return
      }

      const token = authTokenRef.current
      if (!token) {
        timeoutId = setTimeout(tick, POLL_INTERVAL_IDLE_MS)
        return
      }

      setIsPolling(true)

      try {
        const next = await fetchFleetRollout(token)

        if (cancelled) {
          return
        }

        setRollout(next)
        setError(null)
        setProvisioningNotConfigured(false)

        const delay = next?.status === 'running' ? POLL_INTERVAL_RUNNING_MS : POLL_INTERVAL_IDLE_MS
        timeoutId = setTimeout(tick, delay)
      } catch (fetchError) {
        if (cancelled) {
          return
        }

        if (fetchError instanceof ApiError && fetchError.statusCode === 501) {
          setProvisioningNotConfigured(true)
          setError(null)
          // No point continuing to poll — the configuration won't change at runtime.
          return
        }

        const message =
          fetchError instanceof Error ? fetchError.message : 'Could not load fleet rollout status.'
        setError(message)

        // Back off and retry
        timeoutId = setTimeout(tick, POLL_INTERVAL_IDLE_MS)
      } finally {
        if (!cancelled) {
          setIsPolling(false)
        }
      }
    }

    void tick()

    return () => {
      cancelled = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
    // Only restart when authToken goes from null → present (initial login).
    // Token refreshes are handled transparently via authTokenRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken != null])

  const startRollout = useCallback(
    async (params: StartFleetRolloutRequest): Promise<StartFleetRolloutResponse> => {
      const token = authTokenRef.current
      if (!token) {
        throw new Error('Not authenticated.')
      }

      setIsStarting(true)
      setError(null)

      try {
        const response = await startFleetRollout(token, params)
        // Immediately fetch the rollout so the UI transitions to running state
        // without waiting for the next poll tick.
        const next = await fetchFleetRollout(token)
        setRollout(next)
        return response
      } catch (startError) {
        if (startError instanceof ApiError && startError.statusCode === 409) {
          // A rollout is already running — refetch and let the running UI take over.
          const next = await fetchFleetRollout(token)
          setRollout(next)
          // Re-throw so the caller knows it was a conflict, not a clean start.
          throw startError
        }

        if (startError instanceof ApiError && startError.statusCode === 501) {
          setProvisioningNotConfigured(true)
          throw startError
        }

        const message =
          startError instanceof Error ? startError.message : 'Could not start fleet rollout.'
        setError(message)
        throw startError
      } finally {
        setIsStarting(false)
      }
    },
    [],
  )

  const abortRollout = useCallback(
    async (params: AbortFleetRolloutRequest = {}): Promise<AbortFleetRolloutResponse> => {
      const token = authTokenRef.current
      if (!token) {
        throw new Error('Not authenticated.')
      }

      if (!rollout) {
        throw new Error('No active rollout to abort.')
      }

      setIsAborting(true)
      setError(null)

      try {
        const response = await abortFleetRollout(token, rollout.id, params)
        // Immediately refetch to pick up the aborted status.
        const next = await fetchFleetRollout(token)
        setRollout(next)
        return response
      } catch (abortError) {
        const message =
          abortError instanceof Error ? abortError.message : 'Could not abort fleet rollout.'
        setError(message)
        throw abortError
      } finally {
        setIsAborting(false)
      }
    },
    [rollout],
  )

  return {
    rollout,
    isPolling,
    isStarting,
    isAborting,
    error,
    provisioningNotConfigured,
    startRollout,
    abortRollout,
  }
}
