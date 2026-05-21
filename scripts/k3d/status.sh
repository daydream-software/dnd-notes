#!/usr/bin/env bash
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
PLATFORM_NAMESPACE="dnd-notes-platform"
STATE_FILE="${K3D_STATE_FILE:-${ROOT}/.k3d-state/state.json}"

JSON_OUTPUT=false

usage() {
  cat <<'EOF'
Check the health of the persistent k3d platform.

Reads .k3d-state/state.json, then queries the live cluster for component
readiness and prints a status summary.

Flags:
  --json     Print machine-readable JSON on stdout
  --help     Show this help and exit

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

has_tool() {
  command -v "$1" >/dev/null 2>&1
}

cluster_exists() {
  local name="$1"
  k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fx "${name}" >/dev/null
}

state_module() {
  node "${ROOT}/scripts/k3d/state.mjs" "$@"
}

reset_state() {
  state_clusterName=""
  state_keycloakUrl=""
  state_keycloakRealm=""
  state_tenantId=""
  state_tenantSubdomain=""
  state_tenantNamespace=""
  state_tenantHostname=""
  state_tenantOrigin=""
}

# Read the state file into a set of variables. Returns non-zero if the file is
# missing or unparseable; in that case all variables are set to empty strings.
# Supports both schema v1 (tenants[] array, keycloak sub-object) and old flat
# schema for backwards compat while reading.
read_state() {
  reset_state

  if [[ ! -f "${STATE_FILE}" ]]; then
    return 1
  fi

  # Parse STATE_FILE once and emit a NUL-delimited payload. Only populate the
  # shell variables after the full payload arrives so partial parser failures
  # cannot leave a half-populated state behind.
  local fields=()
  local field

  while IFS= read -r -d '' field; do
    fields+=("${field}")
  done < <(
    node -e '
      const fs = require("node:fs")
      const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))

      // v1 schema: keycloak sub-object; tenants array
      // v0 back-compat: flat fields at top level
      const keycloakUrl = state.keycloak?.url ?? state.keycloakUrl ?? ""
      const keycloakRealm = state.keycloak?.realm ?? state.keycloakRealm ?? ""

      // First tenant entry (schema v1); fall back to v0 flat fields
      const tenant = Array.isArray(state.tenants) && state.tenants.length > 0
        ? state.tenants[0]
        : null

      const tenantId = tenant?.id ?? state.tenantId ?? ""
      const tenantSubdomain = tenant?.subdomain ?? state.tenantSubdomain ?? ""
      const tenantNamespace = tenant?.namespace ?? state.tenantNamespace ?? ""
      const tenantHostname = tenant?.hostname ?? state.tenantHostname ?? ""
      const tenantOrigin = tenant?.origin ?? state.tenantOrigin ?? ""

      const fields = [
        state.clusterName ?? "",
        keycloakUrl,
        keycloakRealm,
        tenantId,
        tenantSubdomain,
        tenantNamespace,
        tenantHostname,
        tenantOrigin,
        "__K3D_STATE_PARSE_OK__",
      ]

      for (const value of fields) {
        process.stdout.write(String(value))
        process.stdout.write("\0")
      }
    ' "${STATE_FILE}" 2>/dev/null
  )

  if [[ "${#fields[@]}" -ne 9 || "${fields[8]}" != "__K3D_STATE_PARSE_OK__" ]]; then
    reset_state
    return 1
  fi

  state_clusterName="${fields[0]}"
  state_keycloakUrl="${fields[1]}"
  state_keycloakRealm="${fields[2]}"
  state_tenantId="${fields[3]}"
  state_tenantSubdomain="${fields[4]}"
  state_tenantNamespace="${fields[5]}"
  state_tenantHostname="${fields[6]}"
  state_tenantOrigin="${fields[7]}"
  return 0
}

probe_tenant_url() {
  local origin="$1"

  tenant_url_reachable=false
  tenant_url_probe_skipped=false

  if [[ -z "${origin}" ]]; then
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    tenant_url_probe_skipped=true
    return 0
  fi

  if curl -fsS "${origin}/ready" >/dev/null 2>&1; then
    tenant_url_reachable=true
  fi
}

# Query a deployment's ready replica count in the target context. Outputs "N/M"
# or "unavailable".
deployment_ready_count() {
  local context="$1"
  local namespace="$2"
  local name="$3"
  # Postgres is a StatefulSet on the unified base; everything else is a
  # Deployment. Both expose readyReplicas/replicas under .status.
  local kind="${4:-deployment}"

  local out
  out="$(kubectl --context "${context}" get "${kind}" "${name}" -n "${namespace}" \
    -o jsonpath='{.status.readyReplicas}/{.status.replicas}' 2>/dev/null)" || true
  echo "${out:-unavailable}"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "${arg}" in
    --json) JSON_OUTPUT=true ;;
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

require_tool node
k3d_available=false
kubectl_available=false

if has_tool k3d; then
  k3d_available=true
fi

if has_tool kubectl; then
  kubectl_available=true
fi

# ---------------------------------------------------------------------------
# Determine target cluster name
# ---------------------------------------------------------------------------
# Prefer K3D_CLUSTER_NAME if explicitly set, otherwise try to read from state.json,
# finally fall back to "dnd-notes".
if [[ -n "${K3D_CLUSTER_NAME:-}" ]]; then
  CLUSTER_NAME="${K3D_CLUSTER_NAME}"
else
  # Try to read from state file first
  if [[ -f "${STATE_FILE}" ]] && command -v node >/dev/null 2>&1; then
    state_cluster="$(state_module read-safe "${STATE_FILE}" clusterName 2>/dev/null || true)"
    CLUSTER_NAME="${state_cluster:-dnd-notes}"
  else
    CLUSTER_NAME="dnd-notes"
  fi
fi

# ---------------------------------------------------------------------------
# Read state file (corrupt/missing → degrade gracefully)
# ---------------------------------------------------------------------------
state_clusterName=""
state_keycloakUrl=""
state_keycloakRealm=""
state_tenantId=""
state_tenantSubdomain=""
state_tenantNamespace=""
state_tenantHostname=""
state_tenantOrigin=""

state_valid=false
if read_state; then
  state_valid=true
fi

# ---------------------------------------------------------------------------
# Query live cluster
# ---------------------------------------------------------------------------
cluster_running=false
if [[ "${k3d_available}" == "true" ]] && cluster_exists "${CLUSTER_NAME}"; then
  cluster_running=true
fi

control_plane_ready="unavailable"
keycloak_ready="unavailable"
postgres_ready="unavailable"
tenant_ready="unavailable"
tenant_url_reachable=false
tenant_url_probe_skipped=false

if [[ "${cluster_running}" == "true" ]]; then
  if [[ "${kubectl_available}" == "true" ]]; then
    target_kube_context="k3d-${CLUSTER_NAME}"

    control_plane_ready="$(deployment_ready_count "${target_kube_context}" "${PLATFORM_NAMESPACE}" dnd-notes-control-plane)"
    keycloak_ready="$(deployment_ready_count "${target_kube_context}" "${PLATFORM_NAMESPACE}" platform-keycloak)"
    postgres_ready="$(deployment_ready_count "${target_kube_context}" "${PLATFORM_NAMESPACE}" platform-postgres statefulset)"

    # Use the stored namespace verbatim — never re-derive it from the subdomain.
    if [[ -n "${state_tenantNamespace}" ]]; then
      tenant_ready="$(deployment_ready_count "${target_kube_context}" "${state_tenantNamespace}" dnd-notes)"
    fi
  else
    control_plane_ready="skipped (kubectl unavailable)"
    keycloak_ready="skipped (kubectl unavailable)"
    postgres_ready="skipped (kubectl unavailable)"
    if [[ -n "${state_tenantNamespace}" ]]; then
      tenant_ready="skipped (kubectl unavailable)"
    fi
  fi

  probe_tenant_url "${state_tenantOrigin}"
fi

# ---------------------------------------------------------------------------
# Emit status
# ---------------------------------------------------------------------------
if [[ "${JSON_OUTPUT}" == "true" ]]; then
  # Load the full state for enriched output; fall back to empty object on error
  state_json="{}"
  if [[ -f "${STATE_FILE}" ]]; then
    state_json="$(cat "${STATE_FILE}")"
  fi

  node -e '
    const [
      clusterName, clusterRunning,
      cpReady, kcReady, pgReady,
      tenantId, tenantSubdomain, tenantNamespace, tenantHostname, tenantOrigin,
      tenantReady, tenantUrlReachable, tenantUrlProbeSkipped,
      stateValid, stateFile, stateJson,
    ] = process.argv.slice(1)

    // Merge live probe data into the persisted state so callers get one
    // unified document with both stable fields and live readiness info.
    let persisted = {}
    try { persisted = JSON.parse(stateJson) } catch {}

    // Preserve all persisted tenant fields (including lifecycle state) and
    // layer live probe data on top so tenants[0].state is never dropped.
    const persistedTenant = Array.isArray(persisted.tenants) && persisted.tenants[0]
      ? persisted.tenants[0]
      : {}

    const status = {
      ...persisted,
      clusterName,
      clusterRunning: clusterRunning === "true",
      stateValid: stateValid === "true",
      stateFile,
      components: {
        controlPlane: { ready: cpReady },
        keycloak:     { ready: kcReady },
        postgres:     { ready: pgReady },
      },
      tenants: tenantId
        ? [
            {
              ...persistedTenant,
              id: tenantId,
              subdomain: tenantSubdomain,
              namespace: tenantNamespace,
              hostname: tenantHostname,
              origin: tenantOrigin,
              deployment: tenantReady,
              urlReachable: tenantUrlReachable === "true",
              urlProbeSkipped: tenantUrlProbeSkipped === "true",
            },
          ]
        : [],
    }

    process.stdout.write(JSON.stringify(status, null, 2) + "\n")
  ' \
    "${CLUSTER_NAME}" \
    "${cluster_running}" \
    "${control_plane_ready}" \
    "${keycloak_ready}" \
    "${postgres_ready}" \
    "${state_tenantId}" \
    "${state_tenantSubdomain}" \
    "${state_tenantNamespace}" \
    "${state_tenantHostname}" \
    "${state_tenantOrigin}" \
    "${tenant_ready}" \
    "${tenant_url_reachable}" \
    "${tenant_url_probe_skipped}" \
    "${state_valid}" \
    "${STATE_FILE}" \
    "${state_json}"
else
  echo "k3d platform status"
  echo "==================="
  echo
  if [[ "${cluster_running}" == "true" ]]; then
    echo "Cluster:        k3d-${CLUSTER_NAME} (running)"
  elif [[ "${k3d_available}" != "true" ]]; then
    echo "Cluster:        k3d-${CLUSTER_NAME} (unknown — k3d unavailable)"
  else
    echo "Cluster:        k3d-${CLUSTER_NAME} (NOT running)"
  fi

  if [[ "${state_valid}" == "true" ]]; then
    echo "State file:     ${STATE_FILE} (ok)"
  elif [[ -f "${STATE_FILE}" ]]; then
    echo "State file:     ${STATE_FILE} (CORRUPT — run k3d:up to recover)"
  else
    echo "State file:     not found (run k3d:up)"
  fi

  echo
  echo "Components:"
  echo "  control-plane: ${control_plane_ready}"
  echo "  keycloak:      ${keycloak_ready}"
  echo "  postgres:      ${postgres_ready}"

  if [[ -n "${state_tenantId}" ]]; then
    echo
    echo "Tenant: ${state_tenantId}"
    echo "  Subdomain:   ${state_tenantSubdomain}"
    echo "  Namespace:   ${state_tenantNamespace}"
    echo "  URL:         ${state_tenantOrigin}"
    echo "  Deployment:  ${tenant_ready}"
    if [[ "${tenant_url_probe_skipped}" == "true" ]]; then
      echo "  HTTP /ready: skipped (curl unavailable)"
    elif [[ "${tenant_url_reachable}" == "true" ]]; then
       echo "  HTTP /ready: ok"
     else
       echo "  HTTP /ready: unreachable"
    fi
  else
    echo
    echo "Tenant: none provisioned"
  fi
fi
