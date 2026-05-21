#!/usr/bin/env bash
# Unified image build + k3d import script.
# Replaces the four former build-*-image.sh scripts.
#
# Usage:
#   build-image.sh --name <name> --dockerfile <path> --repo <repo> \
#                  [--tag <tag>] [--build-arg KEY=VALUE ...] [--help]
#
# Environment overrides (same as the individual scripts):
#   K3D_CLUSTER_NAME, K3D_IMAGE_IMPORT_MODE, K3D_IMAGE_IMPORT_FALLBACK_MODE,
#   K3D_IMAGE_IMPORT_TIMEOUT_SECONDS
set -euo pipefail
export DOCKER_BUILDKIT=1

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
IMAGE_IMPORT_MODE="${K3D_IMAGE_IMPORT_MODE:-direct}"
IMAGE_IMPORT_FALLBACK_MODE="${K3D_IMAGE_IMPORT_FALLBACK_MODE:-tools}"
IMAGE_IMPORT_TIMEOUT_SECONDS="${K3D_IMAGE_IMPORT_TIMEOUT_SECONDS:-180}"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
IMAGE_NAME=""
DOCKERFILE=""
IMAGE_REPO=""
IMAGE_TAG="k3d"
DOCKER_BUILD_ARGS=()

usage() {
  cat <<'EOF'
Build a Docker image from the repo and import it into k3d.

  --name <name>           Human-readable label (used in log messages)
  --dockerfile <path>     Dockerfile path relative to repo root
  --repo <repo>           Image repository (e.g. ghcr.io/org/name)
  --tag <tag>             Image tag (default: k3d)
  --build-arg KEY=VALUE   Passed through to docker build (repeatable)
  --help                  Show this message and exit

Environment overrides:
  K3D_CLUSTER_NAME                Cluster name (default: dnd-notes)
  K3D_IMAGE_IMPORT_MODE           k3d image import mode (default: direct)
  K3D_IMAGE_IMPORT_FALLBACK_MODE  retry mode when the primary import stalls/fails (default: tools)
  K3D_IMAGE_IMPORT_TIMEOUT_SECONDS  per-import timeout in seconds (default: 180)
EOF
}

require_value() {
  if (( $# < 2 )); then
    echo "Missing value for $1" >&2
    usage
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)        require_value "$@"; IMAGE_NAME="$2";  shift 2 ;;
    --dockerfile)  require_value "$@"; DOCKERFILE="$2";  shift 2 ;;
    --repo)        require_value "$@"; IMAGE_REPO="$2";  shift 2 ;;
    --tag)         require_value "$@"; IMAGE_TAG="$2";   shift 2 ;;
    --build-arg)   require_value "$@"; DOCKER_BUILD_ARGS+=("--build-arg" "$2"); shift 2 ;;
    --help)        usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

for required_var in IMAGE_NAME DOCKERFILE IMAGE_REPO; do
  if [[ -z "${!required_var}" ]]; then
    echo "Missing required argument: --${required_var//_/-}" >&2
    usage
    exit 1
  fi
done

IMAGE_REF="${IMAGE_REPO}:${IMAGE_TAG}"

# ---------------------------------------------------------------------------
# Tool checks
# ---------------------------------------------------------------------------
require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

cluster_exists() {
  k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fx "$CLUSTER_NAME" >/dev/null
}

for tool in docker k3d; do
  require_tool "$tool"
done

if ! cluster_exists; then
  echo "k3d cluster ${CLUSTER_NAME} does not exist. Run scripts/k3d/bootstrap.sh first." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "Building ${IMAGE_NAME} image ${IMAGE_REF}..."
docker build \
  -f "${ROOT}/${DOCKERFILE}" \
  "${DOCKER_BUILD_ARGS[@]+"${DOCKER_BUILD_ARGS[@]}"}" \
  -t "${IMAGE_REF}" \
  "${ROOT}"

# ---------------------------------------------------------------------------
# Import into k3d
# ---------------------------------------------------------------------------
run_image_import() {
  local mode="$1"
  local status=0

  echo "Importing ${IMAGE_REF} into k3d cluster ${CLUSTER_NAME} with mode ${mode}..."
  if command -v timeout >/dev/null 2>&1; then
    if timeout "${IMAGE_IMPORT_TIMEOUT_SECONDS}" \
      k3d image import --mode "${mode}" -c "${CLUSTER_NAME}" "${IMAGE_REF}"; then
      return 0
    fi
    status=$?
    return "${status}"
  fi

  if k3d image import --mode "${mode}" -c "${CLUSTER_NAME}" "${IMAGE_REF}"; then
    return 0
  fi
  status=$?
  return "${status}"
}

# Verify the image actually landed in the cluster's containerd. k3d's `direct`
# import mode can exit 0 WITHOUT the image fully landing on a node (more likely
# for large images) — a silent false success that surfaces later as
# ImagePullBackOff on an IfNotPresent pod. Check every server/agent node
# container (skip the *-serverlb load balancer, which has no containerd) and
# match crictl's "REPO TAG" columns exactly.
image_present_in_cluster() {
  local node node_count=0
  for node in $(docker ps --filter "label=k3d.cluster=${CLUSTER_NAME}" --format '{{.Names}}' 2>/dev/null); do
    case "${node}" in *serverlb*) continue ;; esac
    node_count=$((node_count + 1))
    if ! docker exec "${node}" crictl images 2>/dev/null \
      | awk -v repo="${IMAGE_REF%:*}" -v tag="${IMAGE_REF##*:}" \
          '$1==repo && $2==tag {f=1} END{exit f?0:1}'; then
      return 1
    fi
  done
  # If we couldn't enumerate any node container, we cannot verify — don't block
  # the build (e.g. an unusual local setup); the import return code stands.
  [ "${node_count}" -eq 0 ] && return 0
  return 0
}

# Import, then confirm the image is really present. A clean exit code from
# `k3d image import` is necessary but not sufficient (see image_present_in_cluster).
import_and_verify() {
  local mode="$1"
  run_image_import "${mode}" || return 1
  if ! image_present_in_cluster; then
    echo "Import (mode ${mode}) exited 0 but ${IMAGE_REF} is NOT present in the cluster node containerd; treating as failed." >&2
    return 1
  fi
  return 0
}

if ! import_and_verify "${IMAGE_IMPORT_MODE}"; then
  if [[ "${IMAGE_IMPORT_FALLBACK_MODE}" == "${IMAGE_IMPORT_MODE}" ]]; then
    echo "Image import failed/unverified with mode ${IMAGE_IMPORT_MODE} and no alternate fallback mode is configured." >&2
    exit 1
  fi

  echo "Image import with mode ${IMAGE_IMPORT_MODE} failed or did not land; retrying with ${IMAGE_IMPORT_FALLBACK_MODE}." >&2
  if ! import_and_verify "${IMAGE_IMPORT_FALLBACK_MODE}"; then
    echo "Image ${IMAGE_REF} did not land in the cluster after both modes (${IMAGE_IMPORT_MODE}, ${IMAGE_IMPORT_FALLBACK_MODE})." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# CI: prune host-side images after k3d import to keep runner disk headroom.
# Note: docker builder prune removes BuildKit cache mounts; the npm cache
# benefit is local-dev only when CI=true.
# ---------------------------------------------------------------------------
if [[ "${CI:-}" == "true" ]]; then
  echo "CI=true; pruning host-side Docker images after k3d import to keep runner disk headroom..."
  docker image rm "${IMAGE_REF}" >/dev/null 2>&1 || true
  docker image prune -af >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
fi

echo "${IMAGE_NAME} image ready in k3d: ${IMAGE_REF}"
