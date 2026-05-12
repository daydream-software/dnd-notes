import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

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

const resetStateFnMatch = statusScript.match(/^reset_state\(\) \{\n[\s\S]*?^}/m)
const readStateFnMatch = statusScript.match(/^read_state\(\) \{\n[\s\S]*?^}/m)
const probeTenantUrlFnMatch = statusScript.match(/^probe_tenant_url\(\) \{\n[\s\S]*?^}/m)
const readStateFieldFnMatch = downScript.match(/^read_state_field\(\) \{\n[\s\S]*?^}/m)
const readTenantNamespaceFnMatch = downScript.match(/^read_tenant_namespace\(\) \{\n[\s\S]*?^}/m)
const removeStateArtifactsFnMatch = downScript.match(/^remove_state_artifacts\(\) \{\n[\s\S]*?^}/m)
const localizePostgresUrlMatch = upScript.match(/^localize_postgres_url\(\) \{\n[\s\S]*?^}/m)
const buildTokenSnippetFnMatch = upScript.match(/^build_token_snippet\(\) \{\n[\s\S]*?^}/m)
const stateModuleFnMatch = upScript.match(/^state_module\(\) \{\n[\s\S]*?^}/m)
const runK3dImageImportFnMatch = upScript.match(/^run_k3d_image_import\(\) \{\n[\s\S]*?^}/m)
const ensureImageImportedFnMatch = upScript.match(/^ensure_image_imported_into_cluster\(\) \{\n[\s\S]*?^}/m)
const ensureImageReadyFnMatch = upScript.match(/^ensure_image_ready\(\) \{\n[\s\S]*?^}/m)
const writeStateFnMatch = upScript.match(/^write_state\(\) \{\n[\s\S]*?^}/m)

if (!resetStateFnMatch) {
  throw new Error('Expected reset_state() in scripts/k3d/status.sh')
}

if (!readStateFnMatch) {
  throw new Error('Expected read_state() in scripts/k3d/status.sh')
}

if (!probeTenantUrlFnMatch) {
  throw new Error('Expected probe_tenant_url() in scripts/k3d/status.sh')
}

if (!readStateFieldFnMatch) {
  throw new Error('Expected read_state_field() in scripts/k3d/down.sh')
}

if (!readTenantNamespaceFnMatch) {
  throw new Error('Expected read_tenant_namespace() in scripts/k3d/down.sh')
}

if (!removeStateArtifactsFnMatch) {
  throw new Error('Expected remove_state_artifacts() in scripts/k3d/down.sh')
}

if (!localizePostgresUrlMatch) {
  throw new Error('Expected localize_postgres_url() in scripts/k3d/up.sh')
}

if (!buildTokenSnippetFnMatch) {
  throw new Error('Expected build_token_snippet() in scripts/k3d/up.sh')
}

if (!stateModuleFnMatch) {
  throw new Error('Expected state_module() in scripts/k3d/up.sh')
}

if (!runK3dImageImportFnMatch) {
  throw new Error('Expected run_k3d_image_import() in scripts/k3d/up.sh')
}

if (!ensureImageImportedFnMatch) {
  throw new Error('Expected ensure_image_imported_into_cluster() in scripts/k3d/up.sh')
}

if (!ensureImageReadyFnMatch) {
  throw new Error('Expected ensure_image_ready() in scripts/k3d/up.sh')
}

if (!writeStateFnMatch) {
  throw new Error('Expected write_state() in scripts/k3d/up.sh')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const readStateSnippet = `${resetStateFnMatch[0]}\n${readStateFnMatch[0]}`

function runBash(script: string, env?: NodeJS.ProcessEnv) {
  return spawnSync('bash', ['-c', script], {
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
      tenantClientId: 'dnd-notes-tenant-k3d-dev',
      siteAdminEmail: 'site-admin@example.com',
      siteAdminPassword: 'password',
      tenantOwnerEmail: 'owner@example.com',
      tenantOwnerPassword: 'password',
      tokenSnippets: { controlPlane: 'curl ...', tenant: 'curl ...' },
    }
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    const result = runBash(
      `${readStateSnippet}
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
      `${readStateSnippet}
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

  it('reads fields even when tokenSnippets contains escaped quotes', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'k3d-status-token-snippets-test-'))
    const stateFile = join(tmpDir, 'state.json')

    const state = {
      clusterName: 'quoted-cluster',
      tenantId: 'k3d-dev',
      tenantSubdomain: 'dev',
      tenantNamespace: 'tenant-platform-dev',
      tenantHostname: 'dev.127.0.0.1.nip.io',
      tenantOrigin: 'http://dev.127.0.0.1.nip.io:8080',
      keycloakUrl: 'http://keycloak.example.com:8080',
      keycloakRealm: 'quoted-realm',
      tokenSnippets: {
        controlPlane: 'curl -H "Authorization: Bearer abc\\"def"',
        tenant: 'curl -H "Authorization: Bearer xyz\\"uvw"',
      },
    }
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    let result: ReturnType<typeof runBash>
    try {
      result = runBash(
        `${readStateSnippet}
STATE_FILE="${stateFile}"
read_state
printf '%s|%s|%s' \
  "$state_clusterName" \
  "$state_tenantNamespace" \
  "$state_keycloakRealm"`,
      )
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(
      result.stdout,
      'quoted-cluster|tenant-platform-dev|quoted-realm',
      'read_state should parse the state file directly instead of routing raw JSON through shell argv',
    )
  })
})

// ---------------------------------------------------------------------------
// Corrupt / truncated state recovery
// ---------------------------------------------------------------------------

describe('k3d status read_state — corrupt state recovery', () => {
  it('returns non-zero for a missing state file', () => {
    const missingStateFile = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-status-missing-state-${process.pid}.json`,
    )

    const result = runBash(
      `${readStateSnippet}
STATE_FILE="${missingStateFile}"
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
      `${readStateSnippet}
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

  it('clears all state variables when the parser emits only a partial payload', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-partial-state-payload-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')
    const fakeBinDir = join(tmpDir, 'bin')
    const fakeNodePath = join(fakeBinDir, 'node')

    mkdirSync(fakeBinDir, { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ clusterName: 'fresh-cluster' }))
    writeFileSync(
      fakeNodePath,
      `#!/usr/bin/env bash
printf 'fresh-cluster\\0'
exit 1
`,
    )
    chmodSync(fakeNodePath, 0o755)

    const result = runBash(
      `${readStateSnippet}
state_clusterName="stale-cluster"
state_keycloakUrl="http://stale.example.com"
state_keycloakRealm="stale-realm"
state_tenantId="stale-tenant"
state_tenantSubdomain="stale-subdomain"
state_tenantNamespace="stale-namespace"
state_tenantHostname="stale-hostname"
state_tenantOrigin="http://stale-origin"
STATE_FILE="${stateFile}"
PATH="${fakeBinDir}:$PATH"
if read_state; then
  echo "should-not-reach"
  exit 1
fi
printf '%s|%s|%s|%s|%s|%s|%s|%s' \
  "$state_clusterName" \
  "$state_keycloakUrl" \
  "$state_keycloakRealm" \
  "$state_tenantId" \
  "$state_tenantSubdomain" \
  "$state_tenantNamespace" \
  "$state_tenantHostname" \
  "$state_tenantOrigin"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, '|||||||')
  })

  it('clears previously populated variables when a later read fails', () => {
    const missingStateFile = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-missing-state-${process.pid}.json`,
    )

    const result = runBash(
      `${readStateSnippet}
state_clusterName="stale-cluster"
state_keycloakUrl="http://stale.example.com"
state_keycloakRealm="stale-realm"
state_tenantId="stale-tenant"
state_tenantSubdomain="stale-subdomain"
state_tenantNamespace="stale-namespace"
state_tenantHostname="stale-hostname"
state_tenantOrigin="http://stale-origin"
STATE_FILE="${missingStateFile}"
if read_state; then
  echo "should-not-reach"
  exit 1
fi
printf '%s|%s|%s|%s|%s|%s|%s|%s' \
  "$state_clusterName" \
  "$state_keycloakUrl" \
  "$state_keycloakRealm" \
  "$state_tenantId" \
  "$state_tenantSubdomain" \
  "$state_tenantNamespace" \
  "$state_tenantHostname" \
  "$state_tenantOrigin"`,
    )

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, '|||||||')
  })
})

describe('k3d status probe_tenant_url', () => {
  it('skips the HTTP reachability probe when curl is unavailable', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-status-probe-test-${process.pid}`,
    )
    const fakeBinDir = join(tmpDir, 'bin')

    mkdirSync(fakeBinDir, { recursive: true })

    const result = runBash(
      `${probeTenantUrlFnMatch[0]}
tenant_url_reachable=true
tenant_url_probe_skipped=false
PATH="${fakeBinDir}"
probe_tenant_url "http://dev.127.0.0.1.nip.io:8080"
printf '%s|%s' "$tenant_url_reachable" "$tenant_url_probe_skipped"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'false|true')
  })
})

// ---------------------------------------------------------------------------
// read_tenant_namespace (down.sh) — namespace preservation
//
// In schema v1 the namespace lives in tenants[0].namespace; in v0 it was a
// flat tenantNamespace field. read_tenant_namespace handles both.
// ---------------------------------------------------------------------------

describe('k3d down read_state_field — namespace preservation', () => {
  it('reads tenantNamespace from v1 tenants[] array without re-deriving it', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-ns-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })

    // v1 schema: namespace is in tenants[0].namespace; subdomain is different
    // to prove no re-derivation occurs
    const state = {
      schemaVersion: 1,
      tenants: [{ id: 'k3d-dev', subdomain: 'dev', namespace: 'tenant-platform-dev' }],
    }
    writeFileSync(stateFile, JSON.stringify(state))

    const result = runBash(
      `${readTenantNamespaceFnMatch![0]}
STATE_FILE="${stateFile}"
ns="$(read_tenant_namespace)"
printf '%s' "$ns"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'tenant-platform-dev')
  })

  it('reads tenantNamespace from v0 flat field for back-compat', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-ns-v0-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })

    // v0 schema: flat tenantNamespace field
    const state = {
      tenantNamespace: 'tenant-platform-dev',
      tenantSubdomain: 'dev',
    }
    writeFileSync(stateFile, JSON.stringify(state))

    const result = runBash(
      `${readTenantNamespaceFnMatch![0]}
STATE_FILE="${stateFile}"
ns="$(read_tenant_namespace)"
printf '%s' "$ns"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'tenant-platform-dev')
  })

  it('returns empty string for a missing state file without error', () => {
    const missingStateFile = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-missing-state-${process.pid}.json`,
    )

    const result = runBash(
      `${readTenantNamespaceFnMatch![0]}
STATE_FILE="${missingStateFile}"
ns="$(read_tenant_namespace)"
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
      `${readTenantNamespaceFnMatch![0]}
STATE_FILE="${stateFile}"
ns="$(read_tenant_namespace)"
printf 'got:[%s]' "$ns"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'got:[]')
  })

  it('returns empty string without error when node is unavailable', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-no-node-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')
    const fakeBinDir = join(tmpDir, 'bin')

    mkdirSync(fakeBinDir, { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ tenants: [{ namespace: 'tenant-platform-dev' }] }))

    const result = runBash(
      `${readTenantNamespaceFnMatch![0]}
STATE_FILE="${stateFile}"
PATH="${fakeBinDir}"
ns="$(read_tenant_namespace)"
printf 'got:[%s]' "$ns"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'got:[]')
  })
})

describe('k3d down remove_state_artifacts', () => {
  it('removes only the configured state file when K3D_STATE_FILE points outside the default state dir', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-remove-state-test-${process.pid}`,
    )
    const rootDir = join(tmpDir, 'repo-root')
    const customStateDir = join(tmpDir, 'custom-state')
    const stateFile = join(customStateDir, 'state.json')
    const keepFile = join(customStateDir, 'keep.txt')

    mkdirSync(rootDir, { recursive: true })
    mkdirSync(customStateDir, { recursive: true })
    writeFileSync(stateFile, '{"clusterName":"dnd-notes"}')
    writeFileSync(keepFile, 'keep')

    const result = runBash(
      `${removeStateArtifactsFnMatch[0]}
ROOT="${rootDir}"
STATE_FILE="${stateFile}"
STATE_DIR="$(dirname "\${STATE_FILE}")"
remove_state_artifacts
printf '%s|%s|%s' \
  "$(test -f "\${STATE_FILE}" && echo file || echo missing)" \
  "$(test -d "\${STATE_DIR}" && echo dir || echo nodir)" \
  "$(test -f "\${STATE_DIR}/keep.txt" && echo keep || echo lost)"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'missing|dir|keep')
  })

  it('removes the empty default .k3d-state directory after deleting the state file', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-down-default-state-test-${process.pid}`,
    )
    const rootDir = join(tmpDir, 'repo-root')
    const stateDir = join(rootDir, '.k3d-state')
    const stateFile = join(stateDir, 'state.json')

    mkdirSync(stateDir, { recursive: true })
    writeFileSync(stateFile, '{"clusterName":"dnd-notes"}')

    const result = runBash(
      `${removeStateArtifactsFnMatch[0]}
ROOT="${rootDir}"
STATE_FILE="${stateFile}"
STATE_DIR="$(dirname "\${STATE_FILE}")"
remove_state_artifacts
printf '%s|%s' \
  "$(test -f "\${STATE_FILE}" && echo file || echo missing)" \
  "$(test -d "\${STATE_DIR}" && echo dir || echo nodir)"`,
    )

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'missing|nodir')
  })
})

describe('k3d down context handling', () => {
  it('uses --context instead of mutating the active kube context', () => {
    assert.match(downScript, /target_kube_context="k3d-\$\{CLUSTER_NAME\}"/)
    assert.match(downScript, /kubectl --context "\$\{target_kube_context\}" delete namespace/)
    assert.match(downScript, /kubectl --context "\$\{target_kube_context\}" get namespaces/)
    assert.match(downScript, /kubectl --context "\$\{target_kube_context\}" delete deployment/)
    assert.doesNotMatch(downScript, /kubectl config use-context/)
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

describe('k3d up ensure_image_ready', () => {
  it('re-imports cached local images into the active cluster when --no-rebuild skips docker builds', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-image-ready-test-${process.pid}`,
    )
    const fakeBinDir = join(tmpDir, 'bin')
    const logFile = join(tmpDir, 'invocations.log')

    mkdirSync(fakeBinDir, { recursive: true })
    writeFileSync(
      join(fakeBinDir, 'timeout'),
      `#!/usr/bin/env bash
printf 'timeout:%s\n' "$*" >> "$LOG_FILE"
seconds="$1"
shift
"$@"
`,
    )
    chmodSync(join(fakeBinDir, 'timeout'), 0o755)
    writeFileSync(
      join(fakeBinDir, 'k3d'),
      `#!/usr/bin/env bash
printf 'k3d:%s\n' "$*" >> "$LOG_FILE"
`,
    )
    chmodSync(join(fakeBinDir, 'k3d'), 0o755)

    const result = runBash(
      `${runK3dImageImportFnMatch[0]}
${ensureImageImportedFnMatch[0]}
${ensureImageReadyFnMatch[0]}
log() { :; }
run_visible() { printf 'build:%s\\n' "$*" >> "$LOG_FILE"; }
image_exists_locally() { return 0; }
CLUSTER_NAME="dnd-notes"
IMAGE_IMPORT_MODE="direct"
IMAGE_IMPORT_FALLBACK_MODE="tools"
IMAGE_IMPORT_TIMEOUT_SECONDS="180"
NO_REBUILD=true
ensure_image_ready "Tenant" "ghcr.io/daydream-software/dnd-notes:k3d" "/fake/build.sh"`,
      {
        LOG_FILE: logFile,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      },
    )

    const invocations = readFileSync(logFile, 'utf8')

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.doesNotMatch(invocations, /^build:/m)
    assert.match(
      invocations,
      /timeout:180 k3d image import --mode direct -c dnd-notes ghcr\.io\/daydream-software\/dnd-notes:k3d/,
    )
    assert.match(
      invocations,
      /k3d:image import --mode direct -c dnd-notes ghcr\.io\/daydream-software\/dnd-notes:k3d/,
    )
  })
})

describe('k3d up script guards', () => {
  it('guards the previous kube context lookup behind a kubectl availability check', () => {
    assert.match(
      upScript,
      /previous_kube_context=""[\s\S]*?if command -v kubectl >\/dev\/null 2>&1; then[\s\S]*?previous_kube_context="\$\(kubectl config current-context 2>\/dev\/null \|\| true\)"/,
    )
    assert.doesNotMatch(
      upScript,
      /^previous_kube_context="\$\(kubectl config current-context 2>\/dev\/null \|\| true\)"$/m,
    )
  })

  it('uses PLATFORM_NAMESPACE when constructing in-cluster Postgres service URLs', () => {
    assert.match(
      upScript,
      /platform-postgres\.\$\{PLATFORM_NAMESPACE\}\.svc\.cluster\.local/g,
    )
    assert.doesNotMatch(
      upScript,
      /platform-postgres\.dnd-notes-platform\.svc\.cluster\.local/,
    )
  })
})

// ---------------------------------------------------------------------------
// write_state (up.sh) — state.json schema contract
// ---------------------------------------------------------------------------

describe('k3d up write_state — stable JSON contract', () => {
  it('shell-quotes token snippet argv before persisting them in state.json', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-build-token-snippet-test-${process.pid}`,
    )
    const fakeBinDir = join(tmpDir, 'bin')
    const argsFile = join(tmpDir, 'curl-args.txt')

    mkdirSync(fakeBinDir, { recursive: true })
    writeFileSync(
      join(fakeBinDir, 'curl'),
      `#!/usr/bin/env bash
printf '%s\n' "$@" > "$ARGS_FILE"
printf '{"access_token":"stub-token"}'
`,
    )
    chmodSync(join(fakeBinDir, 'curl'), 0o755)

    const result = runBash(
      `ROOT="${repoRoot}"
${stateModuleFnMatch![0]}
${buildTokenSnippetFnMatch![0]}
snippet="$(build_token_snippet "http://keycloak.example.com:8080" "dnd-notes-dev" "client'id" "user\\"name" "pass'both\\"")"
bash -c "$snippet"`,
      {
        ARGS_FILE: argsFile,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      },
    )

    const curlArgs = readFileSync(argsFile, 'utf8').trim().split('\n')

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, 'stub-token')
    assert.deepStrictEqual(curlArgs, [
      '-fsS',
      '-X',
      'POST',
      '-H',
      'Content-Type: application/x-www-form-urlencoded',
      '--data-urlencode',
      'grant_type=password',
      '--data-urlencode',
      "client_id=client'id",
      '--data-urlencode',
      'username=user"name',
      '--data-urlencode',
      `password=pass'both"`,
      'http://keycloak.example.com:8080/realms/dnd-notes-dev/protocol/openid-connect/token',
    ])
  })

  it('writes a valid state.json with all required v1 fields including explicit tenantNamespace', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-write-state-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })

    const result = runBash(
      `ROOT="${repoRoot}"
${stateModuleFnMatch![0]}
${buildTokenSnippetFnMatch![0]}
${writeStateFnMatch![0]}
STATE_FILE="${stateFile}"
K3D_HTTP_PORT=8080
CONTROL_PLANE_PORT=3101
CONTROL_PLANE_KEYCLOAK_URL="http://keycloak.127.0.0.1.nip.io:8080"
CONTROL_PLANE_KEYCLOAK_REALM="dnd-notes-dev"
CONTROL_PLANE_KEYCLOAK_CLIENT_ID="dnd-notes-control-plane"
CONTROL_PLANE_KEYCLOAK_USERNAME="site-admin@example.com"
CONTROL_PLANE_KEYCLOAK_PASSWORD="password"
TENANT_KEYCLOAK_USERNAME="owner@example.com"
TENANT_KEYCLOAK_PASSWORD="password"
TENANT_PUBLIC_SCHEME="http"
CLUSTER_NAME="dnd-notes"
mkdir -p "${tmpDir}"
write_state "k3d-dev" "dev" "tenant-platform-dev" "dev.127.0.0.1.nip.io" "ready" >/dev/null
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

    // Schema v1 contract assertions
    assert.strictEqual(state.schemaVersion, 1, 'schemaVersion must be 1')
    assert.ok(typeof state.clusterName === 'string', 'clusterName')
    assert.ok(typeof state.controlPlanePort === 'number', 'controlPlanePort')
    assert.ok(typeof state.controlPlaneUrl === 'string', 'controlPlaneUrl')
    assert.ok(typeof state.ingressUrl === 'string', 'ingressUrl')

    // keycloak sub-object
    const keycloak = state.keycloak as Record<string, unknown>
    assert.ok(keycloak && typeof keycloak === 'object', 'keycloak sub-object')
    assert.ok(typeof keycloak.url === 'string', 'keycloak.url')
    assert.ok(typeof keycloak.realm === 'string', 'keycloak.realm')

    // auth sub-object
    const auth = state.auth as Record<string, unknown>
    assert.ok(auth && typeof auth === 'object', 'auth sub-object')
    assert.ok(typeof auth.siteAdminEmail === 'string', 'auth.siteAdminEmail')
    assert.ok(typeof auth.tenantOwnerEmail === 'string', 'auth.tenantOwnerEmail')

    // tenants array — the core invariant: namespace must be the value passed in, not derived
    const tenants = state.tenants as Record<string, unknown>[]
    assert.ok(Array.isArray(tenants) && tenants.length === 1, 'tenants array with one entry')
    const tenant = tenants[0]
    assert.strictEqual(tenant.id, 'k3d-dev', 'tenants[0].id')
    assert.strictEqual(tenant.subdomain, 'dev', 'tenants[0].subdomain')
    assert.strictEqual(tenant.namespace, 'tenant-platform-dev', 'tenants[0].namespace must be stored verbatim')
    assert.strictEqual(tenant.hostname, 'dev.127.0.0.1.nip.io', 'tenants[0].hostname')
    assert.ok(typeof tenant.origin === 'string', 'tenants[0].origin')
    assert.strictEqual(tenant.state, 'ready', 'tenants[0].state')

    // tokenSnippets
    assert.ok(state.tokenSnippets && typeof state.tokenSnippets === 'object', 'tokenSnippets')
    const snippets = state.tokenSnippets as Record<string, unknown>
    assert.ok(typeof snippets.controlPlane === 'string', 'tokenSnippets.controlPlane')
    assert.ok(typeof snippets.tenant === 'string', 'tokenSnippets.tenant')

    // permissions
    assert.strictEqual(statSync(tmpDir).mode & 0o777, 0o700, 'state dir permissions')
    assert.strictEqual(statSync(stateFile).mode & 0o777, 0o600, 'state file permissions')

    rmSync(tmpDir, { recursive: true, force: true })
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
    assert.match(statusScript, /urlProbeSkipped/)
    // namespace in the JSON output comes from the state — verify it is not re-derived
    assert.doesNotMatch(
      statusScript,
      /`tenant-\$\{.*subdomain.*\}`/,
      'status.sh must not re-derive namespace from subdomain',
    )
  })

  it('uses --context for live kubectl reads instead of switching the active kube context', () => {
    assert.match(statusScript, /kubectl --context "\$\{context\}" get deployment/)
    assert.match(statusScript, /target_kube_context="k3d-\$\{CLUSTER_NAME\}"/)
    assert.doesNotMatch(statusScript, /kubectl config use-context/)
  })

  it('reports the effective cluster name when K3D_CLUSTER_NAME env override is set', () => {
    const tmpDir = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.k3d-status-cluster-name-test-${process.pid}`,
    )
    const stateFile = join(tmpDir, 'state.json')

    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          clusterName: 'dnd-notes',
          tenantId: 'k3d-dev',
          tenantSubdomain: 'dev',
          tenantNamespace: 'tenant-platform-dev',
        },
        null,
        2,
      ),
    )

    const result = runBash(`bash "${statusScriptPath}" --json`, {
      K3D_CLUSTER_NAME: 'custom-cluster',
      K3D_STATE_FILE: stateFile,
    })

    rmSync(tmpDir, { recursive: true, force: true })

    assert.strictEqual(result.status, 0, result.stderr)

    let statusJson: Record<string, unknown>
    try {
      statusJson = JSON.parse(result.stdout)
    } catch {
      assert.fail(`status.sh did not produce valid JSON.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    }

    assert.strictEqual(
      statusJson.clusterName,
      'custom-cluster',
      'status.sh --json must report the effective cluster name when K3D_CLUSTER_NAME is set, not the persisted one',
    )
  })
})
