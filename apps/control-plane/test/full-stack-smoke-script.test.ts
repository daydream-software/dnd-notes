import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const fullStackSmokeScriptPath = fileURLToPath(
  new URL('../../../scripts/k3d/full-stack-smoke.sh', import.meta.url),
)

const fullStackSmokeScript = readFileSync(fullStackSmokeScriptPath, 'utf8')

describe('k3d full-stack smoke control-plane secret setup', () => {
  it('replaces the placeholder control-plane secret after applying the kustomize overlay', () => {
    const overlayApplyIndex = fullStackSmokeScript.indexOf(
      'run_visible kubectl apply -k "${ROOT}/deploy/k3s/overlays/k3d"',
    )
    const secretReplaceIndex = fullStackSmokeScript.indexOf(
      'kubectl create secret generic dnd-notes-control-plane-secrets',
    )
    const rolloutRestartIndex = fullStackSmokeScript.indexOf(
      'run_visible kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane',
    )
    const rolloutStatusIndex = fullStackSmokeScript.indexOf(
      'run_visible kubectl rollout status -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane --timeout=240s',
    )

    assert.notStrictEqual(overlayApplyIndex, -1, 'expected overlay apply command')
    assert.notStrictEqual(secretReplaceIndex, -1, 'expected secret replacement command')
    assert.notStrictEqual(rolloutRestartIndex, -1, 'expected rollout restart command')
    assert.notStrictEqual(rolloutStatusIndex, -1, 'expected rollout status command')
    assert.ok(
      secretReplaceIndex > overlayApplyIndex,
      'expected real secret replacement after applying the overlay placeholders',
    )
    assert.ok(
      rolloutRestartIndex > secretReplaceIndex,
      'expected rollout restart after replacing the secret',
    )
    assert.ok(
      rolloutStatusIndex > rolloutRestartIndex,
      'expected rollout status to wait on the restarted deployment',
    )
  })
})
