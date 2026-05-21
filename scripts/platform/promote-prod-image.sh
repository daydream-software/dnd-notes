#!/usr/bin/env bash
# promote-prod-image.sh — retag a sha-<commit> build to a prod-<date> protected tag
#
# Usage:
#   promote-prod-image.sh [--force] <sha-TAG> [<prod-TAG>]
#
#   --force     Optional. Overwrite an existing destination tag even when it
#               points to a different digest than the source. Without this flag
#               the script aborts if the destination tag already exists and
#               resolves to a different digest (safety guard against silently
#               repointing a live prod tag).
#
#   <sha-TAG>   Required. The source sha-* build tag (e.g. sha-e570cc1).
#   <prod-TAG>  Optional. The destination prod-* tag to create.
#               Defaults to prod-YYYYMMDD (UTC). Use prod-YYYYMMDD-HHMMSSZ
#               when promoting more than once on the same calendar day.
#               Must match ^prod-[0-9]{8}(-[0-9]{6}z)?$
#
# What this does:
#   Retags all 5 GHCR images from <sha-TAG> to <prod-TAG> using
#   `docker buildx imagetools create --tag`. This does NOT rebuild any image —
#   the same layers are referenced under the new tag. The prod-* tag is then
#   excluded from sha-* retention cleanup (see deployment-artifacts.yml) and
#   will not be deleted by CI churn.
#
# Safety behaviour:
#   Before tagging each image the script checks whether the destination tag
#   already exists. Three outcomes:
#     - DEST absent              -> proceed (normal first promotion).
#     - DEST present, same digest as SRC -> no-op (already promoted, safe).
#     - DEST present, different digest   -> abort with an error unless --force
#       is passed. This prevents silently moving a live prod tag to a
#       different build.
#
# After running this script, update deploy/k3s/overlays/prod/kustomization.yaml
# to pin the images to the new prod-* tag and commit.
#
# Prerequisites:
#   - docker (with buildx)
#   - Logged in to GHCR: `docker login ghcr.io` or via GITHUB_TOKEN
#
# The script fails loudly if any source tag is absent. It never echoes
# credentials. Re-running with the same arguments is safe (already-promoted
# images are skipped as no-ops).

set -Eeuo pipefail

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
  # Print the leading comment block up to (but not including) the first non-# line.
  awk '/^[^#]/{exit} {sub(/^# ?/,""); print}' "$0"
  exit 1
}

FORCE=0

# Parse optional --force flag before positional arguments.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --) shift; break ;;
    -*) echo "error: unknown flag '$1'" >&2; usage ;;
    *) break ;;
  esac
done

if [[ $# -lt 1 ]]; then
  echo "error: missing required argument <sha-TAG>" >&2
  usage
fi

SRC_TAG="${1}"
DEST_TAG="${2:-}"

# Trim surrounding whitespace (guards against copy-paste with trailing spaces).
SRC_TAG="${SRC_TAG// /}"
DEST_TAG="${DEST_TAG// /}"

# Default destination tag: prod-YYYYMMDD (UTC).
if [[ -z "${DEST_TAG}" ]]; then
  DEST_TAG="prod-$(date -u +%Y%m%d)"
fi

# Validate tag formats.
if [[ ! "${SRC_TAG}" =~ ^sha-[0-9a-f]{7,40}$ ]]; then
  echo "error: source tag '${SRC_TAG}' does not look like a sha-* build tag" >&2
  exit 1
fi
# Destination must match the documented form: prod-YYYYMMDD or prod-YYYYMMDD-HHMMSSz
if [[ ! "${DEST_TAG}" =~ ^prod-[0-9]{8}(-[0-9]{6}z)?$ ]]; then
  echo "error: destination tag '${DEST_TAG}' must match prod-YYYYMMDD or prod-YYYYMMDD-HHMMSSz" >&2
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

  # Resolve manifest digest for clobber guard.
  # --format '{{.Manifest.Digest}}' returns the top-level manifest (or manifest
  # list) digest — the same value the registry uses as the canonical reference.
  SRC_DIGEST=$(docker buildx imagetools inspect \
    --format '{{.Manifest.Digest}}' "${SRC}" 2>/dev/null || true)

  if docker buildx imagetools inspect "${DEST}" >/dev/null 2>&1; then
    # Destination tag already exists — compare digests.
    DEST_DIGEST=$(docker buildx imagetools inspect \
      --format '{{.Manifest.Digest}}' "${DEST}" 2>/dev/null || true)

    if [[ -n "${SRC_DIGEST}" && -n "${DEST_DIGEST}" && "${SRC_DIGEST}" == "${DEST_DIGEST}" ]]; then
      echo "  ${IMAGE}: ${DEST_TAG} already points to same digest — skipping (no-op)."
      continue
    fi

    if [[ "${FORCE}" -eq 0 ]]; then
      echo "error: ${IMAGE}: destination tag ${DEST_TAG} already exists and points to a different" >&2
      echo "       digest than source ${SRC_TAG}." >&2
      echo "       Pass --force to overwrite, or choose a different destination tag." >&2
      exit 1
    fi

    echo "  ${IMAGE}: WARNING — overwriting existing ${DEST_TAG} (--force)."
  fi

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
echo "The ${DEST_TAG} tag is protected from deletion by the tag-aware retention"
echo "script in CI (see scripts/platform/cleanup-ghcr-versions.mjs)."
