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

# Flags
KEEP_CLUSTER="${K3D_KEEP_CLUSTER:-false}"

usage() {
  cat <<'EOF'
Tear down the local k3d platform for dnd-notes.

Usage:
  npm run k3d:down [-- [options]]

Options:
  --keep-cluster    Only delete tenant namespaces and the control-plane
                    deployment; keep the cluster infrastructure (faster reset).
  --help            Show this help.

Environment overrides:
  K3D_CLUSTER_NAME
  K3D_KEEP_CLUSTER=true
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

# Read namespace from state without re-deriving it from subdomain.
read_tenant_namespace_from_state() {
  if [[ ! -f "${STATE_FILE}" ]]; then
    echo ""
    return 0
  fi

  local raw
  raw="$(cat "${STATE_FILE}")" || { echo ""; return 0; }

  if ! node -e 'JSON.parse(require("node:fs").readFileSync(0,"utf8"))' <<<"${raw}" 2>/dev/null; then
    log "Warning: ${STATE_FILE} is corrupt or truncated — skipping namespace cleanup from state."
    echo ""
    return 0
  fi

  node -e '
    const fs = require("node:fs")
    const path = process.argv[1].split(".")
    let value = JSON.parse(fs.readFileSync(0, "utf8"))
    for (const segment of path) {
      value = value?.[segment]
    }
    if (value === undefined) {
      process.exit(0)
    }
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value))
  ' "tenant.namespace" <<<"${raw}" || echo ""
}

# Parse flags
for arg in "$@"; do
  case "${arg}" in
    --keep-cluster) KEEP_CLUSTER=true ;;
    --help)         usage; exit 0 ;;
    *) log "Unknown argument: ${arg}"; usage; exit 1 ;;
  esac
done

for tool in k3d kubectl; do
  require_tool "$tool"
done

if [[ "${KEEP_CLUSTER}" == "true" ]]; then
  log "==> --keep-cluster: removing tenant namespaces and control-plane deployment only."

  # Read stored namespace — preserve it; do not re-derive from subdomain.
  stored_tenant_namespace="$(read_tenant_namespace_from_state)"

  if [[ -n "${stored_tenant_namespace}" ]]; then
    log "==> Deleting tenant namespace ${stored_tenant_namespace}..."
    kubectl delete namespace "${stored_tenant_namespace}" --ignore-not-found=true
  else
    log "==> No tenant namespace found in state; skipping tenant namespace deletion."
    # Attempt to find any tenant- namespaces as a best-effort cleanup.
    while IFS= read -r ns; do
      [[ -z "${ns}" ]] && continue
      log "==> Deleting tenant namespace ${ns} (discovered)..."
      kubectl delete namespace "${ns}" --ignore-not-found=true
    done < <(kubectl get namespaces --no-headers -o custom-columns=':metadata.name' 2>/dev/null | grep '^tenant-' || true)
  fi

  log "==> Removing control-plane deployment..."
  kubectl delete deployment dnd-notes-control-plane \
    -n "${PLATFORM_NAMESPACE}" \
    --ignore-not-found=true

  log "==> Removing state directory..."
  rm -rf "${STATE_DIR}"

  log "Partial teardown complete. Cluster infra retained."
else
  log "==> Deleting k3d cluster ${CLUSTER_NAME}..."
  k3d cluster delete "${CLUSTER_NAME}" 2>/dev/null || true

  log "==> Removing state directory..."
  rm -rf "${STATE_DIR}"

  log "Cluster ${CLUSTER_NAME} deleted."
fi
