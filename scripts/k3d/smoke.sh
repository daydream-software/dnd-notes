#!/usr/bin/env bash
set -Eeuo pipefail

# macOS still ships Bash 3.2, which does not support inherit_errexit.
if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
PLATFORM_NAMESPACE="dnd-notes-platform"
K3D_HTTP_PORT="${K3D_HTTP_PORT:-8080}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-3101}"
POSTGRES_LOCAL_PORT="${POSTGRES_LOCAL_PORT:-55432}"
TENANT_LOCAL_PORT="${TENANT_LOCAL_PORT:-38080}"
TENANT_IMAGE_REPOSITORY="${TENANT_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes}"
TENANT_IMAGE_TAG="${TENANT_IMAGE_TAG:-k3d}"
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-127.0.0.1.nip.io}"
TENANT_PUBLIC_SCHEME="${TENANT_PUBLIC_SCHEME:-http}"
TENANT_DATABASE_RUNTIME_URL="${TENANT_DATABASE_RUNTIME_URL:-postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/postgres}"
CONTROL_PLANE_KEYCLOAK_URL="${CONTROL_PLANE_KEYCLOAK_URL:-http://keycloak.127.0.0.1.nip.io:${K3D_HTTP_PORT}}"
CONTROL_PLANE_KEYCLOAK_REALM="${CONTROL_PLANE_KEYCLOAK_REALM:-dnd-notes-dev}"
CONTROL_PLANE_KEYCLOAK_CLIENT_ID="${CONTROL_PLANE_KEYCLOAK_CLIENT_ID:-dnd-notes-control-plane}"
CONTROL_PLANE_KEYCLOAK_USERNAME="${CONTROL_PLANE_KEYCLOAK_USERNAME:-site-admin@example.com}"
CONTROL_PLANE_KEYCLOAK_PASSWORD="${CONTROL_PLANE_KEYCLOAK_PASSWORD:-password}"
CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES="${CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES:-control-plane-admin,control-plane-workforce}"
TENANT_KEYCLOAK_URL="${TENANT_KEYCLOAK_URL:-${CONTROL_PLANE_KEYCLOAK_URL}}"
TENANT_KEYCLOAK_REALM="${TENANT_KEYCLOAK_REALM:-${CONTROL_PLANE_KEYCLOAK_REALM}}"
TENANT_KEYCLOAK_JWKS_URL="${TENANT_KEYCLOAK_JWKS_URL:-http://platform-keycloak.${PLATFORM_NAMESPACE}.svc.cluster.local:8080/realms/${TENANT_KEYCLOAK_REALM}/protocol/openid-connect/certs}"
TENANT_KEYCLOAK_CLIENT_ID="${TENANT_KEYCLOAK_CLIENT_ID:-dnd-notes-tenant-app}"
TENANT_KEYCLOAK_USERNAME="${TENANT_KEYCLOAK_USERNAME:-owner@example.com}"
TENANT_KEYCLOAK_PASSWORD="${TENANT_KEYCLOAK_PASSWORD:-password}"
KEEP_TENANT="${KEEP_K3D_SMOKE_TENANT:-false}"
WORK_DIR="${ROOT}/.k3d-smoke-work"
previous_kube_context="$(kubectl config current-context 2>/dev/null || true)"
failed_command=""
failed_line=""

control_plane_pid=""
postgres_forward_pid=""
tenant_forward_pid=""
tenant_id=""
control_plane_bearer_token=""

tenant_bearer_token=""

usage() {
  cat <<'EOF'
Run the live k3d smoke path for issue #63.

What it does:
  1. Bootstraps the local k3d platform dependencies
  2. Builds/imports the tenant runtime image into k3d
  3. Runs the control plane locally against the k3d kube context
  4. Creates and provisions a tenant through the control-plane API using a Keycloak workforce token
  5. Verifies tenant readiness plus tenant /api/auth/session and /api/campaigns with a Keycloak tenant token

Environment overrides:
  K3D_CLUSTER_NAME
  K3D_HTTP_PORT
  CONTROL_PLANE_PORT
  POSTGRES_LOCAL_PORT
  TENANT_LOCAL_PORT
  TENANT_IMAGE_REPOSITORY
  TENANT_IMAGE_TAG
  TENANT_BASE_DOMAIN
  TENANT_PUBLIC_SCHEME
  TENANT_DATABASE_RUNTIME_URL
  CONTROL_PLANE_KEYCLOAK_URL
  CONTROL_PLANE_KEYCLOAK_REALM
  CONTROL_PLANE_KEYCLOAK_CLIENT_ID
  CONTROL_PLANE_KEYCLOAK_USERNAME
  CONTROL_PLANE_KEYCLOAK_PASSWORD
  TENANT_KEYCLOAK_URL
  TENANT_KEYCLOAK_REALM
  TENANT_KEYCLOAK_JWKS_URL
  TENANT_KEYCLOAK_CLIENT_ID
  TENANT_KEYCLOAK_USERNAME
  TENANT_KEYCLOAK_PASSWORD
  KEEP_K3D_SMOKE_TENANT=true   Keep the provisioned tenant for debugging
EOF
}

record_failure() {
  local _exit_code="$1"
  failed_command="${BASH_COMMAND}"
  failed_line="${BASH_LINENO[0]:-}"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

wait_for_tcp() {
  local port="$1"
  local timeout="${2:-30}"
  local deadline=$((SECONDS + timeout))

  while (( SECONDS < deadline )); do
    if bash -c "</dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for TCP port ${port}" >&2
  return 1
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

  echo "Timed out waiting for ${url}" >&2
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

get_json_array_length() {
  node -e '
    const fs = require("node:fs")
    const value = JSON.parse(fs.readFileSync(0, "utf8"))
    process.stdout.write(String(Array.isArray(value) ? value.length : 0))
  '
}

build_tenant_create_payload() {
  local tenant_id="$1"
  local tenant_slug="$2"
  local tenant_image_tag="$3"

  node -e '
    const [tenantId, tenantSlug, tenantImageTag] = process.argv.slice(1)
    process.stdout.write(JSON.stringify({
      id: tenantId,
      slug: tenantSlug,
      ownerId: "smoke-owner",
      version: tenantImageTag,
    }))
  ' "$tenant_id" "$tenant_slug" "$tenant_image_tag"
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

  if [[ -n "${tenant_id}" && "${KEEP_TENANT}" != "true" ]]; then
    if curl -fsS "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" >/dev/null 2>&1; then
      curl -fsS \
        -X POST \
        -H "Authorization: Bearer ${control_plane_bearer_token}" \
        -H 'Content-Type: application/json' \
        -d '{"triggeredBy":"k3d-smoke","reason":"smoke cleanup"}' \
        "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${tenant_id}/deprovision" \
        >/dev/null 2>&1
    fi
  fi

  for pid in "${tenant_forward_pid}" "${postgres_forward_pid}" "${control_plane_pid}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1
      wait "${pid}" 2>/dev/null
    fi
  done

  if (( exit_code != 0 )) && [[ -f "${WORK_DIR}/control-plane.log" ]]; then
    echo >&2
    echo "k3d smoke failed with exit code ${exit_code}." >&2
    if [[ -n "${failed_command}" ]]; then
      if [[ -n "${failed_line}" ]]; then
        echo "Failed command (around line ${failed_line}): ${failed_command}" >&2
      else
        echo "Failed command: ${failed_command}" >&2
      fi
    fi
    echo >&2
    echo "Control-plane log (tail):" >&2
    tail -n 200 "${WORK_DIR}/control-plane.log" >&2
  fi

  if [[ -n "${previous_kube_context}" ]]; then
    kubectl config use-context "${previous_kube_context}" >/dev/null 2>&1
  fi

  if (( exit_code == 0 )); then
    rm -rf "${WORK_DIR}"
  else
    echo >&2
    echo "Preserved k3d smoke logs in ${WORK_DIR}" >&2
  fi

  exit "${exit_code}"
}

trap 'record_failure $?' ERR
trap cleanup EXIT

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for tool in docker k3d kubectl curl node; do
  require_tool "$tool"
done

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

"${ROOT}/scripts/k3d/bootstrap.sh"
"${ROOT}/scripts/k3d/build-tenant-image.sh"

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/platform-postgres \
  "${POSTGRES_LOCAL_PORT}:5432" \
  >"${WORK_DIR}/postgres-port-forward.log" 2>&1 &
postgres_forward_pid=$!

wait_for_tcp "${POSTGRES_LOCAL_PORT}" 30
wait_for_http "${CONTROL_PLANE_KEYCLOAK_URL}/realms/${CONTROL_PLANE_KEYCLOAK_REALM}" 60

env \
  PORT="${CONTROL_PLANE_PORT}" \
  DATABASE_PATH="${WORK_DIR}/control-plane.sqlite" \
  CONTROL_PLANE_AUTH_MODE=keycloak \
  CONTROL_PLANE_KEYCLOAK_URL="${CONTROL_PLANE_KEYCLOAK_URL}" \
  CONTROL_PLANE_KEYCLOAK_REALM="${CONTROL_PLANE_KEYCLOAK_REALM}" \
  CONTROL_PLANE_KEYCLOAK_CLIENT_ID="${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
  CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES="${CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES}" \
  CONTROL_PLANE_ENABLE_PROVISIONING=true \
  TENANT_AUTH_MODE=keycloak \
  TENANT_KEYCLOAK_URL="${TENANT_KEYCLOAK_URL}" \
  TENANT_KEYCLOAK_REALM="${TENANT_KEYCLOAK_REALM}" \
  TENANT_KEYCLOAK_JWKS_URL="${TENANT_KEYCLOAK_JWKS_URL}" \
  TENANT_KEYCLOAK_CLIENT_ID="${TENANT_KEYCLOAK_CLIENT_ID}" \
  TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN}" \
  TENANT_IMAGE_REPOSITORY="${TENANT_IMAGE_REPOSITORY}" \
  TENANT_DATABASE_ADMIN_URL="postgresql://postgres:postgres@127.0.0.1:${POSTGRES_LOCAL_PORT}/postgres" \
  TENANT_DATABASE_RUNTIME_URL="${TENANT_DATABASE_RUNTIME_URL}" \
  TENANT_PUBLIC_SCHEME="${TENANT_PUBLIC_SCHEME}" \
  TENANT_APP_PORT=3000 \
  TENANT_READY_TIMEOUT_MS=120000 \
  node --import tsx "${ROOT}/apps/control-plane/src/index.ts" \
  >"${WORK_DIR}/control-plane.log" 2>&1 &
control_plane_pid=$!

wait_for_http "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" 60
control_plane_bearer_token="$(get_keycloak_access_token \
  "${CONTROL_PLANE_KEYCLOAK_URL}" \
  "${CONTROL_PLANE_KEYCLOAK_REALM}" \
  "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
  "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
  "${CONTROL_PLANE_KEYCLOAK_PASSWORD}")"

tenant_id="smoke-$(date +%s)"
tenant_slug="${tenant_id}"

curl -fsS \
  -X POST \
  -H "Authorization: Bearer ${control_plane_bearer_token}" \
  -H 'Content-Type: application/json' \
  -d "$(build_tenant_create_payload "${tenant_id}" "${tenant_slug}" "${TENANT_IMAGE_TAG}")" \
  "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants" \
  >"${WORK_DIR}/tenant-create.json"

curl -fsS \
  -X POST \
  -H "Authorization: Bearer ${control_plane_bearer_token}" \
  -H 'Content-Type: application/json' \
  -d '{"triggeredBy":"k3d-smoke","reason":"live k3d smoke"}' \
  "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${tenant_id}/provision" \
  >"${WORK_DIR}/tenant-provision.json"

tenant_namespace="$(json_get resources.namespace <"${WORK_DIR}/tenant-provision.json")"
tenant_subdomain="$(json_get tenant.subdomain <"${WORK_DIR}/tenant-provision.json")"

kubectl rollout status -n "${tenant_namespace}" deployment/dnd-notes --timeout=180s

kubectl -n "${tenant_namespace}" port-forward \
  service/dnd-notes \
  "${TENANT_LOCAL_PORT}:3000" \
  >"${WORK_DIR}/tenant-port-forward.log" 2>&1 &
tenant_forward_pid=$!

wait_for_http "http://127.0.0.1:${TENANT_LOCAL_PORT}/ready" 60
tenant_bearer_token="$(get_keycloak_access_token \
  "${TENANT_KEYCLOAK_URL}" \
  "${TENANT_KEYCLOAK_REALM}" \
  "${TENANT_KEYCLOAK_CLIENT_ID}" \
  "${TENANT_KEYCLOAK_USERNAME}" \
  "${TENANT_KEYCLOAK_PASSWORD}")"

curl -fsS \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "http://127.0.0.1:${TENANT_LOCAL_PORT}/api/auth/session" \
  >"${WORK_DIR}/tenant-session.json"

curl -fsS \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "http://127.0.0.1:${TENANT_LOCAL_PORT}/api/campaigns" \
  >"${WORK_DIR}/tenant-campaigns.json"

tenant_owner_email="$(json_get owner.email <"${WORK_DIR}/tenant-session.json")"
tenant_campaign_count="$(json_get campaigns <"${WORK_DIR}/tenant-campaigns.json" | get_json_array_length)"

echo
echo "k3d smoke succeeded."
echo "- Tenant ID: ${tenant_id}"
echo "- Tenant namespace: ${tenant_namespace}"
echo "- Tenant subdomain: ${tenant_subdomain}"
echo "- Tenant readiness: http://127.0.0.1:${TENANT_LOCAL_PORT}/ready"
echo "- Control-plane Keycloak auth: ${CONTROL_PLANE_KEYCLOAK_REALM}/${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}"
echo "- Tenant Keycloak auth: ${TENANT_KEYCLOAK_REALM}/${TENANT_KEYCLOAK_CLIENT_ID} (${tenant_owner_email}, ${tenant_campaign_count} campaigns)"
