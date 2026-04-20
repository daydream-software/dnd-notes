#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
HTTP_PORT="${K3D_HTTP_PORT:-8080}"
HTTPS_PORT="${K3D_HTTPS_PORT:-8443}"
PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-dnd-notes-platform}"
INGRESS_NGINX_MANIFEST_URL="${INGRESS_NGINX_MANIFEST_URL:-https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/cloud/deploy.yaml}"

usage() {
  cat <<'EOF'
Bootstrap the local k3d platform environment for dnd-notes.

Environment overrides:
  K3D_CLUSTER_NAME          Cluster name (default: dnd-notes)
  K3D_HTTP_PORT             Host port mapped to ingress HTTP (default: 8080)
  K3D_HTTPS_PORT            Host port mapped to ingress HTTPS (default: 8443)
  PLATFORM_NAMESPACE        Namespace for platform services (default: dnd-notes-platform)
  INGRESS_NGINX_MANIFEST_URL
                            Pinned ingress-nginx manifest URL
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

wait_for_rollout() {
  local namespace="$1"
  local deployment="$2"
  local timeout="${3:-180s}"

  kubectl rollout status -n "$namespace" "deployment/${deployment}" --timeout="$timeout"
}

normalize_kubeconfig_server() {
  local context="k3d-${CLUSTER_NAME}"
  local server

  server="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
  if [[ "$server" =~ ^https://0\.0\.0\.0:([0-9]+)$ ]]; then
    kubectl config set-cluster "$context" --server="https://127.0.0.1:${BASH_REMATCH[1]}" >/dev/null
  fi
}

wait_for_kube_api() {
  local timeout="${1:-60}"
  local deadline=$((SECONDS + timeout))

  while (( SECONDS < deadline )); do
    if kubectl --request-timeout=5s get --raw=/readyz >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for the Kubernetes API to become reachable" >&2
  return 1
}

apply_keycloak_manifest() {
  local keycloak_external_url="http://keycloak.127.0.0.1.nip.io:${HTTP_PORT}"

  kubectl apply -f "${ROOT}/platform/k3d/keycloak.yaml"
  kubectl set env \
    -n "${PLATFORM_NAMESPACE}" \
    deployment/platform-keycloak \
    KC_HOSTNAME="${keycloak_external_url}" \
    >/dev/null
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for tool in docker k3d kubectl; do
  require_tool "$tool"
done

if ! cluster_exists; then
  echo "Creating k3d cluster ${CLUSTER_NAME}..."
  k3d cluster create "$CLUSTER_NAME" \
    --servers 1 \
    --agents 1 \
    --wait \
    --k3s-arg "--disable=traefik@server:0" \
    --port "${HTTP_PORT}:80@loadbalancer" \
    --port "${HTTPS_PORT}:443@loadbalancer"
else
  echo "Using existing k3d cluster ${CLUSTER_NAME}."
fi

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null
normalize_kubeconfig_server
wait_for_kube_api 60

kubectl apply -f "${ROOT}/platform/k3d/namespace.yaml"
kubectl apply -f "${INGRESS_NGINX_MANIFEST_URL}"
wait_for_rollout ingress-nginx ingress-nginx-controller 240s

kubectl apply -f "${ROOT}/platform/k3d/postgres.yaml"
apply_keycloak_manifest

wait_for_rollout "${PLATFORM_NAMESPACE}" platform-postgres 180s
wait_for_rollout "${PLATFORM_NAMESPACE}" platform-keycloak 240s

echo
echo "k3d platform bootstrap complete."
echo "- Cluster context: k3d-${CLUSTER_NAME}"
echo "- Platform namespace: ${PLATFORM_NAMESPACE}"
echo "- Keycloak ingress: http://keycloak.127.0.0.1.nip.io:${HTTP_PORT}"
echo "- Postgres service: platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432"
