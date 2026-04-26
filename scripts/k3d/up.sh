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
POSTGRES_LOCAL_PORT="${POSTGRES_LOCAL_PORT:-55432}"
TENANT_IMAGE_TAG="${TENANT_IMAGE_TAG:-k3d}"
TENANT_IMAGE_REPOSITORY="${TENANT_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes}"
CONTROL_PLANE_IMAGE_TAG="${CONTROL_PLANE_IMAGE_TAG:-k3d}"
CONTROL_PLANE_IMAGE_REPOSITORY="${CONTROL_PLANE_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-control-plane}"
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-127.0.0.1.nip.io}"
TENANT_PUBLIC_SCHEME="${TENANT_PUBLIC_SCHEME:-http}"
CONTROL_PLANE_KEYCLOAK_URL="${CONTROL_PLANE_KEYCLOAK_URL:-http://keycloak.127.0.0.1.nip.io:${K3D_HTTP_PORT}}"
CONTROL_PLANE_KEYCLOAK_REALM="${CONTROL_PLANE_KEYCLOAK_REALM:-dnd-notes-dev}"
CONTROL_PLANE_KEYCLOAK_CLIENT_ID="${CONTROL_PLANE_KEYCLOAK_CLIENT_ID:-dnd-notes-control-plane}"
CONTROL_PLANE_KEYCLOAK_USERNAME="${CONTROL_PLANE_KEYCLOAK_USERNAME:-site-admin@example.com}"
CONTROL_PLANE_KEYCLOAK_PASSWORD="${CONTROL_PLANE_KEYCLOAK_PASSWORD:-password}"
TENANT_KEYCLOAK_CLIENT_ID="${TENANT_KEYCLOAK_CLIENT_ID:-dnd-notes-tenant-app}"
TENANT_KEYCLOAK_USERNAME="${TENANT_KEYCLOAK_USERNAME:-owner@example.com}"
TENANT_KEYCLOAK_PASSWORD="${TENANT_KEYCLOAK_PASSWORD:-password}"
DEV_TENANT_ID="${K3D_DEV_TENANT_ID:-k3d-dev}"
DEV_TENANT_SUBDOMAIN="${K3D_DEV_TENANT_SUBDOMAIN:-dev}"
DEV_TENANT_OWNER_ID="${K3D_DEV_TENANT_OWNER_ID:-k3d-dev-owner}"
STATE_DIR="${ROOT}/.k3d-state"
STATE_FILE="${STATE_DIR}/state.json"
WORK_DIR="${ROOT}/.k3d-up-work"

NO_REBUILD=false
RESET_TENANT=false
NO_TENANT=false
JSON_OUTPUT=false
previous_kube_context="$(kubectl config current-context 2>/dev/null || true)"
control_plane_port_forward_pid=""
postgres_forward_pid=""
tenant_namespace=""

usage() {
  cat <<'EOF'
Bring up the persistent local k3d platform and tenant for interactive development.

What it does:
  1. Bootstraps the k3d cluster + infra (idempotent — skipped if cluster exists)
  2. Builds and imports tenant and control-plane images (skip with --no-rebuild)
  3. Deploys the control plane into k3d and waits for rollout
  4. Provisions a deterministic 'dev' tenant if not already present/ready
  5. Seeds the tenant with standard sample data (idempotent)
  6. Writes .k3d-state/state.json with URLs, credentials, and token snippets
  7. Prints a human-readable summary

Flags:
  --no-rebuild     Skip image builds when the Docker image tag already exists locally
  --reset-tenant   Deprovision the existing dev tenant and re-provision fresh
  --no-tenant      Bring up the platform only — skip tenant provisioning
  --json           Print machine-readable JSON summary on stdout instead of text
  --help           Show this help and exit

Environment overrides:
  K3D_CLUSTER_NAME
  K3D_HTTP_PORT
  CONTROL_PLANE_PORT
  POSTGRES_LOCAL_PORT
  TENANT_IMAGE_TAG
  CONTROL_PLANE_IMAGE_TAG
  TENANT_BASE_DOMAIN
  TENANT_PUBLIC_SCHEME
  CONTROL_PLANE_KEYCLOAK_URL
  CONTROL_PLANE_KEYCLOAK_REALM
  CONTROL_PLANE_KEYCLOAK_CLIENT_ID
  CONTROL_PLANE_KEYCLOAK_USERNAME
  CONTROL_PLANE_KEYCLOAK_PASSWORD
  TENANT_KEYCLOAK_CLIENT_ID
  TENANT_KEYCLOAK_USERNAME
  TENANT_KEYCLOAK_PASSWORD
  K3D_DEV_TENANT_ID
  K3D_DEV_TENANT_SUBDOMAIN
  K3D_DEV_TENANT_OWNER_ID
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

image_exists_locally() {
  docker image inspect "$1" >/dev/null 2>&1
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

run_visible() {
  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    "$@" >&2
  else
    "$@"
  fi
}

# Localize a postgresql:// URL to use 127.0.0.1 and the given port, preserving
# the original database name and query string.
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

# Write the state file. tenantNamespace is stored explicitly from the API
# response so that status/down scripts never need to re-derive it from subdomain.
write_state() {
  local tenant_id="${1:-}"
  local tenant_subdomain="${2:-}"
  local tenant_namespace="${3:-}"
  local tenant_hostname="${4:-}"

  mkdir -p "${STATE_DIR}"

  node -e '
    const fs = require("node:fs")
    const [
      clusterName, httpPort, cpPort,
      keycloakUrl, keycloakRealm, cpClientId, tenantClientId,
      siteAdminEmail, siteAdminPassword,
      tenantOwnerEmail, tenantOwnerPassword,
      tenantId, tenantSubdomain, tenantNamespace, tenantHostname, tenantPublicScheme,
      stateFile,
    ] = process.argv.slice(1)

    const tenantOrigin = `${tenantPublicScheme}://${tenantHostname}:${httpPort}`

    const makeTokenSnippet = (clientId, username, password) =>
      `curl -fsS -X POST -H '"'"'Content-Type: application/x-www-form-urlencoded'"'"'` +
      ` --data-urlencode '"'"'grant_type=password'"'"'` +
      ` --data-urlencode '"'"'client_id=${clientId}'"'"'` +
      ` --data-urlencode '"'"'username=${username}'"'"'` +
      ` --data-urlencode '"'"'password=${password}'"'"'` +
      ` '"'"'${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token'"'"'` +
      ` | node -e '"'"'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).access_token)'"'"'`

    const state = {
      clusterName,
      controlPlanePort: Number(cpPort),
      keycloakUrl,
      keycloakRealm,
      controlPlaneClientId: cpClientId,
      tenantClientId,
      siteAdminEmail,
      siteAdminPassword,
      tenantId: tenantId || null,
      tenantSubdomain: tenantSubdomain || null,
      tenantNamespace: tenantNamespace || null,
      tenantHostname: tenantHostname || null,
      tenantOrigin: tenantId ? tenantOrigin : null,
      tenantOwnerEmail,
      tenantOwnerPassword,
      tokenSnippets: {
        controlPlane: makeTokenSnippet(cpClientId, siteAdminEmail, siteAdminPassword),
        tenant: tenantId
          ? makeTokenSnippet(tenantClientId, tenantOwnerEmail, tenantOwnerPassword)
          : null,
      },
    }

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n")
    process.stdout.write(stateFile)
  ' \
    "${CLUSTER_NAME}" \
    "${K3D_HTTP_PORT}" \
    "${CONTROL_PLANE_PORT}" \
    "${CONTROL_PLANE_KEYCLOAK_URL}" \
    "${CONTROL_PLANE_KEYCLOAK_REALM}" \
    "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
    "${TENANT_KEYCLOAK_CLIENT_ID}" \
    "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
    "${CONTROL_PLANE_KEYCLOAK_PASSWORD}" \
    "${TENANT_KEYCLOAK_USERNAME}" \
    "${TENANT_KEYCLOAK_PASSWORD}" \
    "${tenant_id}" \
    "${tenant_subdomain}" \
    "${tenant_namespace}" \
    "${tenant_hostname}" \
    "${TENANT_PUBLIC_SCHEME}" \
    "${STATE_FILE}"
}

emit_summary() {
  local tenant_id="${1:-}"
  local tenant_subdomain="${2:-}"
  local tenant_namespace="${3:-}"
  local tenant_hostname="${4:-}"

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat "${STATE_FILE}"
    return
  fi

  local tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}"

  echo
  echo "k3d platform is up."
  echo
  echo "Cluster:       k3d-${CLUSTER_NAME}"
  echo "Keycloak:      ${CONTROL_PLANE_KEYCLOAK_URL}"
  if [[ -n "${tenant_id}" ]]; then
    echo
    echo "Tenant:        ${tenant_id}"
    echo "  Subdomain:   ${tenant_subdomain}"
    echo "  Namespace:   ${tenant_namespace}"
    echo "  URL:         ${tenant_origin}"
    echo "  Owner:       ${TENANT_KEYCLOAK_USERNAME} / ${TENANT_KEYCLOAK_PASSWORD}"
    echo
    echo "State file:    ${STATE_FILE}"
    echo
    echo "Next steps:"
    echo "  Open ${tenant_origin} in your browser"
    echo "  Run 'npm run k3d:status' to check platform health"
    echo "  Run 'npm run k3d:down' to tear down"
  else
    echo
    echo "Platform only (--no-tenant). State file: ${STATE_FILE}"
    echo "Run 'npm run k3d:status' to check platform health."
  fi
}

cleanup() {
  local exit_code=$?
  set +e

  for pid in "${postgres_forward_pid}" "${control_plane_port_forward_pid}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1
      wait "${pid}" 2>/dev/null
    fi
  done

  if [[ -n "${previous_kube_context}" ]]; then
    kubectl config use-context "${previous_kube_context}" >/dev/null 2>&1
  fi

  if (( exit_code == 0 )); then
    rm -rf "${WORK_DIR}"
  else
    log "Preserved k3d:up work dir in ${WORK_DIR}"
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "${arg}" in
    --no-rebuild)   NO_REBUILD=true ;;
    --reset-tenant) RESET_TENANT=true ;;
    --no-tenant)    NO_TENANT=true ;;
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

for tool in docker k3d kubectl curl node; do
  require_tool "$tool"
done

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

# ---------------------------------------------------------------------------
# Step 1: Bootstrap cluster + infra (idempotent)
# ---------------------------------------------------------------------------
if ! cluster_exists; then
  log "Cluster ${CLUSTER_NAME} not found — running bootstrap..."
  run_visible "${ROOT}/scripts/k3d/bootstrap.sh"
else
  log "Using existing k3d cluster ${CLUSTER_NAME}."
fi

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

# ---------------------------------------------------------------------------
# Step 2: Build and import images
# ---------------------------------------------------------------------------
tenant_image_ref="${TENANT_IMAGE_REPOSITORY}:${TENANT_IMAGE_TAG}"
cp_image_ref="${CONTROL_PLANE_IMAGE_REPOSITORY}:${CONTROL_PLANE_IMAGE_TAG}"

if [[ "${NO_REBUILD}" == "true" ]]; then
  if image_exists_locally "${tenant_image_ref}"; then
    log "Tenant image ${tenant_image_ref} already present locally — skipping build."
  else
    log "Tenant image ${tenant_image_ref} not found locally despite --no-rebuild; building..."
    run_visible "${ROOT}/scripts/k3d/build-tenant-image.sh"
  fi

  if image_exists_locally "${cp_image_ref}"; then
    log "Control-plane image ${cp_image_ref} already present locally — skipping build."
  else
    log "Control-plane image ${cp_image_ref} not found locally despite --no-rebuild; building..."
    run_visible "${ROOT}/scripts/k3d/build-control-plane-image.sh"
  fi
else
  run_visible "${ROOT}/scripts/k3d/build-tenant-image.sh"
  run_visible "${ROOT}/scripts/k3d/build-control-plane-image.sh"
fi

# ---------------------------------------------------------------------------
# Step 3: Deploy control plane
# ---------------------------------------------------------------------------
run_visible kubectl apply -k "${ROOT}/platform/control-plane/overlays/k3d"

# The k3d overlay keeps placeholder Secret values in source control; replace the
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

# ---------------------------------------------------------------------------
# Step 4 (optional): Provision the deterministic dev tenant
# ---------------------------------------------------------------------------
if [[ "${NO_TENANT}" == "true" ]]; then
  log "Skipping tenant provisioning (--no-tenant)."
  write_state "" "" "" "" >/dev/null
  emit_summary "" "" "" ""
  exit 0
fi

# Port-forward the control-plane so we can reach its API
kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/dnd-notes-control-plane \
  "${CONTROL_PLANE_PORT}:3001" \
  >"${WORK_DIR}/control-plane-port-forward.log" 2>&1 &
control_plane_port_forward_pid=$!

wait_for_tcp "${CONTROL_PLANE_PORT}" 30
wait_for_http "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" 60
wait_for_http "${CONTROL_PLANE_KEYCLOAK_URL}/realms/${CONTROL_PLANE_KEYCLOAK_REALM}" 60

control_plane_bearer_token="$(get_keycloak_access_token \
  "${CONTROL_PLANE_KEYCLOAK_URL}" \
  "${CONTROL_PLANE_KEYCLOAK_REALM}" \
  "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
  "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
  "${CONTROL_PLANE_KEYCLOAK_PASSWORD}")"

# Check if the dev tenant already exists
tenant_state=""
set +e
http_code="$(curl -sS \
  -o "${WORK_DIR}/tenant-get.json" \
  -w '%{http_code}' \
  -H "Authorization: Bearer ${control_plane_bearer_token}" \
  "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${DEV_TENANT_ID}")"
get_exit=$?
set -e

if (( get_exit == 0 )) && [[ "${http_code}" =~ ^2 ]]; then
  tenant_state="$(json_get tenant.state <"${WORK_DIR}/tenant-get.json")"
fi

if [[ "${tenant_state}" == "ready" && "${RESET_TENANT}" != "true" ]]; then
  log "Dev tenant '${DEV_TENANT_ID}' is already ready — reusing."
  tenant_namespace="$(json_get resources.namespace <"${WORK_DIR}/tenant-get.json")"
  tenant_subdomain="$(json_get tenant.subdomain <"${WORK_DIR}/tenant-get.json")"
  tenant_hostname="${tenant_subdomain}.${TENANT_BASE_DOMAIN}"
else
  # Deprovision if resetting or in a non-terminal failure state
  if [[ -n "${tenant_state}" ]]; then
    if [[ "${RESET_TENANT}" == "true" ]]; then
      log "Deprovisioning dev tenant '${DEV_TENANT_ID}' (--reset-tenant)..."
    else
      log "Dev tenant '${DEV_TENANT_ID}' found in state '${tenant_state}' — re-provisioning..."
    fi
    curl -fsS \
      -X POST \
      -H "Authorization: Bearer ${control_plane_bearer_token}" \
      -H 'Content-Type: application/json' \
      -d '{"triggeredBy":"k3d-up","reason":"k3d:up reset"}' \
      "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${DEV_TENANT_ID}/deprovision" \
      >/dev/null 2>&1 || true
    # Wait for deprovision to complete
    local_deadline=$((SECONDS + 60))
    while (( SECONDS < local_deadline )); do
      set +e
      deprov_state="$(curl -fsS \
        -H "Authorization: Bearer ${control_plane_bearer_token}" \
        "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${DEV_TENANT_ID}" \
        2>/dev/null | json_get tenant.state 2>/dev/null || echo "")"
      set -e
      if [[ "${deprov_state}" == "deprovisioned" || -z "${deprov_state}" ]]; then
        break
      fi
      sleep 2
    done
  fi

  # Create the tenant record
  log "Creating dev tenant '${DEV_TENANT_ID}'..."
  curl -fsS \
    -X POST \
    -H "Authorization: Bearer ${control_plane_bearer_token}" \
    -H 'Content-Type: application/json' \
    -d "$(node -e '
      const [tenantId, subdomain, ownerId, version] = process.argv.slice(1)
      process.stdout.write(JSON.stringify({
        id: tenantId,
        slug: subdomain,
        ownerId,
        version,
      }))
    ' "${DEV_TENANT_ID}" "${DEV_TENANT_SUBDOMAIN}" "${DEV_TENANT_OWNER_ID}" "${TENANT_IMAGE_TAG}")" \
    "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants" \
    >"${WORK_DIR}/tenant-create.json"

  # Provision it
  log "Provisioning dev tenant '${DEV_TENANT_ID}'..."
  OPERATOR_PORTAL_ACCESS_TOKEN="${control_plane_bearer_token}" \
  OPERATOR_PORTAL_REFRESH_TOKEN="${control_plane_bearer_token}" \
  OPERATOR_PORTAL_CONTROL_PLANE_BASE_URL="http://127.0.0.1:${CONTROL_PLANE_PORT}" \
  OPERATOR_PORTAL_TENANT_ID="${DEV_TENANT_ID}" \
  OPERATOR_PORTAL_TENANT_SLUG="${DEV_TENANT_SUBDOMAIN}" \
  OPERATOR_PORTAL_OWNER_ID="${DEV_TENANT_OWNER_ID}" \
  OPERATOR_PORTAL_INITIAL_ADMIN_EMAIL="${TENANT_KEYCLOAK_USERNAME}" \
  OPERATOR_PORTAL_TENANT_VERSION="${TENANT_IMAGE_TAG}" \
  OPERATOR_PORTAL_REASON='k3d:up dev tenant provision' \
  OPERATOR_PORTAL_PROVISION_TIMEOUT_MS='300000' \
  node --import tsx "${ROOT}/scripts/k3d/operator-portal-smoke.ts" \
    >"${WORK_DIR}/operator-portal-provision.json"

  # Read back the actual namespace assigned by the provisioner (never derive from subdomain).
  curl -fsS \
    -H "Authorization: Bearer ${control_plane_bearer_token}" \
    "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${DEV_TENANT_ID}" \
    >"${WORK_DIR}/tenant-after-provision.json"

  tenant_namespace="$(json_get resources.namespace <"${WORK_DIR}/tenant-after-provision.json")"
  tenant_subdomain="$(json_get tenant.subdomain <"${WORK_DIR}/tenant-after-provision.json")"
  tenant_hostname="${tenant_subdomain}.${TENANT_BASE_DOMAIN}"
fi

run_visible kubectl rollout status -n "${tenant_namespace}" deployment/dnd-notes --timeout=240s

tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname}:${K3D_HTTP_PORT}"
wait_for_http "${tenant_origin}/ready" 120

# ---------------------------------------------------------------------------
# Step 5: Seed tenant with standard sample data (idempotent)
# ---------------------------------------------------------------------------
log "Seeding dev tenant data..."

kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/platform-postgres \
  "${POSTGRES_LOCAL_PORT}:5432" \
  >"${WORK_DIR}/postgres-port-forward.log" 2>&1 &
postgres_forward_pid=$!

wait_for_tcp "${POSTGRES_LOCAL_PORT}" 30

raw_db_url="$(kubectl -n "${tenant_namespace}" get secret dnd-notes-runtime-secret -o json \
  | decode_secret_value data.DATABASE_URL)"
local_db_url="$(localize_postgres_url "${raw_db_url}" "${POSTGRES_LOCAL_PORT}")"

DATABASE_URL="${local_db_url}" node --import tsx "${ROOT}/apps/api/src/seed.ts" seed \
  >"${WORK_DIR}/seed-output.log" 2>&1 \
  && log "Seed complete." \
  || log "Seed skipped or already seeded ($(cat "${WORK_DIR}/seed-output.log" 2>/dev/null | tail -1))."

kill "${postgres_forward_pid}" >/dev/null 2>&1 || true
wait "${postgres_forward_pid}" 2>/dev/null || true
postgres_forward_pid=""

# ---------------------------------------------------------------------------
# Step 6: Write state file
# ---------------------------------------------------------------------------
write_state \
  "${DEV_TENANT_ID}" \
  "${tenant_subdomain}" \
  "${tenant_namespace}" \
  "${tenant_hostname}" \
  >/dev/null

# ---------------------------------------------------------------------------
# Step 7: Print summary
# ---------------------------------------------------------------------------
emit_summary \
  "${DEV_TENANT_ID}" \
  "${tenant_subdomain}" \
  "${tenant_namespace}" \
  "${tenant_hostname}"
