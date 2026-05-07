#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
PLATFORM_NAMESPACE="dnd-notes-platform"
STATE_FILE="${K3D_STATE_FILE:-${ROOT}/.k3d-state/state.json}"
STATE_DIR="$(dirname "${STATE_FILE}")"

KEEP_CLUSTER=false
JSON_OUTPUT=false

usage() {
  cat <<'EOF'
Tear down the local k3d platform.

By default deletes the k3d cluster entirely, removes .k3d-state/state.json,
and removes the default .k3d-state/ directory only when it is empty.

Flags:
  --keep-cluster   Delete only the tenant namespace(s) and control-plane
                   deployment; keep the cluster, ingress, Postgres, and
                   Keycloak running (faster reset cycle).
  --json           Print a machine-readable JSON teardown summary on stdout.
  --help           Show this help and exit

Environment overrides:
  K3D_CLUSTER_NAME
  K3D_STATE_FILE
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
  local name="$1"
  k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fx "${name}" >/dev/null
}

state_module() {
  node "${ROOT}/scripts/k3d/state.mjs" "$@"
}

# Read a top-level scalar field from the state file.
# Returns empty string on any error (missing file, invalid JSON, missing key).
read_state_field() {
  local field="$1"

  if [[ ! -f "${STATE_FILE}" ]]; then
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  state_module read-safe "${STATE_FILE}" "${field}" 2>/dev/null || true
  return 0
}

# Read the first tenant's namespace from the state file (schema v1 uses
# a tenants[] array; schema v0 used a flat tenantNamespace field).
read_tenant_namespace() {
  if [[ ! -f "${STATE_FILE}" ]]; then
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  node -e '
    const fs = require("node:fs")
    try {
      const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      // v1 schema: tenants array
      if (Array.isArray(state.tenants) && state.tenants.length > 0) {
        const ns = state.tenants[0].namespace
        if (ns) { process.stdout.write(ns); process.exit(0) }
      }
      // v0 back-compat: flat tenantNamespace field
      if (state.tenantNamespace) {
        process.stdout.write(state.tenantNamespace)
      }
    } catch {}
  ' "${STATE_FILE}" 2>/dev/null || true
  return 0
}

remove_state_artifacts() {
  rm -f "${STATE_FILE}"

  if [[ "${STATE_DIR}" == "${ROOT}/.k3d-state" ]]; then
    rmdir "${STATE_DIR}" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "${arg}" in
    --keep-cluster) KEEP_CLUSTER=true ;;
    --json)         JSON_OUTPUT=true ;;
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

require_tool k3d

# Determine the target cluster name: use K3D_CLUSTER_NAME if explicitly set,
# otherwise try to read from state.json, finally fall back to "dnd-notes".
if [[ -n "${K3D_CLUSTER_NAME:-}" ]]; then
  CLUSTER_NAME="${K3D_CLUSTER_NAME}"
else
  state_cluster="$(read_state_field clusterName)"
  CLUSTER_NAME="${state_cluster:-dnd-notes}"
fi

if [[ "${KEEP_CLUSTER}" == "true" ]]; then
  # -------------------------------------------------------------------------
  # Soft teardown: remove only tenant namespace(s) and control-plane workload
  # -------------------------------------------------------------------------
  require_tool kubectl

  if ! cluster_exists "${CLUSTER_NAME}"; then
    log "Cluster ${CLUSTER_NAME} does not exist — nothing to tear down."
    exit 0
  fi

  target_kube_context="k3d-${CLUSTER_NAME}"

  # Read the persisted tenant namespace directly — never re-derive from subdomain.
  tenant_namespace="$(read_tenant_namespace)"

  if [[ -n "${tenant_namespace}" ]]; then
    log "Deleting tenant namespace '${tenant_namespace}'..."
    kubectl --context "${target_kube_context}" delete namespace "${tenant_namespace}" \
      --ignore-not-found=true \
      --wait=false \
      --timeout=30s
  else
    log "No readable tenant namespace in state file; scanning for tenant-* namespaces..."
    while IFS= read -r ns; do
      if [[ "${ns}" == tenant-* ]]; then
        log "Deleting namespace '${ns}'..."
        kubectl --context "${target_kube_context}" delete namespace "${ns}" \
          --ignore-not-found=true \
          --wait=false \
          --timeout=30s
      fi
    done < <(kubectl --context "${target_kube_context}" get namespaces --no-headers -o custom-columns='NAME:.metadata.name' 2>/dev/null || true)
  fi

  log "Removing control-plane deployment from ${PLATFORM_NAMESPACE}..."
  kubectl --context "${target_kube_context}" delete deployment dnd-notes-control-plane \
    -n "${PLATFORM_NAMESPACE}" \
    --ignore-not-found=true

  remove_state_artifacts
  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    node -e '
      const [clusterName] = process.argv.slice(1)
      process.stdout.write(JSON.stringify({ teardown: "soft", clusterName, clusterDeleted: false, stateRemoved: true }, null, 2) + "\n")
    ' "${CLUSTER_NAME}"
  else
    log "Done. Cluster, Postgres, ingress, and Keycloak are still running."
    log "Run 'npm run k3d:up' to re-provision."
  fi
else
  # -------------------------------------------------------------------------
  # Full teardown: delete the cluster
  # -------------------------------------------------------------------------
  if ! cluster_exists "${CLUSTER_NAME}"; then
    log "Cluster ${CLUSTER_NAME} does not exist — nothing to tear down."
    remove_state_artifacts
    if [[ "${JSON_OUTPUT}" == "true" ]]; then
      node -e '
        const [clusterName] = process.argv.slice(1)
        process.stdout.write(JSON.stringify({ teardown: "full", clusterName, clusterDeleted: false, stateRemoved: true, note: "cluster did not exist" }, null, 2) + "\n")
      ' "${CLUSTER_NAME}"
    fi
    exit 0
  fi

  log "Deleting k3d cluster '${CLUSTER_NAME}'..."
  k3d cluster delete "${CLUSTER_NAME}"
  remove_state_artifacts
  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    node -e '
      const [clusterName] = process.argv.slice(1)
      process.stdout.write(JSON.stringify({ teardown: "full", clusterName, clusterDeleted: true, stateRemoved: true }, null, 2) + "\n")
    ' "${CLUSTER_NAME}"
  else
    log "Done. Run 'npm run k3d:up' to start fresh."
  fi
fi
