#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
K3S_IMAGE="${K3D_K3S_IMAGE:-rancher/k3s:v1.35.3-k3s1}"
HTTP_PORT="${K3D_HTTP_PORT:-80}"
HTTPS_PORT="${K3D_HTTPS_PORT:-443}"
K3S_PULL_RETRIES="${K3D_K3S_PULL_RETRIES:-3}"
K3S_PULL_TIMEOUT_SECONDS="${K3D_K3S_PULL_TIMEOUT_SECONDS:-180}"
K3S_PULL_RETRY_DELAY_SECONDS="${K3D_K3S_PULL_RETRY_DELAY_SECONDS:-5}"
PLATFORM_NAMESPACE="dnd-notes-platform"
INGRESS_NGINX_MANIFEST_PATH="${INGRESS_NGINX_MANIFEST_PATH:-${ROOT}/platform/k3d/ingress-nginx-controller-v1.12.1.yaml}"
previous_kube_context=""

usage() {
  cat <<'EOF'
Bootstrap the local k3d platform environment for dnd-notes.

Environment overrides:
  K3D_CLUSTER_NAME          Cluster name (default: dnd-notes)
  K3D_K3S_IMAGE             k3s image used for the cluster (default: rancher/k3s:v1.35.3-k3s1)
  K3D_K3S_PULL_RETRIES      retries for pre-pulling the k3s image before cluster creation (default: 3)
  K3D_K3S_PULL_TIMEOUT_SECONDS
                            timeout for each k3s image pull attempt in seconds (default: 180)
  K3D_K3S_PULL_RETRY_DELAY_SECONDS
                            delay between failed k3s image pull attempts in seconds (default: 5)
  K3D_HTTP_PORT             Host port mapped to ingress HTTP (default: 80)
  K3D_HTTPS_PORT            Host port mapped to ingress HTTPS (default: 443)
  INGRESS_NGINX_MANIFEST_PATH
                              Local ingress-nginx manifest path
  CAROOT                    Path to the mkcert CA root directory containing rootCA.pem and
                            rootCA-key.pem. Required for TLS certificate issuance.
                            On WSL with mkcert installed on the Windows host, set this to the
                            Windows AppData path via the WSL mount, for example:
                              export CAROOT="/mnt/c/Users/<YourUser>/AppData/Local/mkcert"
                            Then run 'mkcert -install' on the Windows host if you have not
                            already done so to add the CA to your browser trust store.
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

pull_k3s_image() {
  if (( K3S_PULL_RETRIES == 0 )); then
    echo "Skipping k3s image pre-pull because K3D_K3S_PULL_RETRIES=0."
    return 0
  fi

  if docker image inspect "${K3S_IMAGE}" >/dev/null 2>&1; then
    echo "Using cached k3s image ${K3S_IMAGE}."
    return 0
  fi

  local attempt
  for (( attempt = 1; attempt <= K3S_PULL_RETRIES; attempt += 1 )); do
    echo "Pulling k3s image ${K3S_IMAGE} (attempt ${attempt}/${K3S_PULL_RETRIES})..."
    if command -v timeout >/dev/null 2>&1; then
      if timeout "${K3S_PULL_TIMEOUT_SECONDS}" docker pull "${K3S_IMAGE}"; then
        return 0
      fi
    elif docker pull "${K3S_IMAGE}"; then
      return 0
    fi

    if (( attempt < K3S_PULL_RETRIES )); then
      echo "Retrying k3s image pull in ${K3S_PULL_RETRY_DELAY_SECONDS}s..." >&2
      sleep "${K3S_PULL_RETRY_DELAY_SECONDS}"
    fi
  done

  echo "Failed to pull k3s image ${K3S_IMAGE} after ${K3S_PULL_RETRIES} attempts." >&2
  return 1
}

restore_previous_context() {
  local exit_code=$?
  set +e

  if [[ -n "${previous_kube_context}" ]]; then
    kubectl config use-context "${previous_kube_context}" >/dev/null 2>&1
  fi

  exit "${exit_code}"
}

apply_keycloak_manifest() {
  kubectl apply -f "${ROOT}/platform/k3d/keycloak.yaml"
  # Restart to pick up any realm configmap changes (import only runs on startup).
  kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/platform-keycloak >/dev/null 2>&1 || true
}

validate_caroot() {
  if [[ -z "${CAROOT:-}" ]]; then
    echo "ERROR: CAROOT environment variable is not set." >&2
    echo "  CAROOT must point to the directory containing mkcert's rootCA.pem and rootCA-key.pem." >&2
    echo "  On WSL with mkcert installed on the Windows host, run:" >&2
    echo "    export CAROOT=\"/mnt/c/Users/<YourUser>/AppData/Local/mkcert\"" >&2
    echo "  Then ensure 'mkcert -install' has been run on the Windows host." >&2
    echo "  Run 'bootstrap.sh --help' for details." >&2
    exit 1
  fi
  if [[ ! -r "${CAROOT}/rootCA.pem" ]]; then
    echo "ERROR: ${CAROOT}/rootCA.pem not found or not readable." >&2
    echo "  Run 'mkcert -install' on the host where your browsers trust certificates." >&2
    exit 1
  fi
  if [[ ! -r "${CAROOT}/rootCA-key.pem" ]]; then
    echo "ERROR: ${CAROOT}/rootCA-key.pem not found or not readable." >&2
    echo "  Run 'mkcert -install' on the host where your browsers trust certificates." >&2
    exit 1
  fi
}

install_cert_manager() {
  local cert_manager_version="v1.16.3"
  local cert_manager_url="https://github.com/cert-manager/cert-manager/releases/download/${cert_manager_version}/cert-manager.yaml"

  echo "Installing cert-manager ${cert_manager_version}..."
  kubectl apply -f "${cert_manager_url}"

  echo "Waiting for cert-manager deployments to become available..."
  kubectl -n cert-manager wait \
    --for=condition=Available \
    --timeout=120s \
    deploy/cert-manager \
    deploy/cert-manager-cainjector \
    deploy/cert-manager-webhook

  # Wait for the webhook endpoint to be ready — the validating webhook rejects
  # ClusterIssuer resources until this is up.
  echo "Waiting for cert-manager-webhook endpoint..."
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if kubectl -n cert-manager get endpoints cert-manager-webhook \
        -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | grep -qE '[0-9]'; then
      echo "cert-manager-webhook endpoint is ready."
      break
    fi
    sleep 3
  done
}

apply_cert_manager_ca() {
  echo "Creating mkcert-ca secret from CAROOT=${CAROOT}..."
  kubectl -n cert-manager create secret tls mkcert-ca \
    --cert="${CAROOT}/rootCA.pem" \
    --key="${CAROOT}/rootCA-key.pem" \
    --dry-run=client -o yaml \
    | kubectl apply -f -

  echo "Applying ClusterIssuer dev-ca..."
  # Retry a few times in case the cert-manager webhook is still initialising.
  local attempt
  for attempt in 1 2 3 4 5; do
    if kubectl apply -f "${ROOT}/platform/k3d/cluster-issuer.yaml"; then
      return 0
    fi
    echo "ClusterIssuer apply attempt ${attempt} failed — retrying in 10s..."
    sleep 10
  done
  echo "ERROR: Failed to apply ClusterIssuer after 5 attempts." >&2
  return 1
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for tool in docker k3d kubectl; do
  require_tool "$tool"
done

validate_caroot

previous_kube_context="$(kubectl config current-context 2>/dev/null || true)"
trap restore_previous_context EXIT

if ! cluster_exists; then
  pull_k3s_image
  echo "Creating k3d cluster ${CLUSTER_NAME}..."
  k3d cluster create "$CLUSTER_NAME" \
    --servers 1 \
    --agents 1 \
    --wait \
    --image "${K3S_IMAGE}" \
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
kubectl apply -f "${INGRESS_NGINX_MANIFEST_PATH}"
wait_for_rollout ingress-nginx ingress-nginx-controller 240s

install_cert_manager
apply_cert_manager_ca

kubectl apply -f "${ROOT}/platform/k3d/postgres.yaml"
apply_keycloak_manifest

wait_for_rollout "${PLATFORM_NAMESPACE}" platform-postgres 180s

# Create the control_plane database for the control-plane registry
if [[ "$(
  kubectl exec -n "${PLATFORM_NAMESPACE}" deployment/platform-postgres -- \
    psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'control_plane'"
)" != "1" ]]; then
  kubectl exec -n "${PLATFORM_NAMESPACE}" deployment/platform-postgres -- \
    psql -U postgres -c "CREATE DATABASE control_plane"
fi

wait_for_rollout "${PLATFORM_NAMESPACE}" platform-keycloak 240s

echo
echo "k3d platform bootstrap complete."
echo "- Cluster context: k3d-${CLUSTER_NAME}"
echo "- k3s image: ${K3S_IMAGE}"
echo "- Platform namespace: ${PLATFORM_NAMESPACE}"
echo "- Keycloak ingress: https://keycloak.127.0.0.1.nip.io"
echo "- Postgres service: platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432"
