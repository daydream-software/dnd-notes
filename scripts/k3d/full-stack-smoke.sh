#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
PLATFORM_NAMESPACE="dnd-notes-platform"
K3D_HTTP_PORT="${K3D_HTTP_PORT:-8080}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-3101}"
CONTROL_PLANE_KEYCLOAK_URL="${CONTROL_PLANE_KEYCLOAK_URL:-http://keycloak.127.0.0.1.nip.io:${K3D_HTTP_PORT}}"
CONTROL_PLANE_KEYCLOAK_REALM="${CONTROL_PLANE_KEYCLOAK_REALM:-dnd-notes-dev}"
CONTROL_PLANE_KEYCLOAK_CLIENT_ID="${CONTROL_PLANE_KEYCLOAK_CLIENT_ID:-dnd-notes-control-plane}"
CONTROL_PLANE_KEYCLOAK_USERNAME="${CONTROL_PLANE_KEYCLOAK_USERNAME:-site-admin@example.com}"
CONTROL_PLANE_KEYCLOAK_PASSWORD="${CONTROL_PLANE_KEYCLOAK_PASSWORD:-password}"
TENANT_KEYCLOAK_URL="${TENANT_KEYCLOAK_URL:-${CONTROL_PLANE_KEYCLOAK_URL}}"
TENANT_KEYCLOAK_REALM="${TENANT_KEYCLOAK_REALM:-${CONTROL_PLANE_KEYCLOAK_REALM}}"
TENANT_KEYCLOAK_CLIENT_ID="${TENANT_KEYCLOAK_CLIENT_ID:-dnd-notes-tenant-app}"
TENANT_KEYCLOAK_USERNAME="${TENANT_KEYCLOAK_USERNAME:-owner@example.com}"
TENANT_KEYCLOAK_PASSWORD="${TENANT_KEYCLOAK_PASSWORD:-password}"
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-127.0.0.1.nip.io}"
TENANT_PUBLIC_SCHEME="${TENANT_PUBLIC_SCHEME:-http}"
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
  CONTROL_PLANE_PORT
  TENANT_IMAGE_TAG
  CONTROL_PLANE_KEYCLOAK_URL
  CONTROL_PLANE_KEYCLOAK_REALM
  CONTROL_PLANE_KEYCLOAK_CLIENT_ID
  CONTROL_PLANE_KEYCLOAK_USERNAME
  CONTROL_PLANE_KEYCLOAK_PASSWORD
  TENANT_KEYCLOAK_URL
  TENANT_KEYCLOAK_REALM
  TENANT_KEYCLOAK_CLIENT_ID
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
      initialAdminEmail: "owner@example.com",
      version: tenantImageTag,
    }))
  ' "$tenant_id" "$tenant_slug" "$tenant_image_tag"
}

get_keycloak_token_response() {
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
  local tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}"
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
run_visible "${ROOT}/scripts/k3d/build-tenant-image.sh"
run_visible "${ROOT}/scripts/k3d/build-control-plane-image.sh"

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

kubectl create secret generic dnd-notes-control-plane-secrets \
  -n "${PLATFORM_NAMESPACE}" \
  --from-literal=CONTROL_PLANE_ADMIN_TOKEN='local-admin-token' \
  --from-literal=TENANT_DATABASE_ADMIN_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres' \
  --from-literal=TENANT_DATABASE_RUNTIME_URL='postgresql://runtime-template:placeholder@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable' \
  --dry-run=client -o yaml \
  | kubectl apply -f - >/dev/null

run_visible kubectl apply -k "${ROOT}/platform/control-plane/overlays/k3d"
run_visible kubectl rollout status -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane --timeout=240s

kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/dnd-notes-control-plane \
  "${CONTROL_PLANE_PORT}:3001" \
  >"${WORK_DIR}/control-plane-port-forward.log" 2>&1 &
control_plane_port_forward_pid=$!

wait_for_tcp "${CONTROL_PLANE_PORT}" 30
wait_for_http "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" 60
wait_for_http "${CONTROL_PLANE_KEYCLOAK_URL}/realms/${CONTROL_PLANE_KEYCLOAK_REALM}" 60

control_plane_token_response="$(get_keycloak_token_response \
  "${CONTROL_PLANE_KEYCLOAK_URL}" \
  "${CONTROL_PLANE_KEYCLOAK_REALM}" \
  "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
  "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
  "${CONTROL_PLANE_KEYCLOAK_PASSWORD}")"
control_plane_bearer_token="$(json_get access_token <<<"${control_plane_token_response}")"

tenant_id="smoke-$(date +%s)"
tenant_slug="${tenant_id}"

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

run_visible kubectl rollout status -n "${tenant_namespace}" deployment/dnd-notes --timeout=240s
wait_for_http "${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}/ready" 120

tenant_token_response="$(get_keycloak_token_response \
  "${TENANT_KEYCLOAK_URL}" \
  "${TENANT_KEYCLOAK_REALM}" \
  "${TENANT_KEYCLOAK_CLIENT_ID}" \
  "${TENANT_KEYCLOAK_USERNAME}" \
  "${TENANT_KEYCLOAK_PASSWORD}")"
tenant_bearer_token="$(json_get access_token <<<"${tenant_token_response}")"

curl -fsS \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}/api/auth/session" \
  >"${WORK_DIR}/tenant-session.json"

curl -fsS \
  -H "Authorization: Bearer ${tenant_bearer_token}" \
  "${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}/api/campaigns" \
  >"${WORK_DIR}/tenant-campaigns.json"

emit_summary "${WORK_DIR}/tenant-session.json" "${WORK_DIR}/tenant-campaigns.json"
