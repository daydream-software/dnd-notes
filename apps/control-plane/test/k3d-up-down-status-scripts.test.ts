import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const k3dUpScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/k3d-up.sh', import.meta.url),
)
const k3dDownScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/k3d-down.sh', import.meta.url),
)
const k3dStatusScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/k3d-status.sh', import.meta.url),
)

const k3dUpScript = readFileSync(k3dUpScriptPath, 'utf8')
const k3dDownScript = readFileSync(k3dDownScriptPath, 'utf8')
const k3dStatusScript = readFileSync(k3dStatusScriptPath, 'utf8')

// Extract the json_get helper from k3d-up.sh (used by read_persisted_state).
const jsonGetMatch = k3dUpScript.match(/^json_get\(\) \{\n[\s\S]*?^}/m)

// Extract the read_persisted_state function from k3d-up.sh for unit testing.
const readPersistedStateMatch = k3dUpScript.match(
  /^read_persisted_state\(\) \{\n[\s\S]*?^}/m,
)

// Extract the read_tenant_namespace_from_state function from k3d-down.sh.
const readTenantNamespaceFromStateMatch = k3dDownScript.match(
  /^read_tenant_namespace_from_state\(\) \{\n[\s\S]*?^}/m,
)

// Extract the json_get_optional function from k3d-status.sh.
const jsonGetOptionalMatch = k3dStatusScript.match(
  /^json_get_optional\(\) \{\n[\s\S]*?^}/m,
)

if (!jsonGetMatch) {
  throw new Error('Expected json_get() in scripts/k3d/k3d-up.sh')
}
if (!readPersistedStateMatch) {
  throw new Error('Expected read_persisted_state() in scripts/k3d/k3d-up.sh')
}
if (!readTenantNamespaceFromStateMatch) {
  throw new Error(
    'Expected read_tenant_namespace_from_state() in scripts/k3d/k3d-down.sh',
  )
}
if (!jsonGetOptionalMatch) {
  throw new Error('Expected json_get_optional() in scripts/k3d/k3d-status.sh')
}

// State JSON with a custom tenant namespace that differs from the default
// "tenant-{subdomain}" pattern — this is the regression case.
const stateWithCustomNamespace = JSON.stringify({
  clusterName: 'dnd-notes',
  controlPlaneUrl: 'http://127.0.0.1:3101',
  tenant: {
    id: 'dev',
    subdomain: 'dev',
    namespace: 'tenant-platform-dev',
    hostname: 'dev.127.0.0.1.nip.io',
    keycloak: {
      url: 'http://keycloak.127.0.0.1.nip.io:8080',
      realm: 'dnd-notes-dev',
      clients: { tenantApp: 'dnd-notes-tenant-app' },
    },
    credentials: {
      owner: { email: 'owner@example.com', password: 'password' },
    },
  },
})

function makeTempStatePath(): string {
  return `/tmp/k3d-state-test-${process.pid}-${Date.now()}.json`
}

describe('k3d-up read_persisted_state', () => {
  it('preserves an explicitly stored custom tenant namespace — does not re-derive from subdomain', () => {
    const stateFile = makeTempStatePath()
    writeFileSync(stateFile, stateWithCustomNamespace, 'utf8')

    try {
      const script = `
${jsonGetMatch![0]}
${readPersistedStateMatch![0]}

STATE_FILE="${stateFile}"
tenant_id=""
tenant_subdomain=""
tenant_namespace=""
tenant_hostname=""

read_persisted_state

printf '%s' "\${tenant_namespace}"
`
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

      assert.strictEqual(result.status, 0, result.stderr)
      // Must preserve "tenant-platform-dev", not normalize to "tenant-dev".
      assert.strictEqual(result.stdout, 'tenant-platform-dev')
      assert.notStrictEqual(result.stdout, 'tenant-dev')
    } finally {
      rmSync(stateFile, { force: true })
    }
  })

  it('returns exit code 1 for corrupt JSON', () => {
    const stateFile = makeTempStatePath()
    writeFileSync(stateFile, '{not valid json}', 'utf8')

    try {
      const script = `
${jsonGetMatch![0]}
${readPersistedStateMatch![0]}

STATE_FILE="${stateFile}"
tenant_id=""
tenant_subdomain=""
tenant_namespace=""
tenant_hostname=""

if read_persisted_state; then
  exit 0
else
  exit 1
fi
`
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

      assert.strictEqual(result.status, 1, 'expected non-zero exit for corrupt JSON')
    } finally {
      rmSync(stateFile, { force: true })
    }
  })

  it('returns exit code 1 when state file is missing', () => {
    const script = `
${jsonGetMatch![0]}
${readPersistedStateMatch![0]}

STATE_FILE="/tmp/no-such-k3d-state-file-$$"

if read_persisted_state; then
  exit 0
else
  exit 1
fi
`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

    assert.strictEqual(result.status, 1, 'expected non-zero exit when state file is missing')
  })
})

describe('k3d-down read_tenant_namespace_from_state', () => {
  it('returns the stored namespace without re-deriving it from subdomain', () => {
    const stateFile = makeTempStatePath()
    writeFileSync(stateFile, stateWithCustomNamespace, 'utf8')

    try {
      const script = `
${readTenantNamespaceFromStateMatch![0]}

STATE_FILE="${stateFile}"
result="$(read_tenant_namespace_from_state)"
printf '%s' "\${result}"
`
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

      assert.strictEqual(result.status, 0, result.stderr)
      assert.strictEqual(result.stdout, 'tenant-platform-dev')
      assert.notStrictEqual(result.stdout, 'tenant-dev')
    } finally {
      rmSync(stateFile, { force: true })
    }
  })

  it('returns empty string for corrupt JSON without exiting non-zero', () => {
    const stateFile = makeTempStatePath()
    writeFileSync(stateFile, '<<corrupt>>', 'utf8')

    try {
      const script = `
${readTenantNamespaceFromStateMatch![0]}

STATE_FILE="${stateFile}"
result="$(read_tenant_namespace_from_state)"
printf '%s' "\${result}"
`
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

      assert.strictEqual(result.status, 0, result.stderr)
      assert.strictEqual(result.stdout, '')
    } finally {
      rmSync(stateFile, { force: true })
    }
  })

  it('returns empty string when state file is absent without exiting non-zero', () => {
    const script = `
${readTenantNamespaceFromStateMatch![0]}

STATE_FILE="/tmp/no-such-k3d-down-state-$$"
result="$(read_tenant_namespace_from_state)"
printf '%s' "\${result}"
`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, '')
  })
})

describe('k3d-status json_get_optional', () => {
  it('reads tenant.namespace from state without re-deriving it', () => {
    const stateFile = makeTempStatePath()
    writeFileSync(stateFile, stateWithCustomNamespace, 'utf8')

    try {
      const script = `
${jsonGetOptionalMatch![0]}

result="$(json_get_optional "tenant.namespace" <"${stateFile}")"
printf '%s' "\${result}"
`
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

      assert.strictEqual(result.status, 0, result.stderr)
      assert.strictEqual(result.stdout, 'tenant-platform-dev')
    } finally {
      rmSync(stateFile, { force: true })
    }
  })

  it('returns empty string (not error) for corrupt JSON', () => {
    const stateFile = makeTempStatePath()
    writeFileSync(stateFile, 'not-json', 'utf8')

    try {
      const script = `
${jsonGetOptionalMatch![0]}

result="$(json_get_optional "tenant.namespace" <"${stateFile}")"
printf '%s' "\${result}"
`
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

      assert.strictEqual(result.status, 0, result.stderr)
      assert.strictEqual(result.stdout, '')
    } finally {
      rmSync(stateFile, { force: true })
    }
  })

  it('returns empty string for missing key', () => {
    const stateFile = makeTempStatePath()
    writeFileSync(stateFile, stateWithCustomNamespace, 'utf8')

    try {
      const script = `
${jsonGetOptionalMatch![0]}

result="$(json_get_optional "tenant.nonexistent" <"${stateFile}")"
printf '%s' "\${result}"
`
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })

      assert.strictEqual(result.status, 0, result.stderr)
      assert.strictEqual(result.stdout, '')
    } finally {
      rmSync(stateFile, { force: true })
    }
  })
})

describe('k3d scripts --help flags', () => {
  it('k3d-up.sh --help exits 0', () => {
    const result = spawnSync('bash', [k3dUpScriptPath, '--help'], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0)
    assert.match(result.stdout, /--no-rebuild/)
    assert.match(result.stdout, /--reset-tenant/)
    assert.match(result.stdout, /--no-tenant/)
    assert.match(result.stdout, /--json/)
  })

  it('k3d-down.sh --help exits 0', () => {
    const result = spawnSync('bash', [k3dDownScriptPath, '--help'], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0)
    assert.match(result.stdout, /--keep-cluster/)
  })

  it('k3d-status.sh --help exits 0', () => {
    const result = spawnSync('bash', [k3dStatusScriptPath, '--help'], {
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0)
    assert.match(result.stdout, /--json/)
  })
})
