#!/usr/bin/env bash
set -euo pipefail

# Render-parity guard for the unified deploy/k3s tree (epic #362 / issue #363).
#
# Builds both overlays (k3d + prod) and asserts that the STRUCTURAL key set is
# identical across them — the same ConfigMap data keys, the same workload set
# (Deployments, Services, the activator CronJob), and the same RBAC objects.
# Environment-specific VALUES are expected to differ (hosts, realms, issuers);
# only missing/extra KEYS or RESOURCES fail the check. This catches the
# "dropped key" regression class (#363): a config key present in one overlay but
# silently absent in the other.
#
# Guardrail documented here and enforced structurally: no overlay may replace a
# base ConfigMap's whole data map, nor run a configMapGenerator with replace
# behavior on a base-defined ConfigMap. Overlays patch per-key only. A wholesale
# data-map replacement that drops a key would be caught by this check.

ROOT="$(git rev-parse --show-toplevel)"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

require_tool node

# Prefer standalone kustomize; fall back to `kubectl kustomize`.
render() {
  local overlay="$1"
  if command -v kustomize >/dev/null 2>&1; then
    kustomize build "${overlay}"
  elif command -v kubectl >/dev/null 2>&1; then
    kubectl kustomize "${overlay}"
  else
    echo "Neither kustomize nor kubectl is available to render manifests." >&2
    exit 1
  fi
}

# Renders are large (thousands of lines); pass them through temp files rather
# than the environment (argv/env size limits).
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/render-parity.XXXXXX")"
trap 'rm -rf "${TMP_DIR}"' EXIT

render "${ROOT}/deploy/k3s/overlays/k3d" > "${TMP_DIR}/k3d.yaml"
render "${ROOT}/deploy/k3s/overlays/prod" > "${TMP_DIR}/prod.yaml"

node "${ROOT}/scripts/platform/render-parity.mjs" "${TMP_DIR}/k3d.yaml" "${TMP_DIR}/prod.yaml"
