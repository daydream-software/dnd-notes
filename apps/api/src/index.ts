import 'dotenv/config'
import type { Server } from 'node:http'
import { createApp } from './app.js'
import { createTenantRuntimeAuth } from './keycloak-auth.js'
import { createRuntimeNoteStore } from './note-store.js'
import { createShutdownController } from './shutdown.js'

const port = Number(process.env.PORT ?? 3001)
const serveWeb = process.env.SERVE_WEB === 'true'
const rawKeycloakJwksUrl = process.env.KEYCLOAK_JWKS_URL?.trim()
const keycloakJwksUrl =
  rawKeycloakJwksUrl === undefined || rawKeycloakJwksUrl === ''
    ? undefined
    : rawKeycloakJwksUrl
const runtimeAuth = createTenantRuntimeAuth({
  keycloakUrl: process.env.KEYCLOAK_URL,
  keycloakRealm: process.env.KEYCLOAK_REALM,
  clientId: process.env.KEYCLOAK_TENANT_CLIENT_ID,
  jwksUrl: keycloakJwksUrl,
})
const shutdownGracePeriodMs = 30_000
const siteAdminEmails =
  process.env.SITE_ADMIN_EMAILS?.split(',').map((email) => email.trim()) ?? []
const rawControlPlaneToken = process.env.CONTROL_PLANE_TOKEN?.trim()
const controlPlaneToken =
  rawControlPlaneToken && rawControlPlaneToken.length > 0
    ? rawControlPlaneToken
    : null
const rawTenantId = process.env.TENANT_ID?.trim()
const tenantId = rawTenantId && rawTenantId.length > 0 ? rawTenantId : null
const noteStore = await createRuntimeNoteStore({ siteAdminEmails })
const serverRef: { current?: Server } = {}
const shutdownController = createShutdownController({
  getServer: () => serverRef.current,
  closeResources: () => noteStore.close(),
  exit: (exitCode) => process.exit(exitCode),
  shutdownGracePeriodMs,
})
const app = createApp({
  noteStore,
  publicWebUrl: process.env.PUBLIC_WEB_URL,
  runtimeAuth,
  isShuttingDown: shutdownController.isShuttingDown,
  serveWeb,
  controlPlaneToken,
  tenantId,
  appVersion: process.env.APP_VERSION,
})
serverRef.current = app.listen(port, () => {
  console.log(`dnd-notes API listening on http://localhost:${port}`)
})

process.on('SIGINT', () => shutdownController.shutdown(0))
process.on('SIGTERM', () => shutdownController.shutdown(0))
