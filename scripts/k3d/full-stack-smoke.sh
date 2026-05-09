#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/k3d/_load-dotenv.sh
source "${ROOT}/scripts/k3d/_load-dotenv.sh"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
PLATFORM_NAMESPACE="dnd-notes-platform"
K3D_HTTP_PORT="${K3D_HTTP_PORT:-80}"
K3D_HTTPS_PORT="${K3D_HTTPS_PORT:-443}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-3101}"
CONTROL_PLANE_KEYCLOAK_URL="${CONTROL_PLANE_KEYCLOAK_URL:-https://keycloak.127.0.0.1.nip.io}"
CONTROL_PLANE_KEYCLOAK_REALM="${CONTROL_PLANE_KEYCLOAK_REALM:-dnd-notes-dev}"
CONTROL_PLANE_KEYCLOAK_CLIENT_ID="${CONTROL_PLANE_KEYCLOAK_CLIENT_ID:-dnd-notes-control-plane}"
CONTROL_PLANE_KEYCLOAK_USERNAME="${CONTROL_PLANE_KEYCLOAK_USERNAME:-site-admin@example.com}"
CONTROL_PLANE_KEYCLOAK_PASSWORD="${CONTROL_PLANE_KEYCLOAK_PASSWORD:-password}"
TENANT_KEYCLOAK_URL="${TENANT_KEYCLOAK_URL:-${CONTROL_PLANE_KEYCLOAK_URL}}"
TENANT_KEYCLOAK_REALM="${TENANT_KEYCLOAK_REALM:-${CONTROL_PLANE_KEYCLOAK_REALM}}"
TENANT_KEYCLOAK_USERNAME="${TENANT_KEYCLOAK_USERNAME:-owner@example.com}"
TENANT_KEYCLOAK_PASSWORD="${TENANT_KEYCLOAK_PASSWORD:-password}"
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-127.0.0.1.nip.io}"
TENANT_PUBLIC_SCHEME="${TENANT_PUBLIC_SCHEME:-https}"
TENANT_IMAGE_TAG="${TENANT_IMAGE_TAG:-k3d}"
KEEP_TENANT="${KEEP_K3D_SMOKE_TENANT:-false}"
OUTPUT_MODE="${K3D_SMOKE_OUTPUT:-text}"
WORK_DIR="${ROOT}/.k3d-full-stack-smoke-work"
previous_kube_context="$(kubectl config current-context 2>/dev/null || true)"
control_plane_port_forward_pid=""
tenant_id=""
tenant_subdomain=""
tenant_namespace=""
tenant_hostname=""
control_plane_bearer_token=""

usage() {
  cat <<'EOF'
Run the full-stack k3d smoke lane for issue #79.

What it does:
  1. Bootstraps k3d platform dependencies
  2. Builds/imports tenant and control-plane images
  3. Deploys the control plane inside k3d via the committed overlay
  4. Provisions a tenant through the operator portal UI surface
  5. Verifies tenant readiness and live tenant requests through ingress

Environment overrides:
  K3D_CLUSTER_NAME
  K3D_HTTP_PORT
  K3D_HTTPS_PORT
  CONTROL_PLANE_PORT
  TENANT_IMAGE_TAG
  CONTROL_PLANE_KEYCLOAK_URL
  CONTROL_PLANE_KEYCLOAK_REALM
  CONTROL_PLANE_KEYCLOAK_CLIENT_ID
  CONTROL_PLANE_KEYCLOAK_USERNAME
  CONTROL_PLANE_KEYCLOAK_PASSWORD
  TENANT_KEYCLOAK_URL
  TENANT_KEYCLOAK_REALM
  TENANT_KEYCLOAK_USERNAME
  TENANT_KEYCLOAK_PASSWORD
  TENANT_BASE_DOMAIN
  TENANT_PUBLIC_SCHEME
  KEEP_K3D_SMOKE_TENANT=true
  K3D_SMOKE_OUTPUT=json
EOF
}

record_failure() {
  failed_command="${BASH_COMMAND}"
  failed_line="${BASH_LINENO[0]:-}"
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

  log "Timed out waiting for TCP port ${port}"
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

  log "Timed out waiting for ${url}"
  return 1
}

# Like wait_for_http but passes -k to curl for HTTPS endpoints whose certificate
# is signed by the mkcert CA (not trusted by WSL curl automatically).
wait_for_http_insecure() {
  local url="$1"
  local timeout="${2:-60}"
  local deadline=$((SECONDS + timeout))

  while (( SECONDS < deadline )); do
    if curl -fsSk "$url" >/dev/null 2>&1; then
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

json_find_tenant_field() {
  local tenant_id="$1"
  local path="$2"

  node -e '
    const fs = require("node:fs")
    const [tenantId, path] = process.argv.slice(1)
    const root = JSON.parse(fs.readFileSync(0, "utf8"))
    const tenant = (root.tenants ?? []).find((entry) => entry?.tenant?.id === tenantId)
    if (!tenant) {
      process.exit(1)
    }
    let value = tenant
    for (const segment of path.split(".")) {
      value = value?.[segment]
    }
    if (value === undefined) {
      process.exit(1)
    }
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value))
  ' "$tenant_id" "$path"
}

get_keycloak_token_response() {
  local base_url="$1"
  local realm="$2"
  local client_id="$3"
  local username="$4"
  local password="$5"

  # -k: Keycloak is served over HTTPS via mkcert CA; not trusted by WSL curl.
  curl -fsSk \
    -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "grant_type=password" \
    --data-urlencode "client_id=${client_id}" \
    --data-urlencode "username=${username}" \
    --data-urlencode "password=${password}" \
    "${base_url}/realms/${realm}/protocol/openid-connect/token"
}

run_visible() {
  if [[ "${OUTPUT_MODE}" == "json" ]]; then
    "$@" >&2
  else
    "$@"
  fi
}

emit_summary() {
  local session_path="$1"
  local campaigns_path="$2"
  local ingress_port
  ingress_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "${K3D_HTTPS_PORT}" || echo "${K3D_HTTP_PORT}")"
  local default_port
  default_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "443" || echo "80")"
  local port_suffix=""
  if [[ "${ingress_port}" != "${default_port}" ]]; then
    port_suffix=":${ingress_port}"
  fi
  local tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname}${port_suffix}"
  local tenant_owner_email
  local tenant_campaign_count

  tenant_owner_email="$(json_get owner.email <"${session_path}")"
  tenant_campaign_count="$(json_get campaigns <"${campaigns_path}" | node -e '
    const fs = require("node:fs")
    const value = JSON.parse(fs.readFileSync(0, "utf8"))
    process.stdout.write(String(Array.isArray(value) ? value.length : 0))
  ')"

  if [[ "${OUTPUT_MODE}" == "json" ]]; then
    node -e '
      const summary = {
        tenantId: process.argv[1],
        tenantSubdomain: process.argv[2],
        tenantNamespace: process.argv[3],
        tenantHostname: process.argv[4],
        tenantOrigin: process.argv[5],
        ownerEmail: process.argv[6],
        campaignCount: Number(process.argv[7]),
      }
      process.stdout.write(JSON.stringify(summary))
    ' \
      "${tenant_id}" \
      "${tenant_subdomain}" \
      "${tenant_namespace}" \
      "${tenant_hostname}" \
      "${tenant_origin}" \
      "${tenant_owner_email}" \
      "${tenant_campaign_count}"
  else
    echo
    echo "k3d full-stack smoke succeeded."
    echo "- Tenant ID: ${tenant_id}"
    echo "- Tenant namespace: ${tenant_namespace}"
    echo "- Tenant host: ${tenant_hostname}"
    echo "- Tenant origin: ${tenant_origin}"
    echo "- Tenant owner: ${tenant_owner_email}"
    echo "- Tenant campaigns: ${tenant_campaign_count}"
  fi
}

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "${tenant_id}" && "${KEEP_TENANT}" != "true" && -n "${control_plane_bearer_token}" ]]; then
    if curl -fsS "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" >/dev/null 2>&1; then
      curl -fsS \
        -X POST \
        -H "Authorization: Bearer ${control_plane_bearer_token}" \
        -H 'Content-Type: application/json' \
        -d '{"triggeredBy":"k3d-full-stack-smoke","reason":"full-stack smoke cleanup"}' \
        "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${tenant_id}/deprovision" \
        >/dev/null 2>&1
    fi
  fi

  if [[ -n "${control_plane_port_forward_pid}" ]] && kill -0 "${control_plane_port_forward_pid}" >/dev/null 2>&1; then
    kill "${control_plane_port_forward_pid}" >/dev/null 2>&1
    wait "${control_plane_port_forward_pid}" 2>/dev/null
  fi

  if [[ -n "${previous_kube_context}" ]]; then
    kubectl config use-context "${previous_kube_context}" >/dev/null 2>&1
  fi

  if (( exit_code == 0 )); then
    rm -rf "${WORK_DIR}"
  else
    if [[ -f "${WORK_DIR}/control-plane-port-forward.log" ]]; then
      log
      log "k3d full-stack smoke failed with exit code ${exit_code}."
      if [[ -n "${failed_command:-}" ]]; then
        if [[ -n "${failed_line:-}" ]]; then
          log "Failed command (around line ${failed_line}): ${failed_command}"
        else
          log "Failed command: ${failed_command}"
        fi
      fi
    fi

    log
    log "Preserved full-stack smoke logs in ${WORK_DIR}"
  fi

  exit "${exit_code}"
}

trap 'record_failure' ERR
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

run_visible "${ROOT}/scripts/k3d/bootstrap.sh"
run_visible bash "${ROOT}/scripts/k3d/build-image.sh" \
  --name Tenant \
  --dockerfile Dockerfile \
  --repo "${TENANT_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes}" \
  --tag "${TENANT_IMAGE_TAG}"
run_visible bash "${ROOT}/scripts/k3d/build-image.sh" \
  --name Control-plane \
  --dockerfile docker/control-plane/Dockerfile \
  --repo "${CONTROL_PLANE_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-control-plane}" \
  --tag "${TENANT_IMAGE_TAG}"

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

run_visible kubectl apply -k "${ROOT}/platform/control-plane/overlays/k3d"

# The k3d overlay keeps placeholder Secret values in source control, so replace the
# rendered Secret after apply before waiting on the deployment.
kubectl create secret generic dnd-notes-control-plane-secrets \
  -n "${PLATFORM_NAMESPACE}" \
  --from-literal=CONTROL_PLANE_ADMIN_TOKEN='local-admin-token' \
  --from-literal=CONTROL_PLANE_DATABASE_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/control_plane' \
  --from-literal=TENANT_DATABASE_ADMIN_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres' \
  --from-literal=TENANT_DATABASE_RUNTIME_URL='postgresql://runtime-template:placeholder@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable' \
  --dry-run=client -o yaml \
  | kubectl apply -f - >/dev/null

run_visible kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane
run_visible kubectl rollout status -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane --timeout=240s

kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/dnd-notes-control-plane \
  "${CONTROL_PLANE_PORT}:3001" \
  >"${WORK_DIR}/control-plane-port-forward.log" 2>&1 &
control_plane_port_forward_pid=$!

wait_for_tcp "${CONTROL_PLANE_PORT}" 30
wait_for_http "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" 60
wait_for_http_insecure "${CONTROL_PLANE_KEYCLOAK_URL}/realms/${CONTROL_PLANE_KEYCLOAK_REALM}" 60

control_plane_token_response="$(get_keycloak_token_response \
  "${CONTROL_PLANE_KEYCLOAK_URL}" \
  "${CONTROL_PLANE_KEYCLOAK_REALM}" \
  "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
  "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
  "${CONTROL_PLANE_KEYCLOAK_PASSWORD}")"
control_plane_bearer_token="$(json_get access_token <<<"${control_plane_token_response}")"

tenant_id="smoke-$(date +%s%N)-${RANDOM}"
tenant_slug="${tenant_id}"
# Per-tenant Keycloak client ID is derived from the tenant ID at provision time.
tenant_keycloak_client_id="dnd-notes-tenant-${tenant_id}"

OPERATOR_PORTAL_ACCESS_TOKEN="${control_plane_bearer_token}" \
OPERATOR_PORTAL_REFRESH_TOKEN="${control_plane_bearer_token}" \
OPERATOR_PORTAL_CONTROL_PLANE_BASE_URL="http://127.0.0.1:${CONTROL_PLANE_PORT}" \
OPERATOR_PORTAL_TENANT_ID="${tenant_id}" \
OPERATOR_PORTAL_TENANT_SLUG="${tenant_slug}" \
OPERATOR_PORTAL_OWNER_ID='smoke-owner' \
OPERATOR_PORTAL_INITIAL_ADMIN_EMAIL='owner@example.com' \
OPERATOR_PORTAL_TENANT_VERSION="${TENANT_IMAGE_TAG}" \
OPERATOR_PORTAL_REASON='Run the k3d full-stack smoke workflow' \
node --import tsx "${ROOT}/scripts/k3d/operator-portal-smoke.ts" \
  >"${WORK_DIR}/operator-portal-smoke.json"

curl -fsS \
  -H "Authorization: Bearer ${control_plane_bearer_token}" \
  "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/fleet/status" \
  >"${WORK_DIR}/fleet-status.json"

tenant_subdomain="$(json_find_tenant_field "${tenant_id}" 'tenant.subdomain' <"${WORK_DIR}/fleet-status.json")"
tenant_namespace="tenant-${tenant_subdomain}"
tenant_hostname="${tenant_subdomain}.${TENANT_BASE_DOMAIN}"

_ingress_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "${K3D_HTTPS_PORT}" || echo "${K3D_HTTP_PORT}")"
_default_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "443" || echo "80")"
_port_suffix=""
if [[ "${_ingress_port}" != "${_default_port}" ]]; then
  _port_suffix=":${_ingress_port}"
fi
tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname}${_port_suffix}"

run_visible kubectl rollout status -n "${tenant_namespace}" deployment/dnd-notes --timeout=240s
wait_for_http_insecure "${tenant_origin}/ready" 120

tenant_token_response="$(get_keycloak_token_response \
  "${TENANT_KEYCLOAK_URL}" \
  "${TENANT_KEYCLOAK_REALM}" \
  "${tenant_keycloak_client_id}" \
  "${TENANT_KEYCLOAK_USERNAME}" \
  "${TENANT_KEYCLOAK_PASSWORD}")"
tenant_bearer_token="$(json_get access_token <<<"${tenant_token_response}")"

curl -fsSk \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "${tenant_origin}/api/auth/session" \
  >"${WORK_DIR}/tenant-session.json"

curl -fsSk \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "${tenant_origin}/api/campaigns" \
  >"${WORK_DIR}/tenant-campaigns.json"

emit_summary "${WORK_DIR}/tenant-session.json" "${WORK_DIR}/tenant-campaigns.json"
