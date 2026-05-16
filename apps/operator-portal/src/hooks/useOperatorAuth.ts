import * as React from 'react'
import {
  buildOperatorRedirectUri,
  operatorKeycloakConfig,
  requiredRoles,
} from '../config'
import { extractEffectiveRoles, hasAnyRequiredRole } from '../keycloak-roles'
import {
  clearStoredKeycloakTokens,
  createRuntimeKeycloakClient,
  persistKeycloakTokens,
  readStoredKeycloakTokens,
  type RuntimeKeycloakClient,
} from '../keycloak-client'
import type { OperatorKeycloakConfig } from '../types'

const { useCallback, useEffect, useMemo, useRef, useState } = React

function decodeJwtPayload(token: string) {
  const parts = token.split('.')

  if (parts.length < 2) {
    return null
  }

  try {
    const normalizedPayload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (normalizedPayload.length % 4)) % 4)
    const json = window.atob(`${normalizedPayload}${padding}`)

    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function isAuthorized(token: string): boolean {
  const effectiveRoles = extractEffectiveRoles(token, operatorKeycloakConfig.clientId)
  return hasAnyRequiredRole(effectiveRoles, requiredRoles)
}

function getOperatorActor(authToken: string | null) {
  if (!authToken) {
    return 'operator-portal'
  }

  const payload = decodeJwtPayload(authToken)
  const actorCandidates = [
    payload?.preferred_username,
    payload?.email,
    payload?.name,
    payload?.sub,
  ]

  const actor = actorCandidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0,
  )

  return actor?.trim() ?? 'operator-portal'
}

export interface UseOperatorAuthResult {
  authToken: string | null
  isRoleAuthorized: boolean | null
  isAuthReady: boolean
  authError: string | null
  operatorActor: string
  handleLogin: () => Promise<void>
  handleLogout: () => Promise<void>
  clearSession: () => void
}

export function useOperatorAuth(
  onFleetLoad: (token: string) => Promise<void>,
  onFleetClear: () => void,
  keycloakClientFactory: (config: OperatorKeycloakConfig) => RuntimeKeycloakClient = createRuntimeKeycloakClient,
): UseOperatorAuthResult {
  const keycloakClientRef = useRef<RuntimeKeycloakClient | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [isRoleAuthorized, setIsRoleAuthorized] = useState<boolean | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const clearSession = useCallback(() => {
    clearStoredKeycloakTokens()
    keycloakClientRef.current?.clear()
    setAuthToken(null)
    setIsRoleAuthorized(null)
    setAuthError(null)
    onFleetClear()
  }, [onFleetClear])

  useEffect(() => {
    let cancelled = false
    const keycloakClient = keycloakClientFactory(operatorKeycloakConfig)
    keycloakClientRef.current = keycloakClient

    const bootstrapAuth = async () => {
      try {
        const tokens = await keycloakClient.init(readStoredKeycloakTokens())

        if (cancelled) {
          return
        }

        if (!tokens) {
          clearSession()
          return
        }

        persistKeycloakTokens(tokens)
        setAuthToken(tokens.accessToken)

        const authorized = isAuthorized(tokens.accessToken)
        setIsRoleAuthorized(authorized)

        if (authorized) {
          await onFleetLoad(tokens.accessToken)
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          clearSession()
          setAuthError(
            bootstrapError instanceof Error
              ? bootstrapError.message
              : 'Could not initialize the operator session. Reload and try again.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsAuthReady(true)
        }
      }
    }

    void bootstrapAuth()

    return () => {
      cancelled = true
    }
  }, [clearSession, keycloakClientFactory, onFleetLoad])

  useEffect(() => {
    if (!authToken || !keycloakClientRef.current) {
      return
    }

    let cancelled = false
    const refreshInterval = window.setInterval(() => {
      void keycloakClientRef.current
        ?.refresh(30)
        .then((tokens) => {
          if (cancelled) {
            return
          }

          persistKeycloakTokens(tokens)
          setAuthToken(tokens.accessToken)

          const authorized = isAuthorized(tokens.accessToken)
          setIsRoleAuthorized(authorized)

          if (!authorized) {
            clearSession()
            setAuthError('Your operator access changed. Sign in again.')
            return
          }
        })
        .catch((refreshError) => {
          if (cancelled) {
            return
          }

          clearSession()
          setAuthError(
            refreshError instanceof Error
              ? refreshError.message
              : 'Your session expired. Sign in again.',
          )
        })
    }, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
    }
  }, [authToken, clearSession])

  const handleLogin = useCallback(async () => {
    if (!keycloakClientRef.current) {
      setAuthError('Sign-in is not ready yet. Reload and try again.')
      return
    }

    try {
      await keycloakClientRef.current.login(buildOperatorRedirectUri())
    } catch (loginError) {
      setAuthError(
        loginError instanceof Error
          ? loginError.message
          : 'Could not start the sign-in flow. Reload and try again.',
      )
    }
  }, [])

  const handleLogout = useCallback(async () => {
    const keycloakClient = keycloakClientRef.current
    const redirectUri = buildOperatorRedirectUri()

    clearSession()

    if (!keycloakClient) {
      return
    }

    try {
      await keycloakClient.logout(redirectUri)
    } catch (logoutError) {
      setAuthError(
        logoutError instanceof Error
          ? logoutError.message
          : 'Could not sign out of the operator portal cleanly.',
      )
    }
  }, [clearSession])

  const operatorActor = useMemo(() => getOperatorActor(authToken), [authToken])

  return {
    authToken,
    isRoleAuthorized,
    isAuthReady,
    authError,
    operatorActor,
    handleLogin,
    handleLogout,
    clearSession,
  }
}
