import { useCallback, useRef, useState } from 'react'
import {
  fetchAuthConfig,
  fetchOwnerSession,
  loginOwner,
  logoutOwner,
  registerOwner,
} from '../api'
import {
  createRuntimeKeycloakClient,
  isKeycloakAuthConfig,
  type RuntimeKeycloakClient,
  type StoredKeycloakTokens,
} from '../keycloak-client'
import type { AuthConfigResponse, OwnerAccount } from '../types'

export interface OwnerRegistrationDraft {
  displayName: string
  email: string
  password: string
}

export interface OwnerLoginDraft {
  email: string
  password: string
}

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
  isRegisterMode: boolean
  registerDraft: OwnerRegistrationDraft
  loginDraft: OwnerLoginDraft
  isSubmittingAuth: boolean
  isLinkingAccount: boolean
  accountNotice: string | null
  keycloakClientRef: React.RefObject<RuntimeKeycloakClient | null>
  setAuthToken: React.Dispatch<React.SetStateAction<string | null>>
  setOwner: React.Dispatch<React.SetStateAction<OwnerAccount | null>>
  setAuthConfig: React.Dispatch<React.SetStateAction<AuthConfigResponse | null>>
  setIsAuthReady: React.Dispatch<React.SetStateAction<boolean>>
  setIsRegisterMode: React.Dispatch<React.SetStateAction<boolean>>
  setRegisterDraft: React.Dispatch<React.SetStateAction<OwnerRegistrationDraft>>
  setLoginDraft: React.Dispatch<React.SetStateAction<OwnerLoginDraft>>
  setIsSubmittingAuth: React.Dispatch<React.SetStateAction<boolean>>
  setIsLinkingAccount: React.Dispatch<React.SetStateAction<boolean>>
  setAccountNotice: React.Dispatch<React.SetStateAction<string | null>>
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
  const [isRegisterMode, setIsRegisterMode] = useState(true)
  const [registerDraft, setRegisterDraft] = useState<OwnerRegistrationDraft>({
    displayName: '',
    email: '',
    password: '',
  })
  const [loginDraft, setLoginDraft] = useState<OwnerLoginDraft>({
    email: '',
    password: '',
  })
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [isLinkingAccount, setIsLinkingAccount] = useState(false)
  const [accountNotice, setAccountNotice] = useState<string | null>(null)
  const keycloakClientRef = useRef<RuntimeKeycloakClient | null>(null)

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
      onCampaignsReady: (token: string) => Promise<void>,
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

        if (isRegisterMode) {
          const session = await registerOwner(registerDraft)
          await completeAuthentication(session.token, session.owner, onCampaignsReady)
        } else {
          const session = await loginOwner(loginDraft)
          await completeAuthentication(session.token, session.owner, onCampaignsReady)
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
    [authConfig, completeAuthentication, isRegisterMode, loginDraft, registerDraft],
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
        const storedAuthToken = localStorage.getItem(authTokenStorageKey)

        if (storedAuthToken) {
          try {
            await logoutOwner(storedAuthToken)
          } catch {
            // Intentionally ignore logout failures because local sign-out should still work.
          }
        }

        localStorage.removeItem(authTokenStorageKey)
        localStorage.removeItem('dnd-notes:selected-campaign-id')
        if (guestStorageKey) {
          localStorage.removeItem(guestStorageKey)
        }
        window.location.assign('/')
        return
      }

      if (authToken) {
        try {
          await logoutOwner(authToken)
        } catch {
          // Intentionally ignore logout failures because local sign-out should still work.
        }
      }

      onClearSession()
      setIsRegisterMode(false)
    },
    [authConfig, authToken],
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

          return
        }

        const storedToken = localStorage.getItem(authTokenStorageKey)

        if (!storedToken) {
          setAuthToken(null)
          setOwner(null)
          return
        }

        const session = await fetchOwnerSession(storedToken)

        if (isCancelled()) {
          return
        }

        setAuthToken(storedToken)
        setOwner(session.owner)

        if (!isSharedMode) {
          await loadCampaigns(storedToken)
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
    isRegisterMode,
    registerDraft,
    loginDraft,
    isSubmittingAuth,
    isLinkingAccount,
    accountNotice,
    keycloakClientRef,
    setAuthToken,
    setOwner,
    setAuthConfig,
    setIsAuthReady,
    setIsRegisterMode,
    setRegisterDraft,
    setLoginDraft,
    setIsSubmittingAuth,
    setIsLinkingAccount,
    setAccountNotice,
    completeAuthentication,
    bootstrapAuth,
    startKeycloakRefresh,
    handleSubmitAuth,
    handleLogout,
    handleFetchOwnerSession,
  }
}
