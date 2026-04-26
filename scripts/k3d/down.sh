#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
PLATFORM_NAMESPACE="dnd-notes-platform"
STATE_DIR="${ROOT}/.k3d-state"
STATE_FILE="${STATE_DIR}/state.json"

KEEP_CLUSTER=false

usage() {
  cat <<'EOF'
Tear down the local k3d platform.

By default deletes the k3d cluster entirely and removes .k3d-state/.

Flags:
  --keep-cluster   Delete only the tenant namespace(s) and control-plane
                   deployment; keep the cluster, ingress, Postgres, and
                   Keycloak running (faster reset cycle).
  --help           Show this help and exit

Environment overrides:
  K3D_CLUSTER_NAME
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

cluster_exists() {
  k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fx "${CLUSTER_NAME}" >/dev/null
}

json_get() {
  local path="$1"

  node -e '
    const fs = require("node:fs")
    const path = process.argv[1].split(".")
    let value = JSON.parse(fs.readFileSync(0, "utf8"))
    for (const segment of path) {
      value = value?.[segment]
    }
    if (value === undefined) {
      process.exit(1)
    }
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value))
  ' "$path"
}

# Read a field from the state file. Returns empty string on any error (missing
# file, invalid JSON, missing key) without aborting the script.
read_state_field() {
  local field="$1"

  if [[ ! -f "${STATE_FILE}" ]]; then
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  node -e '
    const fs = require("node:fs")
    const field = process.argv[1]
    try {
      const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
      const value = state[field]
      if (value !== null && value !== undefined) {
        process.stdout.write(String(value))
      }
    } catch {
      // corrupt or truncated state — silently ignore
    }
  ' "${field}" "${STATE_FILE}" 2>/dev/null || true

  return 0
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "${arg}" in
    --keep-cluster) KEEP_CLUSTER=true ;;
    --help)
      usage
      exit 0
      ;;
    *)
      log "Unknown argument: ${arg}"
      usage
      exit 1
      ;;
  esac
done

for tool in k3d kubectl; do
  require_tool "$tool"
done

if [[ "${KEEP_CLUSTER}" == "true" ]]; then
  # -------------------------------------------------------------------------
  # Soft teardown: remove only tenant namespace(s) and control-plane workload
  # -------------------------------------------------------------------------
  if ! cluster_exists; then
    log "Cluster ${CLUSTER_NAME} does not exist — nothing to tear down."
    exit 0
  fi

  kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

  # Read the persisted tenant namespace directly — never re-derive from subdomain.
  tenant_namespace="$(read_state_field tenantNamespace)"

  if [[ -n "${tenant_namespace}" ]]; then
    log "Deleting tenant namespace '${tenant_namespace}'..."
    kubectl delete namespace "${tenant_namespace}" --ignore-not-found=true
  else
    log "No readable tenant namespace in state file; scanning for tenant-* namespaces..."
    while IFS= read -r ns; do
      if [[ "${ns}" == tenant-* ]]; then
        log "Deleting namespace '${ns}'..."
        kubectl delete namespace "${ns}" --ignore-not-found=true
      fi
    done < <(kubectl get namespaces --no-headers -o custom-columns='NAME:.metadata.name' 2>/dev/null || true)
  fi

  log "Removing control-plane deployment from ${PLATFORM_NAMESPACE}..."
  kubectl delete deployment dnd-notes-control-plane \
    -n "${PLATFORM_NAMESPACE}" \
    --ignore-not-found=true

  rm -rf "${STATE_DIR}"
  log "Done. Cluster, Postgres, ingress, and Keycloak are still running."
  log "Run 'npm run k3d:up' to re-provision."
else
  # -------------------------------------------------------------------------
  # Full teardown: delete the cluster
  # -------------------------------------------------------------------------
  if ! cluster_exists; then
    log "Cluster ${CLUSTER_NAME} does not exist — nothing to tear down."
    rm -rf "${STATE_DIR}"
    exit 0
  fi

  log "Deleting k3d cluster '${CLUSTER_NAME}'..."
  k3d cluster delete "${CLUSTER_NAME}"
  rm -rf "${STATE_DIR}"
  log "Done. Run 'npm run k3d:up' to start fresh."
fi
