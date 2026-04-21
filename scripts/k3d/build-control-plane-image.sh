#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
CONTROL_PLANE_IMAGE_REPOSITORY="${CONTROL_PLANE_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes-control-plane}"
CONTROL_PLANE_IMAGE_TAG="${CONTROL_PLANE_IMAGE_TAG:-k3d}"
IMAGE_IMPORT_MODE="${K3D_IMAGE_IMPORT_MODE:-direct}"
IMAGE_REF="${CONTROL_PLANE_IMAGE_REPOSITORY}:${CONTROL_PLANE_IMAGE_TAG}"

usage() {
  cat <<'EOF'
Build the control-plane image and import it into k3d.

Environment overrides:
  K3D_CLUSTER_NAME                Cluster name (default: dnd-notes)
  CONTROL_PLANE_IMAGE_REPOSITORY  Image repository (default: ghcr.io/daydream-software/dnd-notes-control-plane)
  CONTROL_PLANE_IMAGE_TAG         Image tag (default: k3d)
  K3D_IMAGE_IMPORT_MODE           k3d image import mode (default: direct)
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

echo "Building control-plane image ${IMAGE_REF}..."
docker build -f "${ROOT}/docker/control-plane/Dockerfile" -t "${IMAGE_REF}" "${ROOT}"

echo "Importing ${IMAGE_REF} into k3d cluster ${CLUSTER_NAME} with mode ${IMAGE_IMPORT_MODE}..."
k3d image import --mode "${IMAGE_IMPORT_MODE}" -c "${CLUSTER_NAME}" "${IMAGE_REF}"

echo "Control-plane image ready in k3d: ${IMAGE_REF}"
