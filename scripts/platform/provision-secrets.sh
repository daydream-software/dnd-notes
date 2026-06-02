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
  REALM_DEV_OWNER_PASSWORD        (k3d realm-dev: password)
  REALM_DEV_OPS_PASSWORD          (k3d realm-dev: password)
  REALM_DEV_SITE_ADMIN_PASSWORD   (k3d realm-dev: password)
  REALM_DEV_ADMIN_CLIENT_SECRET   (k3d realm-dev: dev-admin-client-secret)
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
# Per-secret provisioning is split into a REQUIRE phase and an APPLY phase so a
# prod run is all-or-none: the caller runs every selected secret's require_*
# first, then a single fail_if_missing, and only then any apply_*. That way a
# missing variable for a later secret never leaves earlier secrets half-applied.
#
#   require_<secret>   prod: record any missing required vars (no-op in k3d).
#   apply_<secret>     resolve values per mode and create the Secret.
# ---------------------------------------------------------------------------

require_postgres() {
  [ "${MODE}" = "k3d" ] && return 0
  require PLATFORM_POSTGRES_USER
  require PLATFORM_POSTGRES_PASSWORD
  require PLATFORM_POSTGRES_DB
}

apply_postgres() {
  local user password db
  if [ "${MODE}" = "k3d" ]; then
    user="${PLATFORM_POSTGRES_USER:-postgres}"
    password="${PLATFORM_POSTGRES_PASSWORD:-postgres}"
    db="${PLATFORM_POSTGRES_DB:-postgres}"
  else
    user="${PLATFORM_POSTGRES_USER}"
    password="${PLATFORM_POSTGRES_PASSWORD}"
    db="${PLATFORM_POSTGRES_DB}"
  fi
  apply_secret platform-postgres-credentials \
    "POSTGRES_USER=${user}" \
    "POSTGRES_PASSWORD=${password}" \
    "POSTGRES_DB=${db}"
}

require_keycloak_bootstrap() {
  [ "${MODE}" = "k3d" ] && return 0
  require KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME
  require KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD
}

apply_keycloak_bootstrap() {
  local kc_user kc_password
  if [ "${MODE}" = "k3d" ]; then
    kc_user="${KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME:-admin}"
    kc_password="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:-admin}"
  else
    kc_user="${KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME}"
    kc_password="${KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD}"
  fi
  apply_secret keycloak-bootstrap-env \
    "KC_BOOTSTRAP_ADMIN_USERNAME=${kc_user}" \
    "KC_BOOTSTRAP_ADMIN_PASSWORD=${kc_password}"
}

# k3d-only secret: no required vars in any mode (defaults fill in k3d; prod
# skips it entirely in apply_realm_dev).
require_realm_dev() {
  return 0
}

# k3d-only: dev credentials injected into the Keycloak container as env vars so
# the realm import substitutes the ${REALM_DEV_*} placeholders in the committed
# realm seed. Never provisioned in prod (the prod base realm seed carries no
# committed secrets — the admin client secret is auto-generated on import).
apply_realm_dev() {
  if [ "${MODE}" != "k3d" ]; then
    echo "Skipping keycloak-realm-dev-secrets: only provisioned in --mode k3d" >&2
    return 0
  fi
  apply_secret keycloak-realm-dev-secrets \
    "REALM_DEV_OWNER_PASSWORD=${REALM_DEV_OWNER_PASSWORD:-password}" \
    "REALM_DEV_OPS_PASSWORD=${REALM_DEV_OPS_PASSWORD:-password}" \
    "REALM_DEV_SITE_ADMIN_PASSWORD=${REALM_DEV_SITE_ADMIN_PASSWORD:-password}" \
    "REALM_DEV_ADMIN_CLIENT_SECRET=${REALM_DEV_ADMIN_CLIENT_SECRET:-dev-admin-client-secret}"
}

require_control_plane() {
  [ "${MODE}" = "k3d" ] && return 0
  require CONTROL_PLANE_DATABASE_URL
  require TENANT_DATABASE_ADMIN_URL
  require TENANT_DATABASE_RUNTIME_URL
}

apply_control_plane() {
  local pg_url admin_url runtime_url admin_token
  local pairs=()
  if [ "${MODE}" = "k3d" ]; then
    pg_url="${CONTROL_PLANE_DATABASE_URL:-postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/control_plane}"
    admin_url="${TENANT_DATABASE_ADMIN_URL:-postgresql://postgres:postgres@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/postgres}"
    runtime_url="${TENANT_DATABASE_RUNTIME_URL:-postgresql://runtime-template:placeholder@platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/postgres?sslmode=disable}"
    admin_token="${CONTROL_PLANE_ADMIN_TOKEN:-local-admin-token}"
    pairs+=("CONTROL_PLANE_ADMIN_TOKEN=${admin_token}")
  else
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

  # KEYCLOAK_ADMIN_CLIENT_ID / _SECRET wire the control-plane's Keycloak admin
  # client. provisioning.ts uses it to create the per-tenant Keycloak client
  # (`dnd-notes-tenant-{id}`) on every tenant provision. Without both vars the
  # control-plane instantiates `keycloakAdminClient = null` and the per-tenant
  # client step is silently skipped — tenants then 500 with `client_not_found`
  # on first login.
  #
  # k3d defaults: the realm-dev seed (apply_realm_dev) already creates the
  # `dnd-notes-keycloak-admin` confidential client with the well-known secret
  # `dev-admin-client-secret`. Mirror those values into the control-plane
  # secret here so a fresh `k3d:up` ships a working provisioning pipeline by
  # default. Operators can override via env if they're testing a different
  # admin client.
  #
  # Prod: leave unset by default; the secret is wired post-deploy after the
  # realm import auto-generates the admin client secret (see runbook).
  local default_admin_client_id=""
  local default_admin_client_secret=""
  if [ "${MODE}" = "k3d" ]; then
    default_admin_client_id="dnd-notes-keycloak-admin"
    default_admin_client_secret="${REALM_DEV_ADMIN_CLIENT_SECRET:-dev-admin-client-secret}"
  fi
  local resolved_admin_client_id="${KEYCLOAK_ADMIN_CLIENT_ID:-${default_admin_client_id}}"
  local resolved_admin_client_secret="${KEYCLOAK_ADMIN_CLIENT_SECRET:-${default_admin_client_secret}}"
  if [ -n "${resolved_admin_client_id}" ]; then
    pairs+=("KEYCLOAK_ADMIN_CLIENT_ID=${resolved_admin_client_id}")
  fi
  if [ -n "${resolved_admin_client_secret}" ]; then
    pairs+=("KEYCLOAK_ADMIN_CLIENT_SECRET=${resolved_admin_client_secret}")
  fi

  apply_secret dnd-notes-control-plane-secrets "${pairs[@]}"
}

require_activator() {
  [ "${MODE}" = "k3d" ] && return 0
  # Prod requires the activator's control_plane DB URL — either its own override
  # or the shared CONTROL_PLANE_DATABASE_URL. Record a synthetic name (rather
  # than calling `require` on a single var) so the all-at-once missing-var report
  # explains the OR relationship.
  if [ -z "${ACTIVATOR_CONTROL_PLANE_DATABASE_URL:-}" ] && [ -z "${CONTROL_PLANE_DATABASE_URL:-}" ]; then
    # No spaces: fail_if_missing word-splits MISSING_REQUIRED on whitespace, so
    # the OR relationship is spelled with slashes to stay one token / one bullet.
    MISSING_REQUIRED="${MISSING_REQUIRED} ACTIVATOR_CONTROL_PLANE_DATABASE_URL(or/CONTROL_PLANE_DATABASE_URL)"
  fi
}

apply_activator() {
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
    # Presence is enforced in require_activator before any apply runs.
    url="${ACTIVATOR_CONTROL_PLANE_DATABASE_URL:-${CONTROL_PLANE_DATABASE_URL:-}}"
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

# Phase 1 (require): collect every selected secret's required-variable gaps so a
# prod run reports them all at once. No-op in k3d mode (defaults fill in).
for selector in ${SELECTORS}; do
  case "${selector}" in
    postgres)            require_postgres ;;
    keycloak-bootstrap)  require_keycloak_bootstrap ;;
    realm-dev)           require_realm_dev ;;
    control-plane)       require_control_plane ;;
    activator)           require_activator ;;
  esac
done

# Single gate before any Secret is written: in prod, if anything is missing we
# exit here having applied nothing (all-or-none). In k3d this is always clean.
fail_if_missing

# Phase 2 (apply): every required variable is present — create each Secret.
for selector in ${SELECTORS}; do
  case "${selector}" in
    postgres)            apply_postgres ;;
    keycloak-bootstrap)  apply_keycloak_bootstrap ;;
    realm-dev)           apply_realm_dev ;;
    control-plane)       apply_control_plane ;;
    activator)           apply_activator ;;
  esac
done
