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
CONTROL_PLANE_IMAGE_TAG="${CONTROL_PLANE_IMAGE_TAG:-k3d}"
DEV_TENANT_ID="${DEV_TENANT_ID:-dev}"
DEV_TENANT_SUBDOMAIN="${DEV_TENANT_SUBDOMAIN:-dev}"
DEV_TENANT_OWNER_EMAIL="${DEV_TENANT_OWNER_EMAIL:-owner@example.com}"
STATE_DIR="${ROOT}/.k3d-state"
STATE_FILE="${STATE_DIR}/state.json"
WORK_DIR="${ROOT}/.k3d-up-work"

# Flags
NO_REBUILD="${K3D_NO_REBUILD:-false}"
RESET_TENANT="${K3D_RESET_TENANT:-false}"
NO_TENANT="${K3D_NO_TENANT:-false}"
OUTPUT_JSON="${K3D_UP_JSON:-false}"

control_plane_port_forward_pid=""

usage() {
  cat <<'EOF'
Bring up the persistent local k3d platform for dnd-notes.

Usage:
  npm run k3d:up [-- [options]]

Options:
  --no-rebuild      Skip image builds when images are already imported.
  --reset-tenant    Deprovision the existing dev tenant and re-provision fresh.
  --no-tenant       Bring up only the platform (no tenant).
  --json            Machine-readable summary on stdout.
  --help            Show this help.

Environment overrides:
  K3D_CLUSTER_NAME
  K3D_HTTP_PORT
  CONTROL_PLANE_PORT
  TENANT_IMAGE_TAG
  CONTROL_PLANE_IMAGE_TAG
  K3D_NO_REBUILD=true
  K3D_RESET_TENANT=true
  K3D_NO_TENANT=true
  K3D_UP_JSON=true
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

# Read previously persisted state. Preserves the tenant namespace exactly as
# stored — it must NOT be re-derived from subdomain, since the control plane
# can produce a namespace that differs from the default "tenant-{subdomain}"
# pattern (e.g. "tenant-platform-dev").
read_persisted_state() {
  if [[ ! -f "${STATE_FILE}" ]]; then
    return 1
  fi

  local raw
  raw="$(cat "${STATE_FILE}")" || return 1

  # Validate it's parseable JSON before relying on it.
  if ! node -e 'JSON.parse(require("node:fs").readFileSync(0,"utf8"))' <<<"${raw}" 2>/dev/null; then
    log "Warning: ${STATE_FILE} is corrupt or truncated — ignoring cached state."
    return 1
  fi

  tenant_id="$(json_get tenant.id <<<"${raw}")" || return 1
  tenant_subdomain="$(json_get tenant.subdomain <<<"${raw}")" || return 1
  # Read namespace directly from state — do NOT re-derive as "tenant-${tenant_subdomain}".
  tenant_namespace="$(json_get tenant.namespace <<<"${raw}")" || return 1
  tenant_hostname="$(json_get tenant.hostname <<<"${raw}")" || return 1
  return 0
}

write_state() {
  local tenant_id_val="$1"
  local tenant_subdomain_val="$2"
  local tenant_namespace_val="$3"
  local tenant_hostname_val="$4"

  mkdir -p "${STATE_DIR}"

  node -e '
    const [
      clusterName, controlPlaneUrl,
      tenantId, tenantSubdomain, tenantNamespace, tenantHostname,
      keycloakUrl, keycloakRealm, keycloakClientId,
      tenantKeycloakUrl, tenantKeycloakRealm, tenantKeycloakClientId,
      ownerEmail, ownerPassword,
    ] = process.argv.slice(1)

    const state = {
      clusterName,
      controlPlaneUrl,
      tenant: {
        id: tenantId,
        subdomain: tenantSubdomain,
        namespace: tenantNamespace,
        hostname: tenantHostname,
        keycloak: {
          url: tenantKeycloakUrl,
          realm: tenantKeycloakRealm,
          clients: { tenantApp: tenantKeycloakClientId },
        },
        credentials: {
          owner: { email: ownerEmail, password: ownerPassword },
        },
        tokenSnippet: `curl -fsS -X POST -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "grant_type=password" --data-urlencode "client_id=${tenantKeycloakClientId}" --data-urlencode "username=${ownerEmail}" --data-urlencode "password=${ownerPassword}" "${tenantKeycloakUrl}/realms/${tenantKeycloakRealm}/protocol/openid-connect/token" | node -e "process.stdout.write(JSON.parse(require(\\"node:fs\\").readFileSync(0,\\"utf8\\")).access_token)"`,
      },
    }
    process.stdout.write(JSON.stringify(state, null, 2))
  ' \
    "${CLUSTER_NAME}" \
    "${TENANT_PUBLIC_SCHEME}://${CONTROL_PLANE_KEYCLOAK_URL%/keycloak*}" \
    "${tenant_id_val}" \
    "${tenant_subdomain_val}" \
    "${tenant_namespace_val}" \
    "${tenant_hostname_val}" \
    "${CONTROL_PLANE_KEYCLOAK_URL}" \
    "${CONTROL_PLANE_KEYCLOAK_REALM}" \
    "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
    "${TENANT_KEYCLOAK_URL}" \
    "${TENANT_KEYCLOAK_REALM}" \
    "${TENANT_KEYCLOAK_CLIENT_ID}" \
    "${TENANT_KEYCLOAK_USERNAME}" \
    "${TENANT_KEYCLOAK_PASSWORD}" \
    >"${STATE_FILE}"
}

print_summary() {
  local tenant_id_val="$1"
  local tenant_subdomain_val="$2"
  local tenant_namespace_val="$3"
  local tenant_hostname_val="$4"
  local tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname_val}:${K3D_HTTP_PORT}"
  local control_plane_origin="http://127.0.0.1:${CONTROL_PLANE_PORT}"
  local keycloak_origin="${CONTROL_PLANE_KEYCLOAK_URL}"

  if [[ "${OUTPUT_JSON}" == "true" ]]; then
    node -e '
      const state = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
      process.stdout.write(JSON.stringify(state))
    ' "${STATE_FILE}"
  else
    echo
    echo "================================================"
    echo "  k3d platform is up"
    echo "================================================"
    echo "  Cluster:           k3d-${CLUSTER_NAME}"
    echo "  Tenant ID:         ${tenant_id_val}"
    echo "  Tenant namespace:  ${tenant_namespace_val}"
    echo "  Tenant URL:        ${tenant_origin}/"
    echo "  Control-plane:     ${control_plane_origin}/health"
    echo "  Keycloak:          ${keycloak_origin}/realms/${CONTROL_PLANE_KEYCLOAK_REALM}"
    echo "  Owner login:       ${TENANT_KEYCLOAK_USERNAME} / ${TENANT_KEYCLOAK_PASSWORD}"
    echo "  State file:        ${STATE_FILE}"
    echo "================================================"
    echo
    echo "Next steps:"
    echo "  npm run k3d:status"
    echo "  npm run k3d:down"
  fi
}

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "${control_plane_port_forward_pid}" ]] && kill -0 "${control_plane_port_forward_pid}" >/dev/null 2>&1; then
    kill "${control_plane_port_forward_pid}" >/dev/null 2>&1
    wait "${control_plane_port_forward_pid}" 2>/dev/null
  fi

  if (( exit_code == 0 )); then
    rm -rf "${WORK_DIR}"
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

# Parse flags
for arg in "$@"; do
  case "${arg}" in
    --no-rebuild)   NO_REBUILD=true ;;
    --reset-tenant) RESET_TENANT=true ;;
    --no-tenant)    NO_TENANT=true ;;
    --json)         OUTPUT_JSON=true ;;
    --help)         usage; exit 0 ;;
    *) log "Unknown argument: ${arg}"; usage; exit 1 ;;
  esac
done

for tool in docker k3d kubectl curl node; do
  require_tool "$tool"
done

mkdir -p "${WORK_DIR}"

# Step 1: Bootstrap cluster and platform dependencies (idempotent).
log "==> Bootstrapping platform..."
"${ROOT}/scripts/k3d/bootstrap.sh"

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

# Step 2: Build and import images (skip when --no-rebuild and image already exists).
image_exists_in_cluster() {
  local tag="$1"
  k3d image list -c "${CLUSTER_NAME}" 2>/dev/null | grep -Fq "${tag}" 2>/dev/null
}

if [[ "${NO_REBUILD}" == "true" ]] && image_exists_in_cluster "dnd-notes:${TENANT_IMAGE_TAG}"; then
  log "==> Skipping tenant image build (--no-rebuild, image already imported)."
else
  log "==> Building and importing tenant image..."
  "${ROOT}/scripts/k3d/build-tenant-image.sh"
fi

if [[ "${NO_REBUILD}" == "true" ]] && image_exists_in_cluster "dnd-notes-control-plane:${CONTROL_PLANE_IMAGE_TAG}"; then
  log "==> Skipping control-plane image build (--no-rebuild, image already imported)."
else
  log "==> Building and importing control-plane image..."
  "${ROOT}/scripts/k3d/build-control-plane-image.sh"
fi

# Step 3: Deploy control plane overlay and wait for rollout.
log "==> Applying control-plane overlay..."
kubectl apply -k "${ROOT}/platform/control-plane/overlays/k3d"

kubectl create secret generic dnd-notes-control-plane-secrets \
  -n "${PLATFORM_NAMESPACE}" \
  --from-literal=CONTROL_PLANE_ADMIN_TOKEN='local-admin-token' \
  --from-literal=CONTROL_PLANE_DATABASE_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/control_plane' \
  --from-literal=TENANT_DATABASE_ADMIN_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres' \
  --from-literal=TENANT_DATABASE_RUNTIME_URL='postgresql://runtime-template:placeholder@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable' \
  --dry-run=client -o yaml \
  | kubectl apply -f - >/dev/null

kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane
kubectl rollout status -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane --timeout=240s

# Port-forward the control plane for tenant operations.
kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/dnd-notes-control-plane \
  "${CONTROL_PLANE_PORT}:3001" \
  >"${WORK_DIR}/control-plane-port-forward.log" 2>&1 &
control_plane_port_forward_pid=$!

wait_for_tcp "${CONTROL_PLANE_PORT}" 30
wait_for_http "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" 60
wait_for_http "${CONTROL_PLANE_KEYCLOAK_URL}/realms/${CONTROL_PLANE_KEYCLOAK_REALM}" 60

# Step 4: Provision a deterministic dev tenant (idempotent).
tenant_id=""
tenant_subdomain=""
tenant_namespace=""
tenant_hostname=""

if [[ "${NO_TENANT}" == "true" ]]; then
  log "==> Skipping tenant provisioning (--no-tenant)."
else
  control_plane_token_response="$(get_keycloak_token_response \
    "${CONTROL_PLANE_KEYCLOAK_URL}" \
    "${CONTROL_PLANE_KEYCLOAK_REALM}" \
    "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
    "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
    "${CONTROL_PLANE_KEYCLOAK_PASSWORD}")"
  control_plane_bearer_token="$(json_get access_token <<<"${control_plane_token_response}")"

  # Try to reuse state from a previous run.
  if [[ "${RESET_TENANT}" == "false" ]] && read_persisted_state; then
    # Verify the tenant still exists in the control plane.
    tenant_current_state="$(
      curl -fsS \
        -H "Authorization: Bearer ${control_plane_bearer_token}" \
        "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${tenant_id}" \
        >"${WORK_DIR}/tenant-detail.json" 2>&1 \
        && json_get tenant.currentState <"${WORK_DIR}/tenant-detail.json" \
        || echo "missing"
    )"

    if [[ "${tenant_current_state}" == "ready" ]]; then
      log "==> Reusing existing tenant ${tenant_id} (state=ready)."
    else
      log "==> Tenant ${tenant_id} found (state=${tenant_current_state}) — reprovisioning."
      RESET_TENANT=true
    fi
  else
    RESET_TENANT=true
  fi

  if [[ "${RESET_TENANT}" == "true" ]]; then
    # Deprovision old tenant if it exists.
    if [[ -n "${tenant_id}" ]]; then
      log "==> Deprovisioning existing tenant ${tenant_id}..."
      curl -fsS \
        -X POST \
        -H "Authorization: Bearer ${control_plane_bearer_token}" \
        -H 'Content-Type: application/json' \
        -d '{"triggeredBy":"k3d-up","reason":"reset-tenant requested"}' \
        "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${tenant_id}/deprovision" \
        >/dev/null 2>&1 || true
    fi

    tenant_id="${DEV_TENANT_ID}"
    tenant_slug="${DEV_TENANT_ID}"

    log "==> Creating tenant ${tenant_id}..."
    # Create tenant (idempotent — 409 is fine if it already exists).
    curl -fsS \
      -X POST \
      -H "Authorization: Bearer ${control_plane_bearer_token}" \
      -H 'Content-Type: application/json' \
      -d "$(node -e '
        process.stdout.write(JSON.stringify({
          id: process.argv[1],
          slug: process.argv[2],
          ownerId: "dev-owner",
          version: process.argv[3],
          subdomain: process.argv[4],
          initialAdminEmail: process.argv[5],
        }))
      ' "${tenant_id}" "${tenant_slug}" "${TENANT_IMAGE_TAG}" "${DEV_TENANT_SUBDOMAIN}" "${DEV_TENANT_OWNER_EMAIL}")" \
      "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants" \
      >"${WORK_DIR}/tenant-create.json" 2>&1 || true

    log "==> Provisioning tenant ${tenant_id}..."
    curl -fsS \
      -X POST \
      -H "Authorization: Bearer ${control_plane_bearer_token}" \
      -H 'Content-Type: application/json' \
      -d '{"triggeredBy":"k3d-up","reason":"initial k3d:up provisioning"}' \
      "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${tenant_id}/provision" \
      >"${WORK_DIR}/tenant-provision.json"

    # Namespace comes directly from the provision response — do NOT derive it.
    tenant_namespace="$(json_get resources.namespace <"${WORK_DIR}/tenant-provision.json")"
    tenant_subdomain="$(json_get tenant.subdomain <"${WORK_DIR}/tenant-provision.json")"
    tenant_hostname="${tenant_subdomain}.${TENANT_BASE_DOMAIN}"

    kubectl rollout status -n "${tenant_namespace}" deployment/dnd-notes --timeout=240s
    wait_for_http "${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}/ready" 120

    # Step 5: Seed sample data.
    log "==> Seeding tenant ${tenant_id} with sample data..."
    tenant_token_response="$(get_keycloak_token_response \
      "${TENANT_KEYCLOAK_URL}" \
      "${TENANT_KEYCLOAK_REALM}" \
      "${TENANT_KEYCLOAK_CLIENT_ID}" \
      "${TENANT_KEYCLOAK_USERNAME}" \
      "${TENANT_KEYCLOAK_PASSWORD}")"
    tenant_bearer_token="$(json_get access_token <<<"${tenant_token_response}")"

    curl -fsS \
      -X POST \
      -H "Authorization: Bearer ${tenant_bearer_token}" \
      -H 'Content-Type: application/json' \
      "${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}/api/seed" \
      >/dev/null 2>&1 || true
  fi

  # Step 6: Persist state.
  log "==> Persisting state to ${STATE_FILE}..."
  write_state "${tenant_id}" "${tenant_subdomain}" "${tenant_namespace}" "${tenant_hostname}"

  # Step 7: Print summary.
  print_summary "${tenant_id}" "${tenant_subdomain}" "${tenant_namespace}" "${tenant_hostname}"
fi
