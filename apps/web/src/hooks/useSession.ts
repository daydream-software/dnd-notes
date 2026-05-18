import { useCallback, useRef, useState } from 'react'
import {
  fetchAuthConfig,
  fetchOwnerSession,
} from '../api'
import {
  createRuntimeKeycloakClient,
  isKeycloakAuthConfig,
  type RuntimeKeycloakClient,
  type StoredKeycloakTokens,
} from '../keycloak-client'
import type { AuthConfigResponse, OwnerAccount } from '../types'

export const authTokenStorageKey = 'dnd-notes:owner-auth-token'
export const keycloakTokensStorageKey = 'dnd-notes:keycloak-auth-tokens'
export const missingKeycloakClientErrorMessage =
  'Sign-in is not ready yet. Reload and try again.'

export function readStoredKeycloakTokens(): StoredKeycloakTokens | null {
  const rawTokens = localStorage.getItem(keycloakTokensStorageKey)

  if (!rawTokens) {
    return null
  }

  try {
    const parsed = JSON.parse(rawTokens) as Partial<StoredKeycloakTokens>

    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string'
    ) {
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      ...(typeof parsed.idToken === 'string' ? { idToken: parsed.idToken } : {}),
    }
  } catch {
    return null
  }
}

export function persistKeycloakTokens(tokens: StoredKeycloakTokens): void {
  localStorage.setItem(keycloakTokensStorageKey, JSON.stringify(tokens))
  localStorage.setItem(authTokenStorageKey, tokens.accessToken)
}

export function clearStoredKeycloakTokens(): void {
  localStorage.removeItem(keycloakTokensStorageKey)
}

export interface UseSessionResult {
  authToken: string | null
  owner: OwnerAccount | null
  authConfig: AuthConfigResponse | null
  isAuthReady: boolean
  isSubmittingAuth: boolean
  isLinkingAccount: boolean
  accountNotice: string | null
  keycloakClientRef: React.RefObject<RuntimeKeycloakClient | null>
  setAuthToken: React.Dispatch<React.SetStateAction<string | null>>
  setOwner: React.Dispatch<React.SetStateAction<OwnerAccount | null>>
  setAuthConfig: React.Dispatch<React.SetStateAction<AuthConfigResponse | null>>
  setIsAuthReady: React.Dispatch<React.SetStateAction<boolean>>
  setIsSubmittingAuth: React.Dispatch<React.SetStateAction<boolean>>
  setIsLinkingAccount: React.Dispatch<React.SetStateAction<boolean>>
  setAccountNotice: React.Dispatch<React.SetStateAction<string | null>>
  resetSession: () => void
  completeAuthentication: (
    token: string,
    nextOwner: OwnerAccount,
    onCampaignsReady: (token: string) => Promise<void>,
  ) => Promise<void>
  bootstrapAuth: (
    isSharedMode: boolean,
    isCancelled: () => boolean,
    loadCampaigns: (token: string) => Promise<void>,
    clearSession: () => void,
    onError: (message: string) => void,
  ) => Promise<void>
  startKeycloakRefresh: (
    clearSession: () => void,
    onError: (message: string) => void,
  ) => (() => void) | undefined
  handleSubmitAuth: (
    onCampaignsReady: (token: string) => Promise<void>,
    onError: (message: string) => void,
  ) => Promise<void>
  handleLogout: (
    isSharedMode: boolean,
    guestStorageKey: string | null,
    onClearSession: () => void,
  ) => Promise<void>
  handleFetchOwnerSession: (token: string) => Promise<OwnerAccount>
}

export function useSession(): UseSessionResult {
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [owner, setOwner] = useState<OwnerAccount | null>(null)
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [isLinkingAccount, setIsLinkingAccount] = useState(false)
  const [accountNotice, setAccountNotice] = useState<string | null>(null)
  const keycloakClientRef = useRef<RuntimeKeycloakClient | null>(null)

  const resetSession = useCallback(() => {
    localStorage.removeItem(authTokenStorageKey)
    clearStoredKeycloakTokens()
    keycloakClientRef.current?.clear()
    keycloakClientRef.current = null
    setAuthToken(null)
    setOwner(null)
  }, [keycloakClientRef])

  const completeAuthentication = useCallback(
    async (
      token: string,
      nextOwner: OwnerAccount,
      onCampaignsReady: (token: string) => Promise<void>,
    ): Promise<void> => {
      await onCampaignsReady(token)
      localStorage.setItem(authTokenStorageKey, token)
      setAuthToken(token)
      setOwner(nextOwner)
    },
    [],
  )

  const handleSubmitAuth = useCallback(
    async (
      _onCampaignsReady: (token: string) => Promise<void>,
      onError: (message: string) => void,
    ): Promise<void> => {
      setIsSubmittingAuth(true)

      try {
        if (isKeycloakAuthConfig(authConfig)) {
          const keycloakClient = keycloakClientRef.current

          if (!keycloakClient) {
            throw new Error(missingKeycloakClientErrorMessage)
          }

          await keycloakClient.login(window.location.href)
          return
        }
      } catch (authError) {
        onError(
          authError instanceof Error
            ? authError.message
            : 'Could not complete owner authentication.',
        )
      } finally {
        setIsSubmittingAuth(false)
        setIsAuthReady(true)
      }
    },
    [authConfig],
  )

  const handleLogout = useCallback(
    async (
      isSharedMode: boolean,
      guestStorageKey: string | null,
      onClearSession: () => void,
    ): Promise<void> => {
      const keycloakClient = keycloakClientRef.current

      if (isKeycloakAuthConfig(authConfig) && keycloakClient) {
        onClearSession()
        await keycloakClient.logout(`${window.location.origin}/`)
        return
      }

      if (isSharedMode) {
        localStorage.removeItem(authTokenStorageKey)
        localStorage.removeItem('dnd-notes:selected-campaign-id')
        if (guestStorageKey) {
          localStorage.removeItem(guestStorageKey)
        }
        window.location.assign('/')
        return
      }

      onClearSession()
    },
    [authConfig],
  )

  const handleFetchOwnerSession = useCallback(
    async (token: string): Promise<OwnerAccount> => {
      const session = await fetchOwnerSession(token)
      return session.owner
    },
    [],
  )

  const bootstrapAuth = useCallback(
    async (
      isSharedMode: boolean,
      isCancelled: () => boolean,
      loadCampaigns: (token: string) => Promise<void>,
      clearSession: () => void,
      onError: (message: string) => void,
    ): Promise<void> => {
      try {
        const nextAuthConfig = await fetchAuthConfig()

        if (isCancelled()) {
          return
        }

        setAuthConfig(nextAuthConfig)

        if (isKeycloakAuthConfig(nextAuthConfig)) {
          const keycloakClient = createRuntimeKeycloakClient(nextAuthConfig.keycloak)
          keycloakClientRef.current = keycloakClient
          const tokens = await keycloakClient.init(readStoredKeycloakTokens())

          if (isCancelled()) {
            return
          }

          if (!tokens) {
            clearStoredKeycloakTokens()
            localStorage.removeItem(authTokenStorageKey)
            setAuthToken(null)
            setOwner(null)
            return
          }

          persistKeycloakTokens(tokens)
          const session = await fetchOwnerSession(tokens.accessToken)

          if (isCancelled()) {
            return
          }

          setAuthToken(tokens.accessToken)
          setOwner(session.owner)

          if (!isSharedMode) {
            await loadCampaigns(tokens.accessToken)
          }
        }
      } catch (bootstrapError) {
        if (!isCancelled()) {
          clearSession()
          console.error(bootstrapError)
          onError('Could not initialize your session. Reload and try again.')
        }
      } finally {
        if (!isCancelled()) {
          setIsAuthReady(true)
        }
      }
    },
    [keycloakClientRef, setAuthConfig, setAuthToken, setIsAuthReady, setOwner],
  )

  const startKeycloakRefresh = useCallback(
    (
      clearSession: () => void,
      onError: (message: string) => void,
    ): (() => void) | undefined => {
      if (!isKeycloakAuthConfig(authConfig) || !authToken || !keycloakClientRef.current) {
        return undefined
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
          })
          .catch((refreshError) => {
            if (cancelled) {
              return
            }

            clearSession()
            console.error(refreshError)
            onError('Your session expired. Sign in again.')
          })
      }, 15_000)

      return () => {
        cancelled = true
        window.clearInterval(refreshInterval)
      }
    },
    [authConfig, authToken, keycloakClientRef, setAuthToken],
  )

  return {
    authToken,
    owner,
    authConfig,
    isAuthReady,
    isSubmittingAuth,
    isLinkingAccount,
    accountNotice,
    keycloakClientRef,
    setAuthToken,
    setOwner,
    setAuthConfig,
    setIsAuthReady,
    setIsSubmittingAuth,
    setIsLinkingAccount,
    setAccountNotice,
    resetSession,
    completeAuthentication,
    bootstrapAuth,
    startKeycloakRefresh,
    handleSubmitAuth,
    handleLogout,
    handleFetchOwnerSession,
  }
}
