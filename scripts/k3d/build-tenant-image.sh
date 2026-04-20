#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
TENANT_IMAGE_REPOSITORY="${TENANT_IMAGE_REPOSITORY:-ghcr.io/daydream-software/dnd-notes}"
TENANT_IMAGE_TAG="${TENANT_IMAGE_TAG:-k3d}"
IMAGE_REF="${TENANT_IMAGE_REPOSITORY}:${TENANT_IMAGE_TAG}"

usage() {
  cat <<'EOF'
Build the tenant runtime image from the repo Dockerfile and import it into k3d.

Environment overrides:
  K3D_CLUSTER_NAME          Cluster name (default: dnd-notes)
  TENANT_IMAGE_REPOSITORY   Image repository (default: ghcr.io/daydream-software/dnd-notes)
  TENANT_IMAGE_TAG          Image tag (default: k3d)
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

echo "Importing ${IMAGE_REF} into k3d cluster ${CLUSTER_NAME}..."
k3d image import -c "${CLUSTER_NAME}" "${IMAGE_REF}"

echo "Tenant image ready in k3d: ${IMAGE_REF}"
