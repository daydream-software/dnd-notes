# Source .env from the repo root if present. Designed to be sourced (not executed)
# from k3d entry-point scripts so per-developer config (e.g. CAROOT) doesn't have
# to be exported manually before every `npm run k3d:*` invocation.
#
# Variables defined in .env take precedence over inherited shell env, matching
# what most dotenv loaders do.
#
# Usage (after the script defines ROOT):
#   # shellcheck source=scripts/k3d/_load-dotenv.sh
#   source "${ROOT}/scripts/k3d/_load-dotenv.sh"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi
