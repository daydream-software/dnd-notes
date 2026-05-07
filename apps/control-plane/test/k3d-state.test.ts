import assert from 'node:assert'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, it, before, after } from 'node:test'

// ---------------------------------------------------------------------------
// Import helpers directly from the ES module under test.
// ---------------------------------------------------------------------------
const stateMjsPath = fileURLToPath(
  new URL('../../../scripts/k3d/state.mjs', import.meta.url),
)

// Dynamic import so we can assert on named exports.
const { readState, readStateSafe, writeState, buildTokenSnippet, SCHEMA_VERSION } = await import(
  stateMjsPath
)

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid v1 state object (no tenant). */
const baseState = {
  clusterName: 'dnd-notes',
  ingressUrl: 'http://127.0.0.1.nip.io:8080',
  controlPlaneUrl: 'http://127.0.0.1:3101',
  controlPlanePort: 3101,
  keycloak: {
    url: 'http://keycloak.127.0.0.1.nip.io:8080',
    realm: 'dnd-notes-dev',
    controlPlaneClientId: 'dnd-notes-control-plane',
    tenantClientId: 'dnd-notes-tenant-app',
  },
  auth: {
    siteAdminEmail: 'site-admin@example.com',
    siteAdminPassword: 'password',
    tenantOwnerEmail: 'owner@example.com',
    tenantOwnerPassword: 'password',
  },
  tenants: [],
  tokenSnippets: {
    controlPlane: 'curl -fsS ...',
    tenant: null,
  },
}

/** v1 state with one tenant. */
const stateWithTenant = {
  ...baseState,
  tenants: [
    {
      id: 'k3d-dev',
      subdomain: 'dev',
      namespace: 'tenant-k3d-dev',
      hostname: 'dev.127.0.0.1.nip.io',
      origin: 'http://dev.127.0.0.1.nip.io:8080',
      state: 'ready',
    },
  ],
  tokenSnippets: {
    controlPlane: 'curl -fsS ...',
    tenant: 'curl -fsS ... tenant',
  },
}

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

let testDir: string

before(() => {
  testDir = join(tmpdir(), `k3d-state-test-${process.pid}`)
  mkdirSync(testDir, { recursive: true })
})

after(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function tmpFile(name: string): string {
  return join(testDir, name)
}

// ---------------------------------------------------------------------------
// SCHEMA_VERSION constant
// ---------------------------------------------------------------------------

describe('SCHEMA_VERSION', () => {
  it('is 1', () => {
    assert.strictEqual(SCHEMA_VERSION, 1)
  })
})

// ---------------------------------------------------------------------------
// writeState
// ---------------------------------------------------------------------------

describe('writeState', () => {
  it('writes a valid v1 JSON file', () => {
    const file = tmpFile('write-basic.json')
    writeState(file, baseState)

    const parsed = readState(file)
    assert.strictEqual(parsed.schemaVersion, 1)
    assert.strictEqual(parsed.clusterName, 'dnd-notes')
    assert.strictEqual(parsed.ingressUrl, 'http://127.0.0.1.nip.io:8080')
    assert.strictEqual(parsed.controlPlaneUrl, 'http://127.0.0.1:3101')
    assert.strictEqual(parsed.controlPlanePort, 3101)
  })

  it('sets schemaVersion automatically if not provided', () => {
    const file = tmpFile('write-no-version.json')
    const stateWithoutVersion = { ...baseState } as Record<string, unknown>
    delete stateWithoutVersion['schemaVersion']

    writeState(file, stateWithoutVersion as Parameters<typeof writeState>[1])
    const parsed = readState(file)
    assert.strictEqual(parsed.schemaVersion, 1)
  })

  it('writes keycloak sub-object correctly', () => {
    const file = tmpFile('write-keycloak.json')
    writeState(file, baseState)

    const parsed = readState(file)
    assert.strictEqual(parsed.keycloak.url, 'http://keycloak.127.0.0.1.nip.io:8080')
    assert.strictEqual(parsed.keycloak.realm, 'dnd-notes-dev')
    assert.strictEqual(parsed.keycloak.controlPlaneClientId, 'dnd-notes-control-plane')
    assert.strictEqual(parsed.keycloak.tenantClientId, 'dnd-notes-tenant-app')
  })

  it('writes auth sub-object correctly', () => {
    const file = tmpFile('write-auth.json')
    writeState(file, baseState)

    const parsed = readState(file)
    assert.strictEqual(parsed.auth.siteAdminEmail, 'site-admin@example.com')
    assert.strictEqual(parsed.auth.tenantOwnerEmail, 'owner@example.com')
  })

  it('writes tenants array correctly', () => {
    const file = tmpFile('write-tenants.json')
    writeState(file, stateWithTenant)

    const parsed = readState(file)
    assert.strictEqual(parsed.tenants.length, 1)
    const tenant = parsed.tenants[0]
    assert.strictEqual(tenant.id, 'k3d-dev')
    assert.strictEqual(tenant.subdomain, 'dev')
    assert.strictEqual(tenant.namespace, 'tenant-k3d-dev')
    assert.strictEqual(tenant.hostname, 'dev.127.0.0.1.nip.io')
    assert.strictEqual(tenant.origin, 'http://dev.127.0.0.1.nip.io:8080')
    assert.strictEqual(tenant.state, 'ready')
  })

  it('writes empty tenants array when no tenant', () => {
    const file = tmpFile('write-no-tenant.json')
    writeState(file, baseState)

    const parsed = readState(file)
    assert.deepStrictEqual(parsed.tenants, [])
  })

  it('creates missing parent directories', () => {
    const file = tmpFile('nested/deep/state.json')
    writeState(file, baseState)
    const parsed = readState(file)
    assert.strictEqual(parsed.schemaVersion, 1)
  })
})

// ---------------------------------------------------------------------------
// readState
// ---------------------------------------------------------------------------

describe('readState', () => {
  it('throws for a missing file', () => {
    assert.throws(() => readState(tmpFile('does-not-exist.json')))
  })

  it('throws for invalid JSON', () => {
    const file = tmpFile('invalid.json')
    writeFileSync(file, 'not json')
    assert.throws(() => readState(file))
  })

  it('throws when schemaVersion is missing', () => {
    const file = tmpFile('no-version.json')
    writeFileSync(file, JSON.stringify({ clusterName: 'dnd-notes' }))
    assert.throws(() => readState(file), /schemaVersion/)
  })

  it('throws when schemaVersion is unknown', () => {
    const file = tmpFile('future-version.json')
    writeFileSync(file, JSON.stringify({ schemaVersion: 99, clusterName: 'dnd-notes' }))
    assert.throws(() => readState(file), /schemaVersion 99/)
  })

  it('round-trips all documented fields', () => {
    const file = tmpFile('roundtrip.json')
    writeState(file, stateWithTenant)
    const parsed = readState(file)

    assert.strictEqual(parsed.clusterName, stateWithTenant.clusterName)
    assert.strictEqual(parsed.ingressUrl, stateWithTenant.ingressUrl)
    assert.strictEqual(parsed.controlPlaneUrl, stateWithTenant.controlPlaneUrl)
    assert.strictEqual(parsed.controlPlanePort, stateWithTenant.controlPlanePort)
    assert.deepStrictEqual(parsed.keycloak, stateWithTenant.keycloak)
    assert.deepStrictEqual(parsed.auth, stateWithTenant.auth)
    assert.deepStrictEqual(parsed.tenants, stateWithTenant.tenants)
    assert.deepStrictEqual(parsed.tokenSnippets, stateWithTenant.tokenSnippets)
  })
})

// ---------------------------------------------------------------------------
// readStateSafe
// ---------------------------------------------------------------------------

describe('readStateSafe', () => {
  it('returns null for a missing file', () => {
    assert.strictEqual(readStateSafe(tmpFile('safe-missing.json')), null)
  })

  it('returns null for invalid JSON', () => {
    const file = tmpFile('safe-invalid.json')
    writeFileSync(file, 'not json')
    assert.strictEqual(readStateSafe(file), null)
  })

  it('returns null for wrong schemaVersion', () => {
    const file = tmpFile('safe-future.json')
    writeFileSync(file, JSON.stringify({ schemaVersion: 99 }))
    assert.strictEqual(readStateSafe(file), null)
  })

  it('returns the state for a valid file', () => {
    const file = tmpFile('safe-valid.json')
    writeState(file, baseState)
    const result = readStateSafe(file)
    assert.ok(result !== null)
    assert.strictEqual(result!.clusterName, 'dnd-notes')
  })
})

// ---------------------------------------------------------------------------
// buildTokenSnippet
// ---------------------------------------------------------------------------

describe('buildTokenSnippet', () => {
  it('produces a curl command with the correct token endpoint URL', () => {
    const snippet = buildTokenSnippet(
      'http://keycloak.127.0.0.1.nip.io:8080',
      'dnd-notes-dev',
      'dnd-notes-control-plane',
      'admin@example.com',
      'password',
    )
    assert.match(
      snippet,
      /http:\/\/keycloak\.127\.0\.0\.1\.nip\.io:8080\/realms\/dnd-notes-dev\/protocol\/openid-connect\/token/,
    )
    assert.match(snippet, /client_id=dnd-notes-control-plane/)
    assert.match(snippet, /username=admin@example\.com/)
  })

  it('shell-quotes passwords containing single quotes', () => {
    const snippet = buildTokenSnippet(
      'http://keycloak.127.0.0.1.nip.io:8080',
      'realm',
      'client',
      'user',
      "pass'word",
    )
    // The shell-quote function should handle the apostrophe safely
    assert.match(snippet, /pass/)
    // Should not have an unescaped bare single quote that would break the shell command
    assert.doesNotMatch(snippet, /'pass'word'/)
  })
})

// ---------------------------------------------------------------------------
// CLI subcommands (via spawnSync)
// ---------------------------------------------------------------------------

describe('state.mjs CLI', () => {
  it('read-safe prints empty string and exits 0 on missing file', () => {
    const result = spawnSync('node', [stateMjsPath, 'read-safe', '/nonexistent/state.json', 'clusterName'], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, '')
  })

  it('read prints a field value for a valid state file', () => {
    const file = tmpFile('cli-read.json')
    writeState(file, baseState)

    const result = spawnSync('node', [stateMjsPath, 'read', file, 'clusterName'], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'dnd-notes')
  })

  it('read exits 1 for a missing field', () => {
    const file = tmpFile('cli-read-missing.json')
    writeState(file, baseState)

    const result = spawnSync('node', [stateMjsPath, 'read', file, 'nonExistentField'], {
      encoding: 'utf8',
    })
    assert.notStrictEqual(result.status, 0)
  })

  it('read-json emits valid JSON with schemaVersion', () => {
    const file = tmpFile('cli-read-json.json')
    writeState(file, stateWithTenant)

    const result = spawnSync('node', [stateMjsPath, 'read-json', file], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    assert.strictEqual(parsed.schemaVersion, 1)
    assert.strictEqual(parsed.clusterName, 'dnd-notes')
    assert.strictEqual(parsed.tenants.length, 1)
  })

  it('write subcommand creates a valid state file', () => {
    const file = tmpFile('cli-write-output.json')
    const payload = JSON.stringify({ stateFile: file, ...baseState })

    const result = spawnSync('node', [stateMjsPath, 'write', payload], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, file)

    const parsed = readState(file)
    assert.strictEqual(parsed.schemaVersion, 1)
    assert.strictEqual(parsed.clusterName, 'dnd-notes')
  })

  it('token-snippet subcommand emits a curl command', () => {
    const result = spawnSync(
      'node',
      [
        stateMjsPath,
        'token-snippet',
        'http://keycloak.127.0.0.1.nip.io:8080',
        'dnd-notes-dev',
        'dnd-notes-control-plane',
        'admin@example.com',
        'password',
      ],
      { encoding: 'utf8' },
    )
    assert.strictEqual(result.status, 0, result.stderr)
    assert.match(result.stdout, /curl/)
    assert.match(result.stdout, /openid-connect\/token/)
  })

  it('read-vars emits shell assignments for a v1 state file', () => {
    const file = tmpFile('cli-read-vars.json')
    writeState(file, stateWithTenant)

    const result = spawnSync('node', [stateMjsPath, 'read-vars', file], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0, result.stderr)
    assert.match(result.stdout, /keycloak_url='http:\/\/keycloak\.127\.0\.0\.1\.nip\.io:8080'/)
    assert.match(result.stdout, /keycloak_realm='dnd-notes-dev'/)
    assert.match(result.stdout, /ingress_port='8080'/)
    assert.match(result.stdout, /tenant_subdomain='dev'/)
    assert.match(result.stdout, /tenant_hostname='dev\.127\.0\.0\.1\.nip\.io'/)
    assert.match(result.stdout, /tenant_origin='http:\/\/dev\.127\.0\.0\.1\.nip\.io:8080'/)
  })

  it('read-vars emits empty strings on missing file', () => {
    const result = spawnSync('node', [stateMjsPath, 'read-vars', '/nonexistent/state.json'], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0, result.stderr)
    assert.match(result.stdout, /keycloak_url=''/)
    assert.match(result.stdout, /tenant_subdomain=''/)
  })

  it('exits with non-zero for unknown subcommand', () => {
    const result = spawnSync('node', [stateMjsPath, 'bogus-command'], {
      encoding: 'utf8',
    })
    assert.notStrictEqual(result.status, 0)
  })
})

// ---------------------------------------------------------------------------
// jq-queryable field guarantee (documented schema surface)
// ---------------------------------------------------------------------------
// These tests verify that every field documented in the README
// "Agent-friendly automation" schema table is present after a write.

describe('documented schema surface — jq queryable fields', () => {
  it('all top-level fields are present', () => {
    const file = tmpFile('jq-compat.json')
    writeState(file, stateWithTenant)
    const parsed = readState(file)

    const required = [
      'schemaVersion',
      'clusterName',
      'ingressUrl',
      'controlPlaneUrl',
      'controlPlanePort',
      'keycloak',
      'auth',
      'tenants',
      'tokenSnippets',
    ] as const

    for (const field of required) {
      assert.ok(field in parsed, `Missing top-level field: ${field}`)
    }
  })

  it('keycloak sub-fields are present', () => {
    const file = tmpFile('jq-keycloak.json')
    writeState(file, stateWithTenant)
    const { keycloak } = readState(file)

    assert.ok('url' in keycloak)
    assert.ok('realm' in keycloak)
    assert.ok('controlPlaneClientId' in keycloak)
    assert.ok('tenantClientId' in keycloak)
  })

  it('auth sub-fields are present', () => {
    const file = tmpFile('jq-auth.json')
    writeState(file, stateWithTenant)
    const { auth } = readState(file)

    assert.ok('siteAdminEmail' in auth)
    assert.ok('siteAdminPassword' in auth)
    assert.ok('tenantOwnerEmail' in auth)
    assert.ok('tenantOwnerPassword' in auth)
  })

  it('tenant entry fields are present', () => {
    const file = tmpFile('jq-tenant.json')
    writeState(file, stateWithTenant)
    const { tenants } = readState(file)

    assert.strictEqual(tenants.length, 1)
    const t = tenants[0]
    assert.ok('id' in t)
    assert.ok('subdomain' in t)
    assert.ok('namespace' in t)
    assert.ok('hostname' in t)
    assert.ok('origin' in t)
    assert.ok('state' in t, 'tenant entry must have a state field')
  })

  it('tenant state field round-trips correctly', () => {
    const file = tmpFile('jq-tenant-state.json')
    writeState(file, stateWithTenant)
    const { tenants } = readState(file)

    assert.strictEqual(tenants[0].state, 'ready')
  })
})
