#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
STATE_FILE="${K3D_STATE_FILE:-${ROOT}/.k3d-state/state.json}"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
K3D_HTTP_PORT="${K3D_HTTP_PORT:-8080}"
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-127.0.0.1.nip.io}"
CONTROL_PLANE_KEYCLOAK_URL="${CONTROL_PLANE_KEYCLOAK_URL:-http://keycloak.127.0.0.1.nip.io:${K3D_HTTP_PORT}}"
CONTROL_PLANE_KEYCLOAK_REALM="${CONTROL_PLANE_KEYCLOAK_REALM:-dnd-notes-dev}"
TENANT_KEYCLOAK_URL="${TENANT_KEYCLOAK_URL:-${CONTROL_PLANE_KEYCLOAK_URL}}"
TENANT_KEYCLOAK_REALM="${TENANT_KEYCLOAK_REALM:-${CONTROL_PLANE_KEYCLOAK_REALM}}"
TENANT_KEYCLOAK_CLIENT_ID="${TENANT_KEYCLOAK_CLIENT_ID:-dnd-notes-tenant-app}"
TENANT_KEYCLOAK_USERNAME="${TENANT_KEYCLOAK_USERNAME:-owner@example.com}"
TENANT_KEYCLOAK_PASSWORD="${TENANT_KEYCLOAK_PASSWORD:-password}"
LOCAL_API_PORT="${K3D_TENANT_OVERRIDE_LOCAL_API_PORT:-3001}"
PROXY_PORT="${K3D_TENANT_OVERRIDE_LISTEN_PORT:-38080}"
POSTGRES_LOCAL_PORT="${POSTGRES_LOCAL_PORT:-55432}"
PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-dnd-notes-platform}"
CHECK_ONLY="${K3D_TENANT_API_OVERRIDE_CHECK_ONLY:-false}"
WORK_DIR="${ROOT}/.k3d-smoke-work/tenant-api-override"
previous_kube_context="$(kubectl config current-context 2>/dev/null || true)"
api_pid=""
postgres_forward_pid=""
proxy_pid=""

usage() {
  cat <<'EOF'
Run the supported tenant-api live override workflow for issue #79.

The script reads the dev tenant from .k3d-state/state.json (written by
k3d:up), starts `apps/api` locally in watch mode against that tenant's
runtime config, and exposes a same-origin front proxy where tenant web stays
on k3d while `/api/*` is routed to the local API.

To target a specific tenant namespace/subdomain instead of the one written by
k3d:up, set K3D_TENANT_OVERRIDE_NAMESPACE and K3D_TENANT_OVERRIDE_SUBDOMAIN.

Environment overrides:
  K3D_STATE_FILE                    path to state.json (default: .k3d-state/state.json)
  K3D_CLUSTER_NAME
  K3D_HTTP_PORT
  TENANT_BASE_DOMAIN
  K3D_TENANT_OVERRIDE_LOCAL_API_PORT
  K3D_TENANT_OVERRIDE_LISTEN_PORT
  K3D_TENANT_OVERRIDE_NAMESPACE     override tenant namespace (skips state.json lookup)
  K3D_TENANT_OVERRIDE_SUBDOMAIN     override tenant subdomain (skips state.json lookup)
  K3D_TENANT_API_OVERRIDE_CHECK_ONLY=true
EOF
}

log() {
  echo "$*" >&2
}

state_module() {
  node "${ROOT}/scripts/k3d/state.mjs" "$@"
}

normalize_headers() {
  tr -d '\r' <"$1"
}

normalize_local_keycloak_jwks_url() {
  local jwks_url="${1:-}"

  if [[ -z "${jwks_url}" ]]; then
    return 0
  fi

  if node -e '
    const rawUrl = process.argv[1]?.trim()

    if (!rawUrl) {
      process.exit(1)
    }

    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase()
      const isInClusterHostname =
        hostname.endsWith(".svc") ||
        hostname.includes(".svc.") ||
        hostname.endsWith(".cluster.local")

      process.exit(isInClusterHostname ? 0 : 1)
    } catch {
      process.exit(1)
    }
  ' "${jwks_url}"; then
    return 0
  fi

  printf '%s' "${jwks_url}"
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

wait_for_tcp() {
  local port="$1"
  local timeout="${2:-30}"
  local deadline=$((SECONDS + timeout))

  while (( SECONDS < deadline )); do
    if (echo > "/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  log "Timed out waiting for TCP port ${port}"
  return 1
}

localize_postgres_url() {
  local raw_url="$1"
  local local_port="$2"

  node -e '
    const [rawUrl, localPort] = process.argv.slice(1)
    const url = new URL(rawUrl)
    url.hostname = "127.0.0.1"
    url.port = localPort
    process.stdout.write(url.toString())
  ' "${raw_url}" "${local_port}"
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

decode_secret_value() {
  local path="$1"

  node -e '
    const fs = require("node:fs")
    const path = process.argv[1].split(".")
    let value = JSON.parse(fs.readFileSync(0, "utf8"))
    for (const segment of path) {
      value = value?.[segment]
    }
    if (typeof value !== "string") {
      process.exit(1)
    }
    process.stdout.write(Buffer.from(value, "base64").toString("utf8"))
  ' "$path"
}

get_keycloak_access_token() {
  local base_url="$1"
  local realm="$2"
  local client_id="$3"
  local username="$4"
  local password="$5"

  curl -fsS \
    -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "grant_type=password" \
    --data-urlencode "client_id=${client_id}" \
    --data-urlencode "username=${username}" \
    --data-urlencode "password=${password}" \
    "${base_url}/realms/${realm}/protocol/openid-connect/token" \
    | json_get access_token
}

cleanup() {
  local exit_code=$?
  set +e

  for pid in "${proxy_pid}" "${api_pid}" "${postgres_forward_pid}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1
      wait "${pid}" 2>/dev/null
    fi
  done

  if [[ -n "${previous_kube_context}" ]]; then
    kubectl config use-context "${previous_kube_context}" >/dev/null 2>&1
  fi

  if (( exit_code == 0 )) && [[ "${CHECK_ONLY}" == "true" ]]; then
    rm -rf "${WORK_DIR}"
  else
    log "Preserved tenant override logs in ${WORK_DIR}"
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for tool in kubectl curl node npm; do
  require_tool "$tool"
done

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

tenant_namespace="${K3D_TENANT_OVERRIDE_NAMESPACE:-}"
tenant_subdomain="${K3D_TENANT_OVERRIDE_SUBDOMAIN:-}"

if [[ -z "${tenant_namespace}" || -z "${tenant_subdomain}" ]]; then
  if [[ ! -f "${STATE_FILE}" ]]; then
    log "State file ${STATE_FILE} not found. Run npm run k3d:up first."
    exit 1
  fi
  # Read tenant fields from state.json written by k3d:up.
  eval "$(state_module read-vars "${STATE_FILE}")"
fi

tenant_hostname="${tenant_subdomain}.${TENANT_BASE_DOMAIN}"
tenant_origin="http://${tenant_hostname}:${K3D_HTTP_PORT}"
proxy_origin="http://${tenant_hostname}:${PROXY_PORT}"

kubectl -n "${tenant_namespace}" get configmap dnd-notes-runtime -o json \
  >"${WORK_DIR}/tenant-configmap.json"

raw_database_url="$(
  kubectl -n "${tenant_namespace}" get secret dnd-notes-runtime-secret -o json \
    | decode_secret_value data.DATABASE_URL
)"

# Port-forward platform-postgres so the locally-running API can reach it.
# The forward stays alive for the lifetime of this script (cleanup() kills it).
log "Port-forwarding platform-postgres to 127.0.0.1:${POSTGRES_LOCAL_PORT}..."
kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/platform-postgres \
  "${POSTGRES_LOCAL_PORT}:5432" \
  >"${WORK_DIR}/postgres-port-forward.log" 2>&1 &
postgres_forward_pid=$!

wait_for_tcp "${POSTGRES_LOCAL_PORT}" 30

database_url="$(localize_postgres_url "${raw_database_url}" "${POSTGRES_LOCAL_PORT}")"
auth_mode="$(json_get data.AUTH_MODE <"${WORK_DIR}/tenant-configmap.json" 2>/dev/null || true)"
keycloak_url="$(json_get data.KEYCLOAK_URL <"${WORK_DIR}/tenant-configmap.json" 2>/dev/null || true)"
keycloak_realm="$(json_get data.KEYCLOAK_REALM <"${WORK_DIR}/tenant-configmap.json" 2>/dev/null || true)"
keycloak_client_id="$(json_get data.KEYCLOAK_TENANT_CLIENT_ID <"${WORK_DIR}/tenant-configmap.json" 2>/dev/null || true)"
keycloak_jwks_url="$(json_get data.KEYCLOAK_JWKS_URL <"${WORK_DIR}/tenant-configmap.json" 2>/dev/null || true)"
keycloak_jwks_url_for_local_api="$(normalize_local_keycloak_jwks_url "${keycloak_jwks_url}")"

env \
  PORT="${LOCAL_API_PORT}" \
  DATABASE_URL="${database_url}" \
  PUBLIC_WEB_URL="${proxy_origin}" \
  ALLOWED_ORIGINS="${proxy_origin}" \
  AUTH_MODE="${auth_mode}" \
  KEYCLOAK_URL="${keycloak_url}" \
  KEYCLOAK_REALM="${keycloak_realm}" \
  KEYCLOAK_TENANT_CLIENT_ID="${keycloak_client_id}" \
  KEYCLOAK_JWKS_URL="${keycloak_jwks_url_for_local_api}" \
  npm run dev --workspace apps/api \
  >"${WORK_DIR}/tenant-api.log" 2>&1 &
api_pid=$!

wait_for_http "http://127.0.0.1:${LOCAL_API_PORT}/ready" 120

env \
  K3D_TENANT_OVERRIDE_LISTEN_PORT="${PROXY_PORT}" \
  K3D_TENANT_OVERRIDE_TENANT_ORIGIN="${tenant_origin}" \
  K3D_TENANT_OVERRIDE_LOCAL_API_ORIGIN="http://127.0.0.1:${LOCAL_API_PORT}" \
  node "${ROOT}/scripts/k3d/tenant-api-override-proxy.js" \
  >"${WORK_DIR}/tenant-api-override-proxy.log" 2>&1 &
proxy_pid=$!

wait_for_http "${proxy_origin}/" 60
wait_for_http "${proxy_origin}/api/auth/config" 60

curl -fsS "${tenant_origin}/" >"${WORK_DIR}/upstream-root.html"
curl -fsS -D "${WORK_DIR}/proxy-root.headers" "${proxy_origin}/" >"${WORK_DIR}/proxy-root.html"
cmp -s "${WORK_DIR}/upstream-root.html" "${WORK_DIR}/proxy-root.html"
normalize_headers "${WORK_DIR}/proxy-root.headers" \
  | grep -qi '^x-dnd-notes-override-target: tenant-cluster$'

curl -fsS "http://127.0.0.1:${LOCAL_API_PORT}/api/auth/config" >"${WORK_DIR}/local-auth-config.json"
curl -fsS -D "${WORK_DIR}/proxy-auth-config.headers" "${proxy_origin}/api/auth/config" >"${WORK_DIR}/proxy-auth-config.json"
cmp -s "${WORK_DIR}/local-auth-config.json" "${WORK_DIR}/proxy-auth-config.json"
normalize_headers "${WORK_DIR}/proxy-auth-config.headers" \
  | grep -qi '^x-dnd-notes-override-target: local-api$'

tenant_bearer_token="$(get_keycloak_access_token \
  "${TENANT_KEYCLOAK_URL}" \
  "${TENANT_KEYCLOAK_REALM}" \
  "${TENANT_KEYCLOAK_CLIENT_ID}" \
  "${TENANT_KEYCLOAK_USERNAME}" \
  "${TENANT_KEYCLOAK_PASSWORD}")"

curl -fsS \
  -D "${WORK_DIR}/proxy-session.headers" \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "${proxy_origin}/api/auth/session" \
  >"${WORK_DIR}/proxy-session.json"
# /api/auth/session updates the user's last-seen timestamp on each call, so a
# byte-equal comparison between local and proxy responses is non-deterministic.
# We rely on the override-target header below to confirm the proxy routes here.
normalize_headers "${WORK_DIR}/proxy-session.headers" \
  | grep -qi '^x-dnd-notes-override-target: local-api$'

curl -fsS \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "http://127.0.0.1:${LOCAL_API_PORT}/api/campaigns" \
  >"${WORK_DIR}/local-campaigns.json"
curl -fsS \
  -D "${WORK_DIR}/proxy-campaigns.headers" \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "${proxy_origin}/api/campaigns" \
  >"${WORK_DIR}/proxy-campaigns.json"
cmp -s "${WORK_DIR}/local-campaigns.json" "${WORK_DIR}/proxy-campaigns.json"
normalize_headers "${WORK_DIR}/proxy-campaigns.headers" \
  | grep -qi '^x-dnd-notes-override-target: local-api$'

echo
echo "tenant-api live override is ready."
echo "- Tenant namespace: ${tenant_namespace}"
echo "- Tenant k3d origin: ${tenant_origin}"
echo "- Tenant override origin: ${proxy_origin}"
echo "- Local API: http://127.0.0.1:${LOCAL_API_PORT}"
echo "- Proof: '/' stayed on k3d while '/api/*' matched the local API responses."

if [[ "${CHECK_ONLY}" == "true" ]]; then
  exit 0
fi

wait "${api_pid}" "${proxy_pid}"
