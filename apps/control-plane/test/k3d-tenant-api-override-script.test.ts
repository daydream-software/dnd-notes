import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const tenantApiOverrideScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/tenant-api-override.sh', import.meta.url),
)

const tenantApiOverrideScript = readFileSync(tenantApiOverrideScriptPath, 'utf8')
const normalizeJwksUrlMatch = tenantApiOverrideScript.match(
  /^normalize_local_keycloak_jwks_url\(\) \{\n[\s\S]*?^}/m,
)

if (!normalizeJwksUrlMatch) {
  throw new Error(
    'Expected normalize_local_keycloak_jwks_url() in scripts/k3d/tenant-api-override.sh',
  )
}

function normalizeLocalKeycloakJwksUrl(jwksUrl: string) {
  const result = spawnSync(
    'bash',
    ['-lc', `${normalizeJwksUrlMatch[0]}\nnormalize_local_keycloak_jwks_url "$JWKS_URL"`],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        JWKS_URL: jwksUrl,
      },
    },
  )

  assert.strictEqual(result.status, 0, result.stderr)
  return result.stdout
}

describe('tenant API override Keycloak JWKS normalization', () => {
  it('drops in-cluster JWKS URLs so the local API falls back to the issuer certs endpoint', () => {
    assert.strictEqual(
      normalizeLocalKeycloakJwksUrl(
        'http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-dev/protocol/openid-connect/certs',
      ),
      '',
    )
  })

  it('keeps browser-reachable JWKS URLs for local overrides', () => {
    assert.strictEqual(
      normalizeLocalKeycloakJwksUrl(
        'http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev/protocol/openid-connect/certs',
      ),
      'http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev/protocol/openid-connect/certs',
    )
  })
})
