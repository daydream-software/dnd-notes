#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
TENANT_IMAGE_REPOSITORY="${TENANT_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes}"
TENANT_IMAGE_TAG="${TENANT_IMAGE_TAG:-k3d}"
IMAGE_IMPORT_MODE="${K3D_IMAGE_IMPORT_MODE:-direct}"
IMAGE_IMPORT_FALLBACK_MODE="${K3D_IMAGE_IMPORT_FALLBACK_MODE:-tools}"
IMAGE_IMPORT_TIMEOUT_SECONDS="${K3D_IMAGE_IMPORT_TIMEOUT_SECONDS:-180}"
IMAGE_REF="${TENANT_IMAGE_REPOSITORY}:${TENANT_IMAGE_TAG}"

usage() {
  cat <<'EOF'
Build the tenant runtime image from the repo Dockerfile and import it into k3d.

Environment overrides:
  K3D_CLUSTER_NAME          Cluster name (default: dnd-notes)
  TENANT_IMAGE_REPOSITORY   Image repository (default: ghcr.io/daydream-software/dnd-notes)
  TENANT_IMAGE_TAG          Image tag (default: k3d)
  K3D_IMAGE_IMPORT_MODE     k3d image import mode (default: direct)
  K3D_IMAGE_IMPORT_FALLBACK_MODE  retry mode when the primary import stalls/fails (default: tools)
  K3D_IMAGE_IMPORT_TIMEOUT_SECONDS  per-import timeout in seconds when `timeout` is available (default: 180)
EOF
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

cluster_exists() {
  k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fx "$CLUSTER_NAME" >/dev/null
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for tool in docker k3d; do
  require_tool "$tool"
done

if ! cluster_exists; then
  echo "k3d cluster ${CLUSTER_NAME} does not exist. Run scripts/k3d/bootstrap.sh first." >&2
  exit 1
fi

echo "Building tenant image ${IMAGE_REF}..."
docker build -t "${IMAGE_REF}" "${ROOT}"

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

  k3d image import --mode "${mode}" -c "${CLUSTER_NAME}" "${IMAGE_REF}"
}

if ! run_image_import "${IMAGE_IMPORT_MODE}"; then
  if [[ "${IMAGE_IMPORT_FALLBACK_MODE}" == "${IMAGE_IMPORT_MODE}" ]]; then
    echo "Image import failed with mode ${IMAGE_IMPORT_MODE} and no alternate fallback mode is configured." >&2
    exit 1
  fi

  echo "Image import with mode ${IMAGE_IMPORT_MODE} failed or timed out; retrying with ${IMAGE_IMPORT_FALLBACK_MODE}." >&2
  run_image_import "${IMAGE_IMPORT_FALLBACK_MODE}"
fi

echo "Tenant image ready in k3d: ${IMAGE_REF}"
