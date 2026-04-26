#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
PLATFORM_NAMESPACE="dnd-notes-platform"
K3D_HTTP_PORT="${K3D_HTTP_PORT:-8080}"
TENANT_PUBLIC_SCHEME="${TENANT_PUBLIC_SCHEME:-http}"
STATE_DIR="${ROOT}/.k3d-state"
STATE_FILE="${STATE_DIR}/state.json"

# Flags
OUTPUT_JSON="${K3D_STATUS_JSON:-false}"

usage() {
  cat <<'EOF'
Show the status of the local k3d platform for dnd-notes.

Usage:
  npm run k3d:status [-- [options]]

Options:
  --json    Machine-readable output (reads state.json + queries cluster).
  --help    Show this help.

Environment overrides:
  K3D_CLUSTER_NAME
  K3D_HTTP_PORT
  K3D_STATUS_JSON=true
EOF
}

log() {
  echo "$*" >&2
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required tool: $1"
    exit 1
  fi
}

# Read a dotted-path value from JSON piped on stdin.
# Returns empty string (and exits 0) when the path does not exist.
json_get_optional() {
  local path="$1"

  node -e '
    const fs = require("node:fs")
    const path = process.argv[1].split(".")
    let value
    try {
      value = JSON.parse(fs.readFileSync(0, "utf8"))
    } catch (_) {
      process.stdout.write("")
      process.exit(0)
    }
    for (const segment of path) {
      value = value?.[segment]
    }
    if (value === undefined) {
      process.stdout.write("")
      process.exit(0)
    }
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value))
  ' "$path"
}

# Parse flags
for arg in "$@"; do
  case "${arg}" in
    --json)  OUTPUT_JSON=true ;;
    --help)  usage; exit 0 ;;
    *) log "Unknown argument: ${arg}"; usage; exit 1 ;;
  esac
done

for tool in k3d kubectl node; do
  require_tool "$tool"
done

# ---- Read persisted state ---------------------------------------------------

if [[ ! -f "${STATE_FILE}" ]]; then
  if [[ "${OUTPUT_JSON}" == "true" ]]; then
    node -e 'process.stdout.write(JSON.stringify({up: false, reason: "state file not found"}))'
  else
    echo "k3d platform is not up (no state file at ${STATE_FILE})."
    echo "Run: npm run k3d:up"
  fi
  exit 0
fi

raw_state="$(cat "${STATE_FILE}")" || raw_state=""

# Validate JSON; recover gracefully on corrupt/truncated state.
if ! node -e 'JSON.parse(require("node:fs").readFileSync(0,"utf8"))' <<<"${raw_state}" 2>/dev/null; then
  if [[ "${OUTPUT_JSON}" == "true" ]]; then
    node -e 'process.stdout.write(JSON.stringify({up: false, reason: "state file corrupt or truncated"}))'
  else
    log "Warning: ${STATE_FILE} is corrupt or truncated."
    echo "k3d platform state is unreadable. Run: npm run k3d:down && npm run k3d:up"
  fi
  exit 0
fi

# Read fields — namespace is taken directly from state, never re-derived.
stored_cluster_name="$(json_get_optional "clusterName" <<<"${raw_state}")"
tenant_id="$(json_get_optional "tenant.id" <<<"${raw_state}")"
tenant_subdomain="$(json_get_optional "tenant.subdomain" <<<"${raw_state}")"
tenant_namespace="$(json_get_optional "tenant.namespace" <<<"${raw_state}")"
tenant_hostname="$(json_get_optional "tenant.hostname" <<<"${raw_state}")"

# ---- Query cluster ----------------------------------------------------------

cluster_running="false"
if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fxq "${stored_cluster_name:-${CLUSTER_NAME}}" 2>/dev/null; then
  cluster_running="true"
fi

control_plane_ready="unknown"
tenant_deployment_ready="unknown"

if [[ "${cluster_running}" == "true" ]]; then
  kubectl config use-context "k3d-${stored_cluster_name:-${CLUSTER_NAME}}" >/dev/null 2>&1 || true

  control_plane_ready="$(
    kubectl get deployment dnd-notes-control-plane \
      -n "${PLATFORM_NAMESPACE}" \
      -o jsonpath='{.status.readyReplicas}' \
      2>/dev/null || echo "0"
  )"
  control_plane_ready="${control_plane_ready:-0}"

  if [[ -n "${tenant_namespace}" ]]; then
    tenant_deployment_ready="$(
      kubectl get deployment dnd-notes \
        -n "${tenant_namespace}" \
        -o jsonpath='{.status.readyReplicas}' \
        2>/dev/null || echo "0"
    )"
    tenant_deployment_ready="${tenant_deployment_ready:-0}"
  fi
fi

tenant_origin="${TENANT_PUBLIC_SCHEME:-http}://${tenant_hostname}:${K3D_HTTP_PORT}"

# ---- Output -----------------------------------------------------------------

if [[ "${OUTPUT_JSON}" == "true" ]]; then
  node -e '
    const [
      clusterName, clusterRunning,
      controlPlaneReady,
      tenantId, tenantSubdomain, tenantNamespace, tenantHostname,
      tenantOrigin, tenantDeploymentReady,
    ] = process.argv.slice(1)

    const status = {
      up: clusterRunning === "true",
      clusterName,
      controlPlane: {
        readyReplicas: Number(controlPlaneReady) || 0,
      },
      tenant: {
        id: tenantId || null,
        subdomain: tenantSubdomain || null,
        namespace: tenantNamespace || null,
        hostname: tenantHostname || null,
        origin: tenantOrigin || null,
        readyReplicas: Number(tenantDeploymentReady) || 0,
      },
    }
    process.stdout.write(JSON.stringify(status))
  ' \
    "${stored_cluster_name:-${CLUSTER_NAME}}" \
    "${cluster_running}" \
    "${control_plane_ready}" \
    "${tenant_id}" \
    "${tenant_subdomain}" \
    "${tenant_namespace}" \
    "${tenant_hostname}" \
    "${tenant_origin}" \
    "${tenant_deployment_ready}"
else
  echo
  echo "================================================"
  echo "  k3d platform status"
  echo "================================================"
  echo "  Cluster:             k3d-${stored_cluster_name:-${CLUSTER_NAME}} (running: ${cluster_running})"
  echo "  Control-plane pods:  ${control_plane_ready} ready"
  echo "  Tenant ID:           ${tenant_id:-n/a}"
  echo "  Tenant namespace:    ${tenant_namespace:-n/a}"
  echo "  Tenant URL:          ${tenant_origin:-n/a}"
  echo "  Tenant pods:         ${tenant_deployment_ready} ready"
  echo "================================================"
fi
