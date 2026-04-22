import type { OperatorKeycloakConfig } from './types'

function normalizeBasePath(value: string | undefined, fallback: string) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return fallback
  }

  if (trimmedValue === '/') {
    return trimmedValue
  }

  return trimmedValue.replace(/\/+$/, '')
}

function normalizeUrl(value: string | undefined, fallback: string) {
  const trimmedValue = value?.trim()
  return (trimmedValue ?? fallback).replace(/\/+$/, '')
}

export const operatorApiBasePath = normalizeBasePath(
  import.meta.env.VITE_OPERATOR_API_BASE_PATH,
  '/operator-api',
)

export const operatorKeycloakConfig: OperatorKeycloakConfig = {
  url: normalizeUrl(
    import.meta.env.VITE_OPERATOR_KEYCLOAK_URL,
    'http://keycloak.127.0.0.1.nip.io:8080',
  ),
  realm: import.meta.env.VITE_OPERATOR_KEYCLOAK_REALM ?? 'dnd-notes-dev',
  clientId:
    import.meta.env.VITE_OPERATOR_KEYCLOAK_CLIENT_ID ?? 'dnd-notes-control-plane',
}

export function buildOperatorRedirectUri() {
  return new URL(
    `${window.location.pathname}${window.location.search}`,
    window.location.origin,
  ).toString()
}
