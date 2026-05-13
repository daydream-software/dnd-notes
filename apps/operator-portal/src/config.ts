import type { OperatorKeycloakConfig } from './types'
import { normalizeBasePath } from '@dnd-notes/portal-utils'

interface OperatorPortalViteEnv {
  VITE_OPERATOR_API_BASE_PATH?: string
  VITE_OPERATOR_KEYCLOAK_URL?: string
  VITE_OPERATOR_KEYCLOAK_REALM?: string
  VITE_OPERATOR_KEYCLOAK_CLIENT_ID?: string
  VITE_OPERATOR_KEYCLOAK_REQUIRED_ROLES?: string
  VITE_OPERATOR_CUSTOMER_PORTAL_URL?: string
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

interface OperatorRuntimeEnv {
  API_BASE_PATH?: string
  KEYCLOAK_URL?: string
  KEYCLOAK_REALM?: string
  KEYCLOAK_CLIENT_ID?: string
  KEYCLOAK_REQUIRED_ROLES?: string
  CUSTOMER_PORTAL_URL?: string
}

const defaultRequiredRoles = ['control-plane-admin', 'control-plane-workforce']

function parseRequiredRoles(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  return raw
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
}

const runtimeEnv = (window as unknown as { __ENV__?: OperatorRuntimeEnv }).__ENV__ ?? {}

export function resolveOperatorPortalConfig(viteEnv: OperatorPortalViteEnv = {}) {
  const parsedRequiredRoles = parseRequiredRoles(
    runtimeEnv.KEYCLOAK_REQUIRED_ROLES ?? viteEnv.VITE_OPERATOR_KEYCLOAK_REQUIRED_ROLES,
  )
  const requiredRoles =
    parsedRequiredRoles.length > 0 ? parsedRequiredRoles : defaultRequiredRoles

  return {
    operatorApiBasePath: normalizeBasePath(
      runtimeEnv.API_BASE_PATH ?? viteEnv.VITE_OPERATOR_API_BASE_PATH,
      '/operator-api',
    ),
    operatorKeycloakConfig: {
      url: normalizeUrl(
        runtimeEnv.KEYCLOAK_URL ?? viteEnv.VITE_OPERATOR_KEYCLOAK_URL,
        'https://keycloak.127.0.0.1.nip.io',
      ),
      realm: normalizeString(
        runtimeEnv.KEYCLOAK_REALM ?? viteEnv.VITE_OPERATOR_KEYCLOAK_REALM,
        'dnd-notes-dev',
      ),
      clientId: normalizeString(
        runtimeEnv.KEYCLOAK_CLIENT_ID ?? viteEnv.VITE_OPERATOR_KEYCLOAK_CLIENT_ID,
        'dnd-notes-control-plane',
      ),
    } satisfies OperatorKeycloakConfig,
    requiredRoles,
    customerPortalUrl: normalizeUrl(
      runtimeEnv.CUSTOMER_PORTAL_URL ?? viteEnv.VITE_OPERATOR_CUSTOMER_PORTAL_URL,
      'https://portal.127.0.0.1.nip.io',
    ),
  }
}

const { env: viteEnv = {} } = import.meta as ImportMeta & {
  env?: OperatorPortalViteEnv
}

export const { operatorApiBasePath, operatorKeycloakConfig, requiredRoles, customerPortalUrl } =
  resolveOperatorPortalConfig(viteEnv)

export function buildOperatorRedirectUri() {
  return new URL(
    `${window.location.pathname}${window.location.search}`,
    window.location.origin,
  ).toString()
}

export function buildAccountConsoleUrl(config: OperatorKeycloakConfig) {
  return `${config.url}/realms/${config.realm}/account`
}
