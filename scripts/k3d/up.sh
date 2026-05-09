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
POSTGRES_LOCAL_PORT="${POSTGRES_LOCAL_PORT:-55432}"
TENANT_IMAGE_TAG="${TENANT_IMAGE_TAG:-k3d}"
TENANT_IMAGE_REPOSITORY="${TENANT_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes}"
CONTROL_PLANE_IMAGE_TAG="${CONTROL_PLANE_IMAGE_TAG:-k3d}"
CONTROL_PLANE_IMAGE_REPOSITORY="${CONTROL_PLANE_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-control-plane}"
IMAGE_IMPORT_MODE="${K3D_IMAGE_IMPORT_MODE:-direct}"
IMAGE_IMPORT_FALLBACK_MODE="${K3D_IMAGE_IMPORT_FALLBACK_MODE:-tools}"
IMAGE_IMPORT_TIMEOUT_SECONDS="${K3D_IMAGE_IMPORT_TIMEOUT_SECONDS:-180}"
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-127.0.0.1.nip.io}"
TENANT_PUBLIC_SCHEME="${TENANT_PUBLIC_SCHEME:-https}"
CONTROL_PLANE_KEYCLOAK_URL="${CONTROL_PLANE_KEYCLOAK_URL:-https://keycloak.127.0.0.1.nip.io}"
CONTROL_PLANE_KEYCLOAK_REALM="${CONTROL_PLANE_KEYCLOAK_REALM:-dnd-notes-dev}"
CONTROL_PLANE_KEYCLOAK_CLIENT_ID="${CONTROL_PLANE_KEYCLOAK_CLIENT_ID:-dnd-notes-control-plane}"
CONTROL_PLANE_KEYCLOAK_USERNAME="${CONTROL_PLANE_KEYCLOAK_USERNAME:-site-admin@example.com}"
CONTROL_PLANE_KEYCLOAK_PASSWORD="${CONTROL_PLANE_KEYCLOAK_PASSWORD:-password}"
TENANT_KEYCLOAK_USERNAME="${TENANT_KEYCLOAK_USERNAME:-owner@example.com}"
TENANT_KEYCLOAK_PASSWORD="${TENANT_KEYCLOAK_PASSWORD:-password}"
DEV_TENANT_ID="${K3D_DEV_TENANT_ID:-k3d-dev}"
DEV_TENANT_SUBDOMAIN="${K3D_DEV_TENANT_SUBDOMAIN:-dev}"
DEV_TENANT_OWNER_ID="${K3D_DEV_TENANT_OWNER_ID:-k3d-dev-owner}"
STATE_FILE="${K3D_STATE_FILE:-${ROOT}/.k3d-state/state.json}"
STATE_DIR="$(dirname "${STATE_FILE}")"
WORK_DIR="${ROOT}/.k3d-up-work"

NO_REBUILD=false
RESET_TENANT=false
NO_TENANT=false
JSON_OUTPUT=false
previous_kube_context=""
if command -v kubectl >/dev/null 2>&1; then
  previous_kube_context="$(kubectl config current-context 2>/dev/null || true)"
fi
control_plane_port_forward_pid=""
postgres_forward_pid=""

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
  K3D_HTTPS_PORT
  CONTROL_PLANE_PORT
  POSTGRES_LOCAL_PORT
  TENANT_IMAGE_TAG
  CONTROL_PLANE_IMAGE_TAG
  K3D_IMAGE_IMPORT_MODE
  K3D_IMAGE_IMPORT_FALLBACK_MODE
  K3D_IMAGE_IMPORT_TIMEOUT_SECONDS
  TENANT_BASE_DOMAIN
  TENANT_PUBLIC_SCHEME
  CONTROL_PLANE_KEYCLOAK_URL
  CONTROL_PLANE_KEYCLOAK_REALM
  CONTROL_PLANE_KEYCLOAK_CLIENT_ID
  CONTROL_PLANE_KEYCLOAK_USERNAME
  CONTROL_PLANE_KEYCLOAK_PASSWORD
  TENANT_KEYCLOAK_USERNAME
  TENANT_KEYCLOAK_PASSWORD
  K3D_DEV_TENANT_ID
  K3D_DEV_TENANT_SUBDOMAIN
  K3D_DEV_TENANT_OWNER_ID
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
  k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fx "${CLUSTER_NAME}" >/dev/null
}

image_exists_locally() {
  docker image inspect "$1" >/dev/null 2>&1
}

run_k3d_image_import() {
  local image_ref="$1"
  local mode="$2"
  local status=0

  log "Importing ${image_ref} into k3d cluster ${CLUSTER_NAME} with mode ${mode}..."
  if command -v timeout >/dev/null 2>&1; then
    if timeout "${IMAGE_IMPORT_TIMEOUT_SECONDS}" \
      k3d image import --mode "${mode}" -c "${CLUSTER_NAME}" "${image_ref}"; then
      return 0
    fi

    status=$?
    return "${status}"
  fi

  if k3d image import --mode "${mode}" -c "${CLUSTER_NAME}" "${image_ref}"; then
    return 0
  fi

  status=$?
  return "${status}"
}

ensure_image_imported_into_cluster() {
  local image_ref="$1"

  if ! run_k3d_image_import "${image_ref}" "${IMAGE_IMPORT_MODE}"; then
    if [[ "${IMAGE_IMPORT_FALLBACK_MODE}" == "${IMAGE_IMPORT_MODE}" ]]; then
      log "Image import failed for ${image_ref} with mode ${IMAGE_IMPORT_MODE} and no alternate fallback mode is configured."
      return 1
    fi

    log "Image import of ${image_ref} with mode ${IMAGE_IMPORT_MODE} failed or timed out; retrying with ${IMAGE_IMPORT_FALLBACK_MODE}."
    run_k3d_image_import "${image_ref}" "${IMAGE_IMPORT_FALLBACK_MODE}"
  fi
}

ensure_image_ready() {
  # Args: <image_name> <image_ref> <build_script> [extra args...]
  # Extra args are forwarded to the build script verbatim.
  local image_name="$1"
  local image_ref="$2"
  shift 2

  if [[ "${NO_REBUILD}" == "true" ]]; then
    if image_exists_locally "${image_ref}"; then
      log "${image_name} image ${image_ref} already present locally — skipping build."
      ensure_image_imported_into_cluster "${image_ref}"
    else
      log "${image_name} image ${image_ref} not found locally despite --no-rebuild; building..."
      run_visible "$@"
    fi
  else
    run_visible "$@"
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

# Like wait_for_http but passes -k (insecure) to curl. Used for HTTPS endpoints
# whose certificate is signed by the mkcert CA, which the WSL curl binary does
# not trust automatically even when the Windows browser trust store does.
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

state_module() {
  node "${ROOT}/scripts/k3d/state.mjs" "$@"
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

  # -k: Keycloak URL is now HTTPS via mkcert CA; the CA is trusted by the browser
  # (Windows trust store) but not necessarily by the WSL curl binary.
  curl -fsSk \
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

build_token_snippet() {
  local keycloak_url="$1"
  local keycloak_realm="$2"
  local client_id="$3"
  local username="$4"
  local password="$5"

  state_module token-snippet \
    "${keycloak_url}" "${keycloak_realm}" "${client_id}" "${username}" "${password}"
}

# Write the state file (schema v1). tenantNamespace is stored explicitly from
# the API response so that status/down scripts never need to re-derive it.
write_state() {
  local tenant_id="${1:-}"
  local tenant_subdomain="${2:-}"
  local tenant_namespace="${3:-}"
  local tenant_hostname="${4:-}"
  local tenant_state="${5:-}"

  local control_plane_token_snippet
  control_plane_token_snippet="$(build_token_snippet \
    "${CONTROL_PLANE_KEYCLOAK_URL}" \
    "${CONTROL_PLANE_KEYCLOAK_REALM}" \
    "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
    "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
    "${CONTROL_PLANE_KEYCLOAK_PASSWORD}")"

  # Per-tenant Keycloak client IDs are derived from the tenant ID; there is no
  # shared static client. When tenant_id is empty (no dev tenant), client ID
  # is also empty and the token snippet is omitted.
  local tenant_client_id=""
  [[ -n "${tenant_id}" ]] && tenant_client_id="dnd-notes-tenant-${tenant_id}"

  local tenant_token_snippet="null"
  if [[ -n "${tenant_id}" ]]; then
    local raw_snippet
    raw_snippet="$(build_token_snippet \
      "${CONTROL_PLANE_KEYCLOAK_URL}" \
      "${CONTROL_PLANE_KEYCLOAK_REALM}" \
      "${tenant_client_id}" \
      "${TENANT_KEYCLOAK_USERNAME}" \
      "${TENANT_KEYCLOAK_PASSWORD}")"
    # JSON-encode the snippet string for embedding in the payload
    tenant_token_snippet="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "${raw_snippet}")"
  fi

  local cp_token_snippet_json
  cp_token_snippet_json="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "${control_plane_token_snippet}")"

  local state_payload
  state_payload="$(node -e '
    const [
      clusterName, httpPort, cpPort,
      keycloakUrl, keycloakRealm, cpClientId, tenantClientId,
      siteAdminEmail, siteAdminPassword,
      tenantOwnerEmail, tenantOwnerPassword,
      tenantId, tenantSubdomain, tenantNamespace, tenantHostname, tenantState, tenantPublicScheme,
      cpTokenSnippetJson, tenantTokenSnippetJson,
      stateFile,
    ] = process.argv.slice(1)

    const isHttps = tenantPublicScheme === "https"
    const defaultPort = isHttps ? 443 : 80
    const portSuffix = Number(httpPort) !== defaultPort ? `:${httpPort}` : ""

    const tenantOrigin = tenantId
      ? `${tenantPublicScheme}://${tenantHostname}${portSuffix}`
      : null

    const ingressUrl = `${tenantPublicScheme}://127.0.0.1.nip.io${portSuffix}`

    const state = {
      stateFile,
      clusterName,
      ingressUrl,
      controlPlaneUrl: `http://127.0.0.1:${cpPort}`,
      controlPlanePort: Number(cpPort),
      keycloak: {
        url: keycloakUrl,
        realm: keycloakRealm,
        controlPlaneClientId: cpClientId,
        tenantClientId,
      },
      auth: {
        siteAdminEmail,
        siteAdminPassword,
        tenantOwnerEmail,
        tenantOwnerPassword,
      },
      tenants: tenantId
        ? [{ id: tenantId, subdomain: tenantSubdomain, namespace: tenantNamespace, hostname: tenantHostname, origin: tenantOrigin, state: tenantState || "ready" }]
        : [],
      tokenSnippets: {
        controlPlane: JSON.parse(cpTokenSnippetJson),
        tenant: JSON.parse(tenantTokenSnippetJson),
      },
    }

    process.stdout.write(JSON.stringify(state))
  ' \
    "${CLUSTER_NAME}" \
    "$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "${K3D_HTTPS_PORT}" || echo "${K3D_HTTP_PORT}")" \
    "${CONTROL_PLANE_PORT}" \
    "${CONTROL_PLANE_KEYCLOAK_URL}" \
    "${CONTROL_PLANE_KEYCLOAK_REALM}" \
    "${CONTROL_PLANE_KEYCLOAK_CLIENT_ID}" \
    "${tenant_client_id}" \
    "${CONTROL_PLANE_KEYCLOAK_USERNAME}" \
    "${CONTROL_PLANE_KEYCLOAK_PASSWORD}" \
    "${TENANT_KEYCLOAK_USERNAME}" \
    "${TENANT_KEYCLOAK_PASSWORD}" \
    "${tenant_id}" \
    "${tenant_subdomain}" \
    "${tenant_namespace}" \
    "${tenant_hostname}" \
    "${tenant_state}" \
    "${TENANT_PUBLIC_SCHEME}" \
    "${cp_token_snippet_json}" \
    "${tenant_token_snippet}" \
    "${STATE_FILE}")"

  state_module write "${state_payload}"
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

  local ingress_port
  ingress_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "${K3D_HTTPS_PORT}" || echo "${K3D_HTTP_PORT}")"
  local default_port
  default_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "443" || echo "80")"
  local port_suffix=""
  if [[ "${ingress_port}" != "${default_port}" ]]; then
    port_suffix=":${ingress_port}"
  fi
  local tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname}${port_suffix}"

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

# ---------------------------------------------------------------------------
# Convenience: read a scalar field from the state file (exits 0, empty on err)
# ---------------------------------------------------------------------------
read_state_field_safe() {
  state_module read-safe "${STATE_FILE}" "$1" 2>/dev/null || true
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
op_image_ref="${OPERATOR_PORTAL_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-operator-portal}:${OPERATOR_PORTAL_IMAGE_TAG:-k3d}"
cust_image_ref="${CUSTOMER_PORTAL_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-customer-portal}:${CUSTOMER_PORTAL_IMAGE_TAG:-k3d}"

log "Building 4 images in parallel..."
ensure_image_ready "Tenant" "${tenant_image_ref}" \
  bash "${ROOT}/scripts/k3d/build-image.sh" \
    --name Tenant \
    --dockerfile Dockerfile \
    --repo "${TENANT_IMAGE_REPOSITORY}" \
    --tag "${TENANT_IMAGE_TAG}" \
  >"${WORK_DIR}/build-tenant.log" 2>&1 &
pid_tenant=$!
ensure_image_ready "Control-plane" "${cp_image_ref}" \
  bash "${ROOT}/scripts/k3d/build-image.sh" \
    --name Control-plane \
    --dockerfile docker/control-plane/Dockerfile \
    --repo "${CONTROL_PLANE_IMAGE_REPOSITORY}" \
    --tag "${CONTROL_PLANE_IMAGE_TAG}" \
  >"${WORK_DIR}/build-control-plane.log" 2>&1 &
pid_cp=$!
ensure_image_ready "Operator-portal" "${op_image_ref}" \
  bash "${ROOT}/scripts/k3d/build-image.sh" \
    --name Operator-portal \
    --dockerfile docker/portal/Dockerfile \
    --repo "${OPERATOR_PORTAL_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-operator-portal}" \
    --tag "${OPERATOR_PORTAL_IMAGE_TAG:-k3d}" \
    --build-arg PORTAL_NAME=operator-portal \
  >"${WORK_DIR}/build-operator-portal.log" 2>&1 &
pid_op=$!
ensure_image_ready "Customer-portal" "${cust_image_ref}" \
  bash "${ROOT}/scripts/k3d/build-image.sh" \
    --name Customer-portal \
    --dockerfile docker/portal/Dockerfile \
    --repo "${CUSTOMER_PORTAL_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-customer-portal}" \
    --tag "${CUSTOMER_PORTAL_IMAGE_TAG:-k3d}" \
    --build-arg PORTAL_NAME=customer-portal \
  >"${WORK_DIR}/build-customer-portal.log" 2>&1 &
pid_cust=$!

_build_fail=0
for _pid_var in pid_tenant pid_cp pid_op pid_cust; do
  if ! wait "${!_pid_var}"; then
    log "Build failed: ${_pid_var} — see ${WORK_DIR}/build-*.log for details"
    _build_fail=1
  fi
done

# Stream all build logs to stderr so the operator sees the full output.
for _log in "${WORK_DIR}"/build-*.log; do
  [[ -s "${_log}" ]] && { log "--- ${_log} ---"; cat "${_log}" >&2; }
done

[ "${_build_fail}" -eq 0 ] || exit 1
log "All 4 images built and imported."

# ---------------------------------------------------------------------------
# Step 3: Deploy control plane and portals
# ---------------------------------------------------------------------------
run_visible kubectl apply -k "${ROOT}/platform/control-plane/overlays/k3d"
run_visible kubectl apply -k "${ROOT}/platform/operator-portal/overlays/k3d"
run_visible kubectl apply -k "${ROOT}/platform/customer-portal/overlays/k3d"

# The k3d overlay keeps placeholder Secret values in source control; replace the
# rendered Secret after apply before waiting on the deployment.
kubectl create secret generic dnd-notes-control-plane-secrets \
  -n "${PLATFORM_NAMESPACE}" \
  --from-literal=CONTROL_PLANE_ADMIN_TOKEN='local-admin-token' \
  --from-literal=CONTROL_PLANE_DATABASE_URL="postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/control_plane" \
  --from-literal=TENANT_DATABASE_ADMIN_URL="postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/postgres" \
  --from-literal=TENANT_DATABASE_RUNTIME_URL="postgresql://runtime-template:placeholder@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/postgres?sslmode=disable" \
  --dry-run=client -o yaml \
  | kubectl apply -f - >/dev/null

run_visible kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane
run_visible kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/operator-portal
run_visible kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/customer-portal
run_visible kubectl rollout status -n "${PLATFORM_NAMESPACE}" deployment/dnd-notes-control-plane --timeout=240s
run_visible kubectl rollout status -n "${PLATFORM_NAMESPACE}" deployment/operator-portal --timeout=120s
run_visible kubectl rollout status -n "${PLATFORM_NAMESPACE}" deployment/customer-portal --timeout=120s

# ---------------------------------------------------------------------------
# Step 4 (optional): Provision the deterministic dev tenant
# ---------------------------------------------------------------------------
if [[ "${NO_TENANT}" == "true" ]]; then
  log "Skipping tenant provisioning (--no-tenant)."
  write_state "" "" "" "" "" >/dev/null
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
wait_for_http_insecure "${CONTROL_PLANE_KEYCLOAK_URL}/realms/${CONTROL_PLANE_KEYCLOAK_REALM}" 60

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
  tenant_state="$(json_get tenant.currentState <"${WORK_DIR}/tenant-get.json")"
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
    deprov_deadline=$((SECONDS + 60))
    while (( SECONDS < deprov_deadline )); do
      set +e
      deprov_state="$(curl -fsS \
        -H "Authorization: Bearer ${control_plane_bearer_token}" \
        "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${DEV_TENANT_ID}" \
        2>/dev/null | json_get tenant.currentState 2>/dev/null || echo "")"
      set -e
      if [[ "${deprov_state}" == "deprovisioned" || -z "${deprov_state}" ]]; then
        break
      fi
      sleep 2
    done
  fi

  # Create the tenant record if it does not exist yet (idempotent — 409 means already present).
  log "Creating dev tenant record '${DEV_TENANT_ID}' (idempotent)..."
  create_http_code="$(curl -sS \
    -o /dev/null \
    -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer ${control_plane_bearer_token}" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"${DEV_TENANT_ID}\",\"slug\":\"${DEV_TENANT_SUBDOMAIN}\",\"ownerId\":\"${DEV_TENANT_OWNER_ID}\",\"initialAdminEmail\":\"${TENANT_KEYCLOAK_USERNAME}\",\"version\":\"${TENANT_IMAGE_TAG}\"}" \
    "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants")"
  if [[ "${create_http_code}" != "201" && "${create_http_code}" != "409" ]]; then
    log "Unexpected HTTP ${create_http_code} from POST /internal/tenants — aborting."
    exit 1
  fi

  # Provision the tenant via REST. The endpoint is synchronous — it blocks until
  # provisioning completes (or times out). operator-portal-smoke.ts is NOT invoked
  # here; it is still used by full-stack-smoke.sh for E2E portal UI validation.
  log "Provisioning dev tenant '${DEV_TENANT_ID}'..."
  curl -fsS \
    --max-time 300 \
    -X POST \
    -H "Authorization: Bearer ${control_plane_bearer_token}" \
    -H 'Content-Type: application/json' \
    -d "{\"triggeredBy\":\"k3d-up\",\"reason\":\"k3d:up dev tenant provision\",\"version\":\"${TENANT_IMAGE_TAG}\"}" \
    "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${DEV_TENANT_ID}/provision" \
    >"${WORK_DIR}/tenant-provision.json"

  # Read back the actual namespace and final state assigned by the provisioner
  # (never derive namespace from subdomain).
  curl -fsS \
    -H "Authorization: Bearer ${control_plane_bearer_token}" \
    "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/tenants/${DEV_TENANT_ID}" \
    >"${WORK_DIR}/tenant-after-provision.json"

  tenant_namespace="$(json_get resources.namespace <"${WORK_DIR}/tenant-after-provision.json")"
  tenant_subdomain="$(json_get tenant.subdomain <"${WORK_DIR}/tenant-after-provision.json")"
  tenant_hostname="${tenant_subdomain}.${TENANT_BASE_DOMAIN}"
  tenant_state="$(json_get tenant.currentState <"${WORK_DIR}/tenant-after-provision.json")"
fi

run_visible kubectl rollout status -n "${tenant_namespace}" deployment/dnd-notes --timeout=240s

_ingress_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "${K3D_HTTPS_PORT}" || echo "${K3D_HTTP_PORT}")"
_default_port="$([ "${TENANT_PUBLIC_SCHEME}" = "https" ] && echo "443" || echo "80")"
_port_suffix=""
if [[ "${_ingress_port}" != "${_default_port}" ]]; then
  _port_suffix=":${_ingress_port}"
fi
tenant_origin="${TENANT_PUBLIC_SCHEME}://${tenant_hostname}${_port_suffix}"
# curl -k: the mkcert CA is trusted in the browser (Windows/WSL trust store) but
# not necessarily in the WSL curl binary; -k skips TLS verification for internal
# health checks only.
wait_for_http_insecure "${tenant_origin}/ready" 120

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
  || log "Seed skipped or already seeded ($(tail -1 "${WORK_DIR}/seed-output.log" 2>/dev/null))."

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
  "${tenant_state}" \
  >/dev/null

# ---------------------------------------------------------------------------
# Step 7: Print summary
# ---------------------------------------------------------------------------
emit_summary \
  "${DEV_TENANT_ID}" \
  "${tenant_subdomain}" \
  "${tenant_namespace}" \
  "${tenant_hostname}"
