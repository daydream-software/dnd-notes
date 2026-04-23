import type { OperatorKeycloakConfig } from './types'
import { normalizeBasePath } from '@dnd-notes/portal-utils'

interface OperatorPortalViteEnv {
  VITE_OPERATOR_API_BASE_PATH?: string
  VITE_OPERATOR_KEYCLOAK_URL?: string
  VITE_OPERATOR_KEYCLOAK_REALM?: string
  VITE_OPERATOR_KEYCLOAK_CLIENT_ID?: string
}

function normalizeUrl(value: string | undefined, fallback: string) {
  const trimmedValue = value?.trim()
  const normalizedValue =
    trimmedValue && trimmedValue.length > 0 ? trimmedValue : fallback
  return normalizedValue.replace(/\/+$/, '')
}

function normalizeString(value: string | undefined, fallback: string) {
  const trimmedValue = value?.trim()
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : fallback
}

export function resolveOperatorPortalConfig(viteEnv: OperatorPortalViteEnv = {}) {
  return {
    operatorApiBasePath: normalizeBasePath(
      viteEnv.VITE_OPERATOR_API_BASE_PATH,
      '/operator-api',
    ),
    operatorKeycloakConfig: {
      url: normalizeUrl(
        viteEnv.VITE_OPERATOR_KEYCLOAK_URL,
        'http://keycloak.127.0.0.1.nip.io:8080',
      ),
      realm: normalizeString(
        viteEnv.VITE_OPERATOR_KEYCLOAK_REALM,
        'dnd-notes-dev',
      ),
      clientId: normalizeString(
        viteEnv.VITE_OPERATOR_KEYCLOAK_CLIENT_ID,
        'dnd-notes-control-plane',
      ),
    } satisfies OperatorKeycloakConfig,
  }
}

const { env: viteEnv = {} } = import.meta as ImportMeta & {
  env?: OperatorPortalViteEnv
}

export const { operatorApiBasePath, operatorKeycloakConfig } =
  resolveOperatorPortalConfig(viteEnv)

export function buildOperatorRedirectUri() {
  return new URL(
    `${window.location.pathname}${window.location.search}`,
    window.location.origin,
  ).toString()
}
