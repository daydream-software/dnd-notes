#!/usr/bin/env bash
# Shared platform Secret provisioning for the unified deploy/k3s tree (epic #362).
#
# ONE mechanism creates every platform Secret in the dnd-notes-platform
# namespace, for BOTH local k3d and production. Values are read from environment
# variables. In --mode k3d, insecure local-only defaults are filled in for any
# unset variable. In --mode prod, every required secret value must be supplied
# via the environment; the script fails loudly (listing the missing names)
# rather than provisioning a half-blank secret.
#
# All secrets are created idempotently:
#   kubectl create secret ... --dry-run=client -o yaml | kubectl apply -f -
# so re-running is safe and picks up changed values.
#
# Kube context discipline: this script NEVER changes the caller's current
# kube-context. It uses whatever context the caller has selected. Callers that
# must target a specific cluster set it themselves:
#   - scripts/k3d/up.sh / bootstrap.sh run `kubectl config use-context k3d-...`
#     before invoking this script.
#   - prod operators export KUBECTL_CONTEXT=dnd-notes-prod (or pass
#     --context dnd-notes-prod) so every kubectl call is pinned without mutating
#     their default context.
#
# Secrets are never echoed. Do not enable `set -x` around the create calls.
#
# Usage:
#   provision-secrets.sh --mode <k3d|prod> [--context CTX] [SECRET ...]
#
# SECRET selectors (default: all):
#   postgres          platform-postgres-credentials
#   keycloak-bootstrap keycloak-bootstrap-env
#   realm-dev         keycloak-realm-dev-secrets   (k3d mode only)
#   control-plane     dnd-notes-control-plane-secrets
#   activator         dnd-notes-activator-secrets
#   all               every secret valid for the mode (default)
#
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

PLATFORM_NAMESPACE="dnd-notes-platform"

MODE=""
KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-}"
SELECTORS=""

usage() {
  cat <<'EOF'
Provision platform Secrets in the dnd-notes-platform namespace.

Usage:
  provision-secrets.sh --mode <k3d|prod> [--context CTX] [SECRET ...]

Options:
  --mode k3d    Fill insecure local-only defaults for any unset variable.
  --mode prod   Require every real secret value via the environment; fail loudly
                (listing missing names) if any required variable is unset.
  --context CTX Pass --context CTX to every kubectl call (does not change the
                caller's current context). Also settable via KUBECTL_CONTEXT.
  -h, --help    Show this help.

SECRET selectors (default: all):
  postgres            platform-postgres-credentials
  keycloak-bootstrap  keycloak-bootstrap-env
  realm-dev           keycloak-realm-dev-secrets  (k3d mode only; ignored in prod)
  control-plane       dnd-notes-control-plane-secrets
  activator           dnd-notes-activator-secrets
  all                 every secret valid for the mode

Environment variables (k3d defaults shown in parentheses):
  PLATFORM_POSTGRES_USER       (postgres)
  PLATFORM_POSTGRES_PASSWORD   (postgres)
  PLATFORM_POSTGRES_DB         (postgres)
  KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME (admin)
  KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD (admin)
  CONTROL_PLANE_ADMIN_TOKEN    (k3d: local-admin-token; prod: optional, omitted if unset)
  CONTROL_PLANE_DATABASE_URL   (k3d: in-cluster postgres URL)
  TENANT_DATABASE_ADMIN_URL    (k3d: in-cluster postgres URL)
  TENANT_DATABASE_RUNTIME_URL  (k3d: in-cluster runtime-template URL)
  KEYCLOAK_ADMIN_CLIENT_ID     (optional in both modes; key omitted if unset)
  KEYCLOAK_ADMIN_CLIENT_SECRET (optional in both modes; key omitted if unset)
  ACTIVATOR_CONTROL_PLANE_DATABASE_URL (k3d: in-cluster control_plane URL;
                                        defaults to CONTROL_PLANE_DATABASE_URL)
  KC_DEV_OWNER_PASSWORD        (k3d realm-dev: password)
  KC_DEV_OPS_PASSWORD          (k3d realm-dev: password)
  KC_DEV_SITE_ADMIN_PASSWORD   (k3d realm-dev: password)
  KC_DEV_ADMIN_CLIENT_SECRET   (k3d realm-dev: dev-admin-client-secret)
EOF
}

# kubectl wrapper that pins --context when one is configured, without mutating
# the caller's current-context.
kc() {
  if [ -n "${KUBECTL_CONTEXT}" ]; then
    kubectl --context "${KUBECTL_CONTEXT}" "$@"
  else
    kubectl "$@"
  fi
}

# Apply a generic Secret idempotently from key=value literal pairs passed as
# subsequent arguments (each "KEY=VALUE"). Secret values never reach the logs:
# the rendered YAML is piped straight into `kubectl apply`.
apply_secret() {
  local name="$1"
  shift
  local args=()
  local pair
  for pair in "$@"; do
    args+=(--from-literal="${pair}")
  done
  kc -n "${PLATFORM_NAMESPACE}" create secret generic "${name}" \
    "${args[@]}" \
    --dry-run=client -o yaml \
    | kc apply -f - >/dev/null
  echo "Provisioned secret ${name}"
}

# Collected missing-required-variable names (prod mode), reported together.
MISSING_REQUIRED=""

# require VAR_NAME — in prod mode, record VAR_NAME as missing if it is unset or
# empty. In k3d mode this is never called (defaults are applied instead).
require() {
  local var_name="$1"
  # Indirect expansion, bash-3.2 compatible.
  if [ -z "${!var_name:-}" ]; then
    MISSING_REQUIRED="${MISSING_REQUIRED} ${var_name}"
  fi
}

fail_if_missing() {
  if [ -n "${MISSING_REQUIRED}" ]; then
    echo "Error: --mode prod requires these environment variables to be set:" >&2
    local v
    for v in ${MISSING_REQUIRED}; do
      echo "  - ${v}" >&2
    done
    echo "Set them (e.g. source a secured env file) and re-run." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Per-secret provisioning functions. Each resolves values per mode, then calls
# apply_secret. Required-variable checks for prod accumulate into
# MISSING_REQUIRED; the caller runs fail_if_missing before any apply.
# ---------------------------------------------------------------------------

provision_postgres() {
  local user password db
  if [ "${MODE}" = "k3d" ]; then
    user="${PLATFORM_POSTGRES_USER:-postgres}"
    password="${PLATFORM_POSTGRES_PASSWORD:-postgres}"
    db="${PLATFORM_POSTGRES_DB:-postgres}"
  else
    require PLATFORM_POSTGRES_USER
    require PLATFORM_POSTGRES_PASSWORD
    require PLATFORM_POSTGRES_DB
    fail_if_missing
    user="${PLATFORM_POSTGRES_USER}"
    password="${PLATFORM_POSTGRES_PASSWORD}"
    db="${PLATFORM_POSTGRES_DB}"
  fi
  apply_secret platform-postgres-credentials \
    "POSTGRES_USER=${user}" \
    "POSTGRES_PASSWORD=${password}" \
    "POSTGRES_DB=${db}"
}

provision_keycloak_bootstrap() {
  local kc_user kc_password
  if [ "${MODE}" = "k3d" ]; then
    kc_user="${KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME:-admin}"
    kc_password="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:-admin}"
  else
    require KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME
    require KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD
    fail_if_missing
    kc_user="${KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME}"
    kc_password="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD}"
  fi
  apply_secret keycloak-bootstrap-env \
    "KC_BOOTSTRAP_ADMIN_USERNAME=${kc_user}" \
    "KC_BOOTSTRAP_ADMIN_PASSWORD=${kc_password}"
}

# k3d-only: dev credentials injected into the Keycloak container as env vars so
# the realm import substitutes the ${KC_DEV_*} placeholders in the committed
# realm seed. Never provisioned in prod (the prod base realm seed carries no
# committed secrets — the admin client secret is auto-generated on import).
provision_realm_dev() {
  if [ "${MODE}" != "k3d" ]; then
    echo "Skipping keycloak-realm-dev-secrets: only provisioned in --mode k3d" >&2
    return 0
  fi
  apply_secret keycloak-realm-dev-secrets \
    "KC_DEV_OWNER_PASSWORD=${KC_DEV_OWNER_PASSWORD:-password}" \
    "KC_DEV_OPS_PASSWORD=${KC_DEV_OPS_PASSWORD:-password}" \
    "KC_DEV_SITE_ADMIN_PASSWORD=${KC_DEV_SITE_ADMIN_PASSWORD:-password}" \
    "KC_DEV_ADMIN_CLIENT_SECRET=${KC_DEV_ADMIN_CLIENT_SECRET:-dev-admin-client-secret}"
}

provision_control_plane() {
  local pg_url admin_url runtime_url admin_token
  local pairs=()
  if [ "${MODE}" = "k3d" ]; then
    pg_url="${CONTROL_PLANE_DATABASE_URL:-postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/control_plane}"
    admin_url="${TENANT_DATABASE_ADMIN_URL:-postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/postgres}"
    runtime_url="${TENANT_DATABASE_RUNTIME_URL:-postgresql://runtime-template:placeholder@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/postgres?sslmode=disable}"
    admin_token="${CONTROL_PLANE_ADMIN_TOKEN:-local-admin-token}"
    pairs+=("CONTROL_PLANE_ADMIN_TOKEN=${admin_token}")
  else
    require CONTROL_PLANE_DATABASE_URL
    require TENANT_DATABASE_ADMIN_URL
    require TENANT_DATABASE_RUNTIME_URL
    fail_if_missing
    pg_url="${CONTROL_PLANE_DATABASE_URL}"
    admin_url="${TENANT_DATABASE_ADMIN_URL}"
    runtime_url="${TENANT_DATABASE_RUNTIME_URL}"
    # CONTROL_PLANE_ADMIN_TOKEN is NOT required in prod: the prod overlay runs
    # CONTROL_PLANE_AUTH_MODE=keycloak, which ignores the static admin token.
    # Include the key only when an operator explicitly sets it.
    if [ -n "${CONTROL_PLANE_ADMIN_TOKEN:-}" ]; then
      pairs+=("CONTROL_PLANE_ADMIN_TOKEN=${CONTROL_PLANE_ADMIN_TOKEN}")
    fi
  fi

  pairs+=("CONTROL_PLANE_DATABASE_URL=${pg_url}")
  pairs+=("TENANT_DATABASE_ADMIN_URL=${admin_url}")
  pairs+=("TENANT_DATABASE_RUNTIME_URL=${runtime_url}")

  # KEYCLOAK_ADMIN_CLIENT_ID / _SECRET are optional in BOTH modes. The control-
  # plane instantiates its Keycloak admin client only when BOTH are present
  # (apps/control-plane/src/index.ts). k3d intentionally omits them today
  # (per-tenant client creation runs via the realm-seeded service account), so
  # they stay omitted unless an operator sets them — keeping k3d behavior
  # unchanged. In prod they are set after the first deploy (see the runbook).
  if [ -n "${KEYCLOAK_ADMIN_CLIENT_ID:-}" ]; then
    pairs+=("KEYCLOAK_ADMIN_CLIENT_ID=${KEYCLOAK_ADMIN_CLIENT_ID}")
  fi
  if [ -n "${KEYCLOAK_ADMIN_CLIENT_SECRET:-}" ]; then
    pairs+=("KEYCLOAK_ADMIN_CLIENT_SECRET=${KEYCLOAK_ADMIN_CLIENT_SECRET}")
  fi

  apply_secret dnd-notes-control-plane-secrets "${pairs[@]}"
}

provision_activator() {
  local url
  if [ "${MODE}" = "k3d" ]; then
    # Default to the same control_plane URL the control-plane uses. The activator
    # reads/writes tenant_activity and reads tenants in the control_plane DB.
    url="${ACTIVATOR_CONTROL_PLANE_DATABASE_URL:-${CONTROL_PLANE_DATABASE_URL:-postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/control_plane}}"
  else
    # Prod: the activator's CONTROL_PLANE_DATABASE_URL is the remaining real half
    # of #363 — without this secret a prod scale-to-zero deploy has an activator
    # that cannot boot. Accept ACTIVATOR_CONTROL_PLANE_DATABASE_URL, falling back
    # to the control-plane's CONTROL_PLANE_DATABASE_URL when they share a DB.
    url="${ACTIVATOR_CONTROL_PLANE_DATABASE_URL:-${CONTROL_PLANE_DATABASE_URL:-}}"
    if [ -z "${url}" ]; then
      echo "Error: --mode prod requires ACTIVATOR_CONTROL_PLANE_DATABASE_URL (or CONTROL_PLANE_DATABASE_URL) to be set for dnd-notes-activator-secrets." >&2
      exit 1
    fi
  fi
  apply_secret dnd-notes-activator-secrets \
    "CONTROL_PLANE_DATABASE_URL=${url}"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --mode=*)
      MODE="${1#--mode=}"
      shift
      ;;
    --context)
      KUBECTL_CONTEXT="${2:-}"
      shift 2
      ;;
    --context=*)
      KUBECTL_CONTEXT="${1#--context=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    postgres|keycloak-bootstrap|realm-dev|control-plane|activator|all)
      SELECTORS="${SELECTORS} $1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "${MODE}" != "k3d" ] && [ "${MODE}" != "prod" ]; then
  echo "Error: --mode must be 'k3d' or 'prod' (got: '${MODE:-<unset>}')." >&2
  usage >&2
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "Missing required tool: kubectl" >&2
  exit 1
fi

# Default selector set per mode. realm-dev is k3d-only and excluded from prod's
# implicit "all".
if [ -z "${SELECTORS// }" ]; then
  if [ "${MODE}" = "k3d" ]; then
    SELECTORS="postgres keycloak-bootstrap realm-dev control-plane activator"
  else
    SELECTORS="postgres keycloak-bootstrap control-plane activator"
  fi
fi

# Expand the "all" selector to the mode's full set.
case " ${SELECTORS} " in
  *" all "*)
    if [ "${MODE}" = "k3d" ]; then
      SELECTORS="postgres keycloak-bootstrap realm-dev control-plane activator"
    else
      SELECTORS="postgres keycloak-bootstrap control-plane activator"
    fi
    ;;
esac

for selector in ${SELECTORS}; do
  case "${selector}" in
    postgres)            provision_postgres ;;
    keycloak-bootstrap)  provision_keycloak_bootstrap ;;
    realm-dev)           provision_realm_dev ;;
    control-plane)       provision_control_plane ;;
    activator)           provision_activator ;;
  esac
done
