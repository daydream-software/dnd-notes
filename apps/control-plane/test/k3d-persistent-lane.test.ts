import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const statusScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/status.sh', import.meta.url),
)
const downScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/down.sh', import.meta.url),
)
const upScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/up.sh', import.meta.url),
)

// Extract functions from the scripts by matching function body blocks
const statusScript = readFileSync(statusScriptPath, 'utf8')
const downScript = readFileSync(downScriptPath, 'utf8')
const upScript = readFileSync(upScriptPath, 'utf8')

const readStateFnMatch = statusScript.match(/^read_state\(\) \{\n[\s\S]*?^}/m)
const readStateFieldFnMatch = downScript.match(/^read_state_field\(\) \{\n[\s\S]*?^}/m)
const localizePostgresUrlMatch = upScript.match(/^localize_postgres_url\(\) \{\n[\s\S]*?^}/m)
const writeStateFnMatch = upScript.match(/^write_state\(\) \{\n[\s\S]*?^}/m)

if (!readStateFnMatch) {
  throw new Error('Expected read_state() in scripts/k3d/status.sh')
}

if (!readStateFieldFnMatch) {
  throw new Error('Expected read_state_field() in scripts/k3d/down.sh')
}

if (!localizePostgresUrlMatch) {
  throw new Error('Expected localize_postgres_url() in scripts/k3d/up.sh')
}

if (!writeStateFnMatch) {
  throw new Error('Expected write_state() in scripts/k3d/up.sh')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runBash(script: string, env?: NodeJS.ProcessEnv) {
  return spawnSync('bash', ['-lc', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

// ---------------------------------------------------------------------------
// Namespace preservation: the core regression guard
// ---------------------------------------------------------------------------

describe('k3d status read_state — namespace preservation', () => {
  it('reads tenantNamespace verbatim from state.json without re-deriving it', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-status-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })

    // Use a non-default namespace to prove no re-derivation occurs
    const customNamespace = 'tenant-platform-dev'
    const state = {
      clusterName: 'dnd-notes',
      tenantId: 'k3d-dev',
      tenantSubdomain: 'dev',
      tenantNamespace: customNamespace,
      tenantHostname: 'dev.127.0.0.1.nip.io',
      tenantOrigin: 'http://dev.127.0.0.1.nip.io:8080',
      keycloakUrl: 'http://keycloak.127.0.0.1.nip.io:8080',
      keycloakRealm: 'dnd-notes-dev',
      controlPlaneClientId: 'dnd-notes-control-plane',
      tenantClientId: 'dnd-notes-tenant-app',
      siteAdminEmail: 'site-admin@example.com',
      siteAdminPassword: 'password',
      tenantOwnerEmail: 'owner@example.com',
      tenantOwnerPassword: 'password',
      tokenSnippets: { controlPlane: 'curl ...', tenant: 'curl ...' },
    }
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    const result = runBash(
      `${readStateFnMatch[0]}
STATE_FILE="${stateFile}"
if read_state; then
  printf '%s' "$state_tenantNamespace"
else
  echo "read_state failed"
  exit 1
fi`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(
      result.stdout,
      customNamespace,
      'read_state must preserve the stored tenantNamespace exactly, not re-derive it from tenantSubdomain',
    )
  })

  it('correctly reads all stored fields, not just namespace', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-status-fields-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })

    const state = {
      clusterName: 'my-cluster',
      tenantId: 'k3d-dev',
      tenantSubdomain: 'dev',
      tenantNamespace: 'tenant-platform-dev',
      tenantHostname: 'dev.127.0.0.1.nip.io',
      tenantOrigin: 'http://dev.127.0.0.1.nip.io:8080',
      keycloakUrl: 'http://keycloak.example.com:8080',
      keycloakRealm: 'my-realm',
    }
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    const result = runBash(
      `${readStateFnMatch[0]}
STATE_FILE="${stateFile}"
read_state
printf '%s|%s|%s|%s|%s|%s|%s|%s' \
  "$state_clusterName" \
  "$state_tenantId" \
  "$state_tenantSubdomain" \
  "$state_tenantNamespace" \
  "$state_tenantHostname" \
  "$state_tenantOrigin" \
  "$state_keycloakUrl" \
  "$state_keycloakRealm"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    const fields = result.stdout.split('|')
    assert.strictEqual(fields[0], 'my-cluster', 'clusterName')
    assert.strictEqual(fields[1], 'k3d-dev', 'tenantId')
    assert.strictEqual(fields[2], 'dev', 'tenantSubdomain')
    // The crucial assertion: namespace must not be re-derived from subdomain
    assert.strictEqual(fields[3], 'tenant-platform-dev', 'tenantNamespace must be stored value, not tenant-dev')
    assert.strictEqual(fields[4], 'dev.127.0.0.1.nip.io', 'tenantHostname')
    assert.strictEqual(fields[5], 'http://dev.127.0.0.1.nip.io:8080', 'tenantOrigin')
    assert.strictEqual(fields[6], 'http://keycloak.example.com:8080', 'keycloakUrl')
    assert.strictEqual(fields[7], 'my-realm', 'keycloakRealm')
  })
})

// ---------------------------------------------------------------------------
// Corrupt / truncated state recovery
// ---------------------------------------------------------------------------

describe('k3d status read_state — corrupt state recovery', () => {
  it('returns non-zero for a missing state file', () => {
    const result = runBash(
      `${readStateFnMatch[0]}
STATE_FILE="/tmp/does-not-exist-${process.pid}.json"
if read_state; then
  echo "should-not-reach"
  exit 1
else
  echo "correctly-failed"
fi`,
    )

    assert.strictEqual(result.status, 0, result.stderr)
    assert.match(result.stdout, /correctly-failed/)
  })

  it('returns non-zero for truncated (invalid) JSON', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-corrupt-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(stateFile, '{"tenantNamespace": "tenant-dev"')  // truncated

    const result = runBash(
      `${readStateFnMatch[0]}
STATE_FILE="${stateFile}"
if read_state; then
  echo "should-not-reach"
  exit 1
else
  echo "correctly-failed"
fi`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.match(result.stdout, /correctly-failed/)
  })
})

// ---------------------------------------------------------------------------
// read_state_field (down.sh) — namespace preservation
// ---------------------------------------------------------------------------

describe('k3d down read_state_field — namespace preservation', () => {
  it('reads tenantNamespace from state file without re-deriving it', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-ns-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })

    const state = {
      tenantNamespace: 'tenant-platform-dev',
      tenantSubdomain: 'dev',
    }
    writeFileSync(stateFile, JSON.stringify(state))

    const result = runBash(
      `${readStateFieldFnMatch[0]}
STATE_FILE="${stateFile}"
ns="$(read_state_field tenantNamespace)"
printf '%s' "$ns"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'tenant-platform-dev')
  })

  it('returns empty string for a missing state file without error', () => {
    const result = runBash(
      `${readStateFieldFnMatch[0]}
STATE_FILE="/tmp/does-not-exist-${process.pid}.json"
ns="$(read_state_field tenantNamespace)"
printf 'got:[%s]' "$ns"`,
    )

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'got:[]')
  })

  it('returns empty string for corrupt JSON without error', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-corrupt-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(stateFile, '{bad json}')

    const result = runBash(
      `${readStateFieldFnMatch[0]}
STATE_FILE="${stateFile}"
ns="$(read_state_field tenantNamespace)"
printf 'got:[%s]' "$ns"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'got:[]')
  })
})

// ---------------------------------------------------------------------------
// localize_postgres_url (up.sh)
// ---------------------------------------------------------------------------

describe('k3d up localize_postgres_url', () => {
  it('substitutes the in-cluster hostname and port with 127.0.0.1 and the given port', () => {
    const result = runBash(
      `${localizePostgresUrlMatch[0]}
localize_postgres_url \
  "postgresql://runtime-user:secret@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/tenant_k3d_dev" \
  "55432"`,
    )

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(
      result.stdout.trim(),
      'postgresql://runtime-user:secret@127.0.0.1:55432/tenant_k3d_dev',
    )
  })

  it('preserves query parameters', () => {
    const result = runBash(
      `${localizePostgresUrlMatch[0]}
localize_postgres_url \
  "postgresql://user:pass@platform-postgres.svc.cluster.local:5432/mydb?sslmode=disable" \
  "55432"`,
    )

    assert.strictEqual(result.status, 0, result.stderr)
    assert.match(result.stdout.trim(), /sslmode=disable/)
    assert.match(result.stdout.trim(), /127\.0\.0\.1:55432/)
  })
})

// ---------------------------------------------------------------------------
// write_state (up.sh) — state.json schema contract
// ---------------------------------------------------------------------------

describe('k3d up write_state — stable JSON contract', () => {
  it('writes a valid state.json with all required fields including explicit tenantNamespace', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-write-state-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })

    const result = runBash(
      // We need the full write_state function and its json_get helper
      `${writeStateFnMatch[0]}
STATE_FILE="${stateFile}"
K3D_HTTP_PORT=8080
CONTROL_PLANE_PORT=3101
CONTROL_PLANE_KEYCLOAK_URL="http://keycloak.127.0.0.1.nip.io:8080"
CONTROL_PLANE_KEYCLOAK_REALM="dnd-notes-dev"
CONTROL_PLANE_KEYCLOAK_CLIENT_ID="dnd-notes-control-plane"
CONTROL_PLANE_KEYCLOAK_USERNAME="site-admin@example.com"
CONTROL_PLANE_KEYCLOAK_PASSWORD="password"
TENANT_KEYCLOAK_CLIENT_ID="dnd-notes-tenant-app"
TENANT_KEYCLOAK_USERNAME="owner@example.com"
TENANT_KEYCLOAK_PASSWORD="password"
TENANT_PUBLIC_SCHEME="http"
CLUSTER_NAME="dnd-notes"
mkdir -p "${tmpDir}"
write_state "k3d-dev" "dev" "tenant-platform-dev" "dev.127.0.0.1.nip.io" >/dev/null
cat "${stateFile}"`,
      {
        STATE_DIR: tmpDir,
      },
    )

    let state: Record<string, unknown>
    try {
      state = JSON.parse(result.stdout)
    } catch {
      assert.fail(`write_state did not produce valid JSON.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    }

    rmSync(tmpDir, { recursive: true, force: true })

    // Stable schema contract assertions
    assert.strictEqual(state.tenantId, 'k3d-dev', 'tenantId')
    assert.strictEqual(state.tenantSubdomain, 'dev', 'tenantSubdomain')
    // The core invariant: stored namespace must be the value passed in, not derived
    assert.strictEqual(state.tenantNamespace, 'tenant-platform-dev', 'tenantNamespace must be stored verbatim')
    assert.strictEqual(state.tenantHostname, 'dev.127.0.0.1.nip.io', 'tenantHostname')
    assert.ok(typeof state.clusterName === 'string', 'clusterName')
    assert.ok(typeof state.controlPlanePort === 'number', 'controlPlanePort')
    assert.ok(typeof state.keycloakUrl === 'string', 'keycloakUrl')
    assert.ok(typeof state.keycloakRealm === 'string', 'keycloakRealm')
    assert.ok(typeof state.siteAdminEmail === 'string', 'siteAdminEmail')
    assert.ok(typeof state.tenantOwnerEmail === 'string', 'tenantOwnerEmail')
    assert.ok(state.tokenSnippets && typeof state.tokenSnippets === 'object', 'tokenSnippets')
    const snippets = state.tokenSnippets as Record<string, unknown>
    assert.ok(typeof snippets.controlPlane === 'string', 'tokenSnippets.controlPlane')
    assert.ok(typeof snippets.tenant === 'string', 'tokenSnippets.tenant')
  })
})

// ---------------------------------------------------------------------------
// k3d:status --json schema contract
// ---------------------------------------------------------------------------

describe('k3d status --json schema', () => {
  it('the status.sh --json output shape matches the documented contract', () => {
    // We verify the status script contains the documented JSON fields in its
    // node -e block so agent consumers can rely on them being stable.
    assert.match(statusScript, /clusterRunning/)
    assert.match(statusScript, /stateValid/)
    assert.match(statusScript, /stateFile/)
    assert.match(statusScript, /components/)
    assert.match(statusScript, /controlPlane/)
    assert.match(statusScript, /keycloak/)
    assert.match(statusScript, /postgres/)
    assert.match(statusScript, /tenantNamespace/)
    // namespace in the JSON output comes from the state — verify it is not re-derived
    assert.doesNotMatch(
      statusScript,
      /`tenant-\$\{.*subdomain.*\}`/,
      'status.sh must not re-derive namespace from subdomain',
    )
  })
})
