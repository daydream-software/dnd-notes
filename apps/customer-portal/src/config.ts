import { normalizeBasePath } from '@dnd-notes/portal-utils'
import type { CustomerKeycloakConfig } from './keycloak-client'

interface PortalRuntimeEnv {
  API_BASE_PATH?: string
  KEYCLOAK_URL?: string
  KEYCLOAK_REALM?: string
  KEYCLOAK_CLIENT_ID?: string
}

const runtimeEnv = (window as unknown as { __ENV__?: PortalRuntimeEnv }).__ENV__ ?? {}

export const portalApiBasePath = normalizeBasePath(
  runtimeEnv.API_BASE_PATH ?? (import.meta.env.VITE_PORTAL_API_BASE_PATH as string | undefined),
  '/portal-api',
)

export const portalKeycloakConfig: CustomerKeycloakConfig = {
  url: runtimeEnv.KEYCLOAK_URL ?? (import.meta.env.VITE_PORTAL_KEYCLOAK_URL as string | undefined) ?? 'https://keycloak.127.0.0.1.nip.io',
  realm: runtimeEnv.KEYCLOAK_REALM ?? (import.meta.env.VITE_PORTAL_KEYCLOAK_REALM as string | undefined) ?? 'dnd-notes-dev',
  clientId: runtimeEnv.KEYCLOAK_CLIENT_ID ?? (import.meta.env.VITE_PORTAL_KEYCLOAK_CLIENT_ID as string | undefined) ?? 'dnd-notes-customer-portal',
}

// Returns origin only — no pathname or search — so stale query params from a
// previous failed flow (e.g. ?error=access_denied) are never forwarded to Keycloak.
export function buildPortalRedirectUri() {
  return window.location.origin
}
