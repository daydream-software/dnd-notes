#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
STATE_FILE="${K3D_STATE_FILE:-${ROOT}/.k3d-state/state.json}"
LOCAL_PORT="${K3D_CUSTOMER_PORTAL_OVERRIDE_LOCAL_PORT:-5174}"
PROXY_PORT="${K3D_CUSTOMER_PORTAL_OVERRIDE_LISTEN_PORT:-38081}"
CHECK_ONLY="${K3D_CUSTOMER_PORTAL_OVERRIDE_CHECK_ONLY:-false}"
WORK_DIR="${ROOT}/.k3d-smoke-work/customer-portal-override"

portal_pid=""
proxy_pid=""

usage() {
  cat <<'EOF'
Run the customer-portal live override workflow.

Starts `apps/customer-portal` locally in watch mode and exposes a proxy
at http://<tenant>.127.0.0.1.nip.io:38081 where the portal is local but
talks to the k3d tenant API.

Environment overrides:
  K3D_STATE_FILE
  K3D_CUSTOMER_PORTAL_OVERRIDE_LOCAL_PORT
  K3D_CUSTOMER_PORTAL_OVERRIDE_LISTEN_PORT
  K3D_CUSTOMER_PORTAL_OVERRIDE_CHECK_ONLY=true
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

wait_for_http() {
  local url="$1"
  local timeout="${2:-60}"
  local deadline=$((SECONDS + timeout))

  while (( SECONDS < deadline )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  log "Timed out waiting for ${url}"
  return 1
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

cleanup() {
  local exit_code=$?
  set +e

  for pid in "${proxy_pid}" "${portal_pid}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1
      wait "${pid}" 2>/dev/null
    fi
  done

  if (( exit_code == 0 )) && [[ "${CHECK_ONLY}" == "true" ]]; then
    rm -rf "${WORK_DIR}"
  else
    log "Preserved customer-portal override logs in ${WORK_DIR}"
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for tool in curl node npm; do
  require_tool "$tool"
done

if [[ ! -f "${STATE_FILE}" ]]; then
  log "State file ${STATE_FILE} not found. Run npm run k3d:up first."
  exit 1
fi

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

cluster_name="$(json_get clusterName <"${STATE_FILE}")"
keycloak_url="$(json_get keycloakUrl <"${STATE_FILE}")"
keycloak_realm="$(json_get keycloakRealm <"${STATE_FILE}")"
tenant_subdomain="$(json_get tenantSubdomain <"${STATE_FILE}")"
tenant_hostname="$(json_get tenantHostname <"${STATE_FILE}")"
tenant_origin="$(json_get tenantOrigin <"${STATE_FILE}")"

proxy_origin="http://${tenant_hostname}:${PROXY_PORT}"

env_js="$(cat <<EOF
window.__ENV__ = {
  API_BASE_PATH: "/portal-api",
  KEYCLOAK_URL: "${keycloak_url}",
  KEYCLOAK_REALM: "${keycloak_realm}",
  KEYCLOAK_CLIENT_ID: "dnd-notes-tenant-app"
};
EOF
)"

log "Starting local customer-portal..."
env \
  PORT="${LOCAL_PORT}" \
  VITE_PORTAL_API_BASE_PATH="/portal-api" \
  VITE_PORTAL_DEV_PROXY_TARGET="${tenant_origin}" \
  npm run dev --workspace apps/customer-portal -- --port "${LOCAL_PORT}" \
  >"${WORK_DIR}/customer-portal.log" 2>&1 &
portal_pid=$!

wait_for_http "http://127.0.0.1:${LOCAL_PORT}" 60

log "Starting portal override proxy..."
env \
  K3D_PORTAL_OVERRIDE_LISTEN_PORT="${PROXY_PORT}" \
  K3D_PORTAL_OVERRIDE_K3D_API_ORIGIN="${tenant_origin}" \
  K3D_PORTAL_OVERRIDE_LOCAL_VITE_ORIGIN="http://127.0.0.1:${LOCAL_PORT}" \
  K3D_PORTAL_OVERRIDE_API_PATH="/portal-api" \
  K3D_PORTAL_OVERRIDE_ENV_JS="${env_js}" \
  node "${ROOT}/scripts/k3d/portal-override-proxy.js" \
  >"${WORK_DIR}/portal-override-proxy.log" 2>&1 &
proxy_pid=$!

wait_for_http "${proxy_origin}/" 60
wait_for_http "${proxy_origin}/env.js" 60

if ! curl -fsS "${proxy_origin}/env.js" | grep -q '__ENV__'; then
  log "env.js injection check failed — proxy may be misconfigured"
  exit 1
fi

echo
echo "customer-portal live override is ready."
echo "- k3d cluster: ${cluster_name}"
echo "- Local portal: http://127.0.0.1:${LOCAL_PORT}"
echo "- Override origin: ${proxy_origin}"
echo "- API target: ${tenant_origin}"
echo

if [[ "${CHECK_ONLY}" == "true" ]]; then
  exit 0
fi

log "Streaming logs (Ctrl+C to stop)..."
tail -f "${WORK_DIR}/customer-portal.log" "${WORK_DIR}/portal-override-proxy.log"
