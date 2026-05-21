#!/usr/bin/env bash
# promote-prod-image.sh — retag a sha-<commit> build to a prod-<date> protected tag
#
# Usage:
#   promote-prod-image.sh <sha-TAG> [<prod-TAG>]
#
#   <sha-TAG>   Required. The source sha-* build tag (e.g. sha-e570cc1).
#   <prod-TAG>  Optional. The destination prod-* tag to create.
#               Defaults to prod-YYYYMMDD (UTC). Use prod-YYYYMMDD-HHMMSSZ
#               when promoting more than once on the same calendar day.
#
# What this does:
#   Retags all 5 GHCR images from <sha-TAG> to <prod-TAG> using
#   `docker buildx imagetools create --tag`. This does NOT rebuild any image —
#   the same layers are referenced under the new tag. The prod-* tag is then
#   excluded from sha-* retention cleanup (see deployment-artifacts.yml) and
#   will not be deleted by CI churn.
#
# After running this script, update deploy/k3s/overlays/prod/kustomization.yaml
# to pin the images to the new prod-* tag and commit.
#
# Prerequisites:
#   - docker (with buildx)
#   - Logged in to GHCR: `docker login ghcr.io` or via GITHUB_TOKEN
#
# The script fails loudly if any source tag is absent. It never echoes
# credentials. All operations are idempotent — re-running with the same
# arguments is safe.

set -Euo pipefail

# Bash 4.4+ optional hardening: inherit errexit into subshells / command
# substitutions. Guarded so Bash 3.2 (macOS default) still runs the script.
if [[ "${BASH_VERSINFO[0]:-0}" -ge 4 && "${BASH_VERSINFO[1]:-0}" -ge 4 ]]; then
  shopt -s inherit_errexit
fi

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGISTRY="ghcr.io"
ORG="daydream-software"
IMAGE_PREFIX="${REGISTRY}/${ORG}"

IMAGES=(
  "dnd-notes"
  "dnd-notes-control-plane"
  "dnd-notes-customer-portal"
  "dnd-notes-operator-portal"
  "dnd-notes-activator"
)

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

usage() {
  grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -20
  exit 1
}

if [[ $# -lt 1 ]]; then
  echo "error: missing required argument <sha-TAG>" >&2
  usage
fi

SRC_TAG="$1"
DEST_TAG="${2:-}"

# Default destination tag: prod-YYYYMMDD (UTC).
if [[ -z "${DEST_TAG}" ]]; then
  DEST_TAG="prod-$(date -u +%Y%m%d)"
fi

# Validate tag formats.
if [[ ! "${SRC_TAG}" =~ ^sha-[0-9a-f]{7,40}$ ]]; then
  echo "error: source tag '${SRC_TAG}' does not look like a sha-* build tag" >&2
  exit 1
fi
if [[ ! "${DEST_TAG}" =~ ^prod- ]]; then
  echo "error: destination tag '${DEST_TAG}' must start with 'prod-'" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "error: 'docker' is required but not found in PATH" >&2
  exit 1
fi

# Check that buildx is available (optional subcommand — degrade with a clear
# message rather than an opaque docker error).
if ! docker buildx version >/dev/null 2>&1; then
  echo "error: 'docker buildx' is required but not available" >&2
  echo "  Install Docker Desktop or run: docker plugin install moby/buildkit" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify all source tags exist before touching anything
# ---------------------------------------------------------------------------

echo "Verifying source tags exist in GHCR..."
MISSING=()

for IMAGE in "${IMAGES[@]}"; do
  SRC="${IMAGE_PREFIX}/${IMAGE}:${SRC_TAG}"
  if ! docker buildx imagetools inspect "${SRC}" >/dev/null 2>&1; then
    MISSING+=("${SRC}")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "error: the following source images were not found in GHCR:" >&2
  for M in "${MISSING[@]}"; do
    echo "  ${M}" >&2
  done
  echo "" >&2
  echo "Ensure CI has pushed this sha-* tag before promoting." >&2
  exit 1
fi

echo "All source tags verified."

# ---------------------------------------------------------------------------
# Promote: retag each image
# ---------------------------------------------------------------------------

echo "Promoting ${SRC_TAG} -> ${DEST_TAG} for all 5 images..."
echo ""

for IMAGE in "${IMAGES[@]}"; do
  SRC="${IMAGE_PREFIX}/${IMAGE}:${SRC_TAG}"
  DEST="${IMAGE_PREFIX}/${IMAGE}:${DEST_TAG}"
  echo "  ${IMAGE}: ${SRC_TAG} -> ${DEST_TAG}"
  docker buildx imagetools create --tag "${DEST}" "${SRC}"
done

echo ""
echo "Promotion complete. All images are now tagged ${DEST_TAG}."
echo ""
echo "Next steps:"
echo "  1. Update deploy/k3s/overlays/prod/kustomization.yaml — set newTag: ${DEST_TAG}"
echo "     on all 5 image entries."
echo "  2. Commit and apply: kubectl kustomize deploy/k3s/overlays/prod | kubectl apply -f -"
echo ""
echo "The ${DEST_TAG} tag is excluded from sha-* retention cleanup and will not"
echo "be deleted by CI churn (see deployment-artifacts.yml ignore-versions)."
