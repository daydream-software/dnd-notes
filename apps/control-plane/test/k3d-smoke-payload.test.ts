import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const smokeScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/smoke.sh', import.meta.url),
)

const smokeScript = readFileSync(smokeScriptPath, 'utf8')
const payloadBuilderMatch = smokeScript.match(/^build_tenant_create_payload\(\) \{\n[\s\S]*?^}/m)
const requestJsonToFileMatch = smokeScript.match(/^request_json_to_file\(\) \{\n[\s\S]*?^}/m)
const tenantReadyTimeoutMatch = smokeScript.match(
  /^resolve_tenant_ready_timeout_ms\(\) \{\n[\s\S]*?^}/m,
)

if (!payloadBuilderMatch) {
  throw new Error('Expected build_tenant_create_payload() in scripts/k3d/smoke.sh')
}

if (!requestJsonToFileMatch) {
  throw new Error('Expected request_json_to_file() in scripts/k3d/smoke.sh')
}

if (!tenantReadyTimeoutMatch) {
  throw new Error('Expected resolve_tenant_ready_timeout_ms() in scripts/k3d/smoke.sh')
}

describe('k3d smoke tenant payload builder', () => {
  it('emits valid JSON for curl request bodies', () => {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `${payloadBuilderMatch[0]}\nbuild_tenant_create_payload "$TENANT_ID" "$TENANT_SLUG" "$TENANT_TAG" "$TENANT_ADMIN_EMAIL"`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TENANT_ID: 'smoke-1',
          TENANT_SLUG: 'smoke-1',
          TENANT_TAG: 'k3d"build\\tag',
          TENANT_ADMIN_EMAIL: 'owner@example.com',
        },
      },
    )

    assert.strictEqual(result.status, 0, result.stderr)
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      id: 'smoke-1',
      slug: 'smoke-1',
      ownerId: 'smoke-owner',
      // initialAdminEmail is required so the provisioner can fall back
      // to a Keycloak admin user-by-email lookup when the portal_account
      // has no keycloak_sub yet (#196 / #200).
      initialAdminEmail: 'owner@example.com',
      version: 'k3d"build\\tag',
    })
  })
})

describe('k3d smoke request helper', () => {
  it('avoids Bash 3.2-incompatible negative-offset expansion', () => {
    assert.doesNotMatch(requestJsonToFileMatch[0], /\$\{\*:\s*-\d+\}/)
  })

  it('logs the failing request URL and response body for non-2xx responses', () => {
    const outputPath = join(
      fileURLToPath(new URL('.', import.meta.url)),
      `.request-json-to-file-${process.pid}.json`,
    )

    const result = spawnSync(
      'bash',
      [
        '-lc',
        `${requestJsonToFileMatch[0]}
curl() {
  local output_path=""
  while (( $# > 0 )); do
    case "$1" in
      -o)
        output_path="$2"
        shift 2
        ;;
      -w)
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  printf '%s' '{"error":"boom"}' > "$output_path"
  printf '503'
  return 0
}

request_json_to_file "$OUTPUT_PATH" -X POST -H 'Content-Type: application/json' -d '{}' 'https://example.test/internal/tenants'
`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          OUTPUT_PATH: outputPath,
        },
      },
    )

    rmSync(outputPath, { force: true })

    assert.strictEqual(result.status, 22)
    assert.match(
      result.stderr,
      /HTTP 503 response while calling https:\/\/example\.test\/internal\/tenants:/,
    )
    assert.match(result.stderr, /\{"error":"boom"\}/)
  })
})

describe('k3d smoke tenant ready timeout helper', () => {
  it('defaults to 240000ms and preserves explicit overrides', () => {
    const defaultEnv = { ...process.env }
    delete defaultEnv.TENANT_READY_TIMEOUT_MS

    const defaultResult = spawnSync(
      'bash',
      ['-lc', `${tenantReadyTimeoutMatch[0]}\nresolve_tenant_ready_timeout_ms`],
      {
        encoding: 'utf8',
        env: defaultEnv,
      },
    )

    assert.strictEqual(defaultResult.status, 0, defaultResult.stderr)
    assert.strictEqual(defaultResult.stdout.trim(), '240000')

    const overrideResult = spawnSync(
      'bash',
      ['-lc', `${tenantReadyTimeoutMatch[0]}\nresolve_tenant_ready_timeout_ms`],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TENANT_READY_TIMEOUT_MS: '90000',
        },
      },
    )

    assert.strictEqual(overrideResult.status, 0, overrideResult.stderr)
    assert.strictEqual(overrideResult.stdout.trim(), '90000')
  })
})
