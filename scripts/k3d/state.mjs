/**
 * k3d state file read/write helpers.
 *
 * This module is the single source of truth for the .k3d-state/state.json
 * schema. Every k3d script that reads or writes the state file delegates here.
 *
 * Schema version: 1
 *
 * Example state.json:
 * {
 *   "schemaVersion": 1,
 *   "clusterName": "dnd-notes",
 *   "ingressUrl": "http://127.0.0.1.nip.io:8080",
 *   "controlPlaneUrl": "http://127.0.0.1:3101",
 *   "controlPlanePort": 3101,
 *   "keycloak": {
 *     "url": "http://keycloak.127.0.0.1.nip.io:8080",
 *     "realm": "dnd-notes-dev",
 *     "controlPlaneClientId": "dnd-notes-control-plane",
 *     "tenantClientId": "dnd-notes-tenant-app"
 *   },
 *   "auth": {
 *     "siteAdminEmail": "site-admin@example.com",
 *     "siteAdminPassword": "password",
 *     "tenantOwnerEmail": "owner@example.com",
 *     "tenantOwnerPassword": "password"
 *   },
 *   "tenants": [
 *     {
 *       "id": "k3d-dev",
 *       "subdomain": "dev",
 *       "namespace": "tenant-k3d-dev",
 *       "hostname": "dev.127.0.0.1.nip.io",
 *       "origin": "http://dev.127.0.0.1.nip.io:8080",
 *       "state": "ready"
 *     }
 *   ],
 *   "tokenSnippets": {
 *     "controlPlane": "<curl command>",
 *     "tenant": "<curl command or null>"
 *   }
 * }
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const SCHEMA_VERSION = 1

/**
 * @typedef {Object} K3dTenant
 * @property {string} id
 * @property {string} subdomain
 * @property {string} namespace
 * @property {string} hostname
 * @property {string} origin
 * @property {string} state - Tenant lifecycle state (e.g. "ready", "deprovisioned")
 */

/**
 * @typedef {Object} K3dState
 * @property {number} schemaVersion
 * @property {string} clusterName
 * @property {string} ingressUrl
 * @property {string} controlPlaneUrl
 * @property {number} controlPlanePort
 * @property {{ url: string, realm: string, controlPlaneClientId: string, tenantClientId: string }} keycloak
 * @property {{ siteAdminEmail: string, siteAdminPassword: string, tenantOwnerEmail: string, tenantOwnerPassword: string }} auth
 * @property {K3dTenant[]} tenants
 * @property {{ controlPlane: string, tenant: string | null }} tokenSnippets
 */

/**
 * Read and parse the state file. Returns the parsed state object.
 * Throws if the file is missing, not valid JSON, or has an unexpected schemaVersion.
 *
 * @param {string} stateFile - Absolute path to the state file.
 * @returns {K3dState}
 */
export function readState(stateFile) {
  const raw = readFileSync(stateFile, 'utf8')
  const state = JSON.parse(raw)
  if (typeof state.schemaVersion !== 'number') {
    throw new Error(
      `State file ${stateFile} is missing schemaVersion — run k3d:up to regenerate it.`,
    )
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `State file ${stateFile} has schemaVersion ${state.schemaVersion}, expected ${SCHEMA_VERSION}. Run k3d:up to regenerate it.`,
    )
  }
  return state
}

/**
 * Read the state file, returning null on any error (missing file, invalid JSON,
 * wrong schema version). Never throws.
 *
 * @param {string} stateFile - Absolute path to the state file.
 * @returns {K3dState | null}
 */
export function readStateSafe(stateFile) {
  try {
    return readState(stateFile)
  } catch {
    return null
  }
}

/**
 * Write the state file. Creates the directory if needed. Sets directory
 * permissions to 0o700 and file permissions to 0o600.
 * Always writes schemaVersion: 1 regardless of whether it is present in state.
 *
 * @param {string} stateFile - Absolute path to the state file.
 * @param {K3dState} state - State object to write.
 */
export function writeState(stateFile, state) {
  const dir = dirname(stateFile)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const withVersion = { schemaVersion: SCHEMA_VERSION, ...state }
  writeFileSync(stateFile, JSON.stringify(withVersion, null, 2) + '\n')
  chmodSync(stateFile, 0o600)
}

/**
 * Build a curl snippet that obtains a Keycloak access token for the given
 * client and user.
 *
 * @param {string} keycloakUrl
 * @param {string} realm
 * @param {string} clientId
 * @param {string} username
 * @param {string} password
 * @returns {string}
 */
export function buildTokenSnippet(keycloakUrl, realm, clientId, username, password) {
  const shellQuote = (v) => "'" + String(v).replace(/'/g, "'\"'\"'") + "'"
  const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`
  const tokenReader = 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).access_token)'
  return [
    'curl -fsS -X POST',
    `-H ${shellQuote('Content-Type: application/x-www-form-urlencoded')}`,
    `--data-urlencode ${shellQuote('grant_type=password')}`,
    `--data-urlencode ${shellQuote(`client_id=${clientId}`)}`,
    `--data-urlencode ${shellQuote(`username=${username}`)}`,
    `--data-urlencode ${shellQuote(`password=${password}`)}`,
    shellQuote(tokenUrl),
    `| node -e ${shellQuote(tokenReader)}`,
  ].join(' ')
}

/**
 * Read v1/v0-compatible shell variable assignments from the state file.
 * Returns a newline-separated string of `key='value'` pairs ready to eval.
 * Never throws — returns empty strings for all fields on any error.
 *
 * Variables emitted: keycloak_url, keycloak_realm, ingress_port,
 * tenant_subdomain, tenant_hostname, tenant_origin.
 *
 * @param {string} stateFile - Absolute path to the state file.
 * @returns {string}
 */
export function readCompatVars(stateFile) {
  const sq = (v) => "'" + String(v ?? '').replace(/'/g, "'\"'\"'") + "'"
  // Read raw JSON without schema validation so v0 state files are also handled.
  let state = null
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')) } catch {}
  const tenant = state && Array.isArray(state.tenants) && state.tenants[0] ? state.tenants[0] : null

  const keycloakUrl = state?.keycloak?.url ?? state?.keycloakUrl ?? ''
  const keycloakRealm = state?.keycloak?.realm ?? state?.keycloakRealm ?? ''

  let ingressPort = '8080'
  for (const url of [state?.ingressUrl, state?.tenantOrigin, state?.keycloakUrl, state?.keycloak?.url]) {
    const m = url && url.match(/:(\d+)/)
    if (m) { ingressPort = m[1]; break }
  }

  return [
    `keycloak_url=${sq(keycloakUrl)}`,
    `keycloak_realm=${sq(keycloakRealm)}`,
    `ingress_port=${sq(ingressPort)}`,
    `tenant_subdomain=${sq(tenant?.subdomain ?? state?.tenantSubdomain ?? '')}`,
    `tenant_hostname=${sq(tenant?.hostname ?? state?.tenantHostname ?? '')}`,
    `tenant_origin=${sq(tenant?.origin ?? state?.tenantOrigin ?? '')}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// CLI entry point — invoked by bash scripts
// ---------------------------------------------------------------------------

/**
 * Supported CLI subcommands:
 *
 *   node state.mjs read <stateFile> <field>
 *     Print a scalar top-level field. Exits 1 if missing or invalid.
 *
 *   node state.mjs read-safe <stateFile> <field>
 *     Same as read but prints nothing and exits 0 on any error.
 *
 *   node state.mjs read-json <stateFile>
 *     Print the entire state as pretty JSON.
 *
 *   node state.mjs read-vars <stateFile>
 *     Print shell variable assignments for all compat fields (safe to eval).
 *
 *   node state.mjs write <json>
 *     Write the state. <json> is the full state object as a JSON string with
 *     a "stateFile" field indicating the path.
 *
 *   node state.mjs token-snippet <keycloakUrl> <realm> <clientId> <username> <password>
 *     Print a curl token snippet.
 */
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [, , subcommand, ...args] = process.argv

  switch (subcommand) {
    case 'read': {
      const [stateFile, field] = args
      const state = readState(stateFile)
      const value = state[field]
      if (value === undefined || value === null) {
        process.stderr.write(`Field '${field}' not found in ${stateFile}\n`)
        process.exit(1)
      }
      process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value))
      break
    }

    case 'read-safe': {
      const [stateFile, field] = args
      const state = readStateSafe(stateFile)
      if (!state) break
      const value = state[field]
      if (value !== undefined && value !== null) {
        process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value))
      }
      break
    }

    case 'read-json': {
      const [stateFile] = args
      const state = readState(stateFile)
      process.stdout.write(JSON.stringify(state, null, 2) + '\n')
      break
    }

    case 'read-vars': {
      const [stateFile] = args
      process.stdout.write(readCompatVars(stateFile) + '\n')
      break
    }

    case 'write': {
      const raw = args[0]
      const payload = JSON.parse(raw)
      const { stateFile, ...state } = payload
      if (!stateFile) {
        process.stderr.write('write subcommand requires a stateFile field in the JSON payload\n')
        process.exit(1)
      }
      writeState(stateFile, { schemaVersion: SCHEMA_VERSION, ...state })
      process.stdout.write(stateFile)
      break
    }

    case 'token-snippet': {
      const [keycloakUrl, realm, clientId, username, password] = args
      process.stdout.write(buildTokenSnippet(keycloakUrl, realm, clientId, username, password))
      break
    }

    default:
      process.stderr.write(
        `Unknown subcommand: ${subcommand ?? '(none)'}\nExpected: read, read-safe, read-json, read-vars, write, token-snippet\n`,
      )
      process.exit(1)
  }
}
