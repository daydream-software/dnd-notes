import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const smokeScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/smoke.sh', import.meta.url),
)

const smokeScript = readFileSync(smokeScriptPath, 'utf8')
const payloadBuilderMatch = smokeScript.match(/^build_tenant_create_payload\(\) \{\n[\s\S]*?^}/m)

if (!payloadBuilderMatch) {
  throw new Error('Expected build_tenant_create_payload() in scripts/k3d/smoke.sh')
}

describe('k3d smoke tenant payload builder', () => {
  it('emits valid JSON for curl request bodies', () => {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `${payloadBuilderMatch[0]}\nbuild_tenant_create_payload "$TENANT_ID" "$TENANT_SLUG" "$TENANT_TAG"`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TENANT_ID: 'smoke-1',
          TENANT_SLUG: 'smoke-1',
          TENANT_TAG: 'k3d"build\\tag',
        },
      },
    )

    assert.strictEqual(result.status, 0, result.stderr)
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      id: 'smoke-1',
      slug: 'smoke-1',
      ownerId: 'smoke-owner',
      version: 'k3d"build\\tag',
    })
  })
})
