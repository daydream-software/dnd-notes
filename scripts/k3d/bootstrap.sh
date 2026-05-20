#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/k3d/_load-dotenv.sh
source "${ROOT}/scripts/k3d/_load-dotenv.sh"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
K3S_IMAGE="${K3D_K3S_IMAGE:-rancher/k3s:v1.35.3-k3s1}"
HTTP_PORT="${K3D_HTTP_PORT:-80}"
HTTPS_PORT="${K3D_HTTPS_PORT:-443}"
K3S_PULL_RETRIES="${K3D_K3S_PULL_RETRIES:-3}"
K3S_PULL_TIMEOUT_SECONDS="${K3D_K3S_PULL_TIMEOUT_SECONDS:-180}"
K3S_PULL_RETRY_DELAY_SECONDS="${K3D_K3S_PULL_RETRY_DELAY_SECONDS:-5}"
PLATFORM_NAMESPACE="dnd-notes-platform"
K3D_OVERLAY_PATH="${ROOT}/deploy/k3s/overlays/k3d"
INGRESS_NGINX_MANIFEST_PATH="${INGRESS_NGINX_MANIFEST_PATH:-${ROOT}/scripts/k3d/manifests/ingress-nginx-controller-v1.12.1.yaml}"
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
  K3D_HTTP_PORT             Host port mapped to ingress HTTP. Must be 80;
                            non-standard values are rejected (portless origins
                            are required for Keycloak + ALLOWED_ORIGINS).
  K3D_HTTPS_PORT            Host port mapped to ingress HTTPS. Must be 443
                            for the same reason.
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

check_port_free() {
  local port="$1"
  local label="$2"
  if bash -c "</dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
    echo "ERROR: ${label} port ${port} is already in use on 127.0.0.1." >&2
    echo "  Standard ingress ports are required (the PR enforces 80/443 for" >&2
    echo "  portless origins). Free port ${port} on the host (stop the" >&2
    echo "  conflicting service) and re-run bootstrap." >&2
    exit 1
  fi
}

# Reject non-standard ingress ports. Portless origins are load-bearing for
# Keycloak redirectUris/webOrigins and the API's ALLOWED_ORIGINS exact-match.
# Anything other than 80/443 silently re-introduces the CORS/redirect bug this
# stack was built to avoid.
validate_ingress_ports() {
  if [[ "${HTTP_PORT}" != "80" || "${HTTPS_PORT}" != "443" ]]; then
    echo "ERROR: K3D_HTTP_PORT must be 80 and K3D_HTTPS_PORT must be 443." >&2
    echo "  Current values: HTTP=${HTTP_PORT}, HTTPS=${HTTPS_PORT}" >&2
    echo "  Portless origins are required for Keycloak redirect URIs and the" >&2
    echo "  API ALLOWED_ORIGINS exact-match. Free up host ports 80/443 first." >&2
    exit 1
  fi

  local serverlb="k3d-${CLUSTER_NAME}-serverlb"
  if ! docker inspect "${serverlb}" >/dev/null 2>&1; then
    return 0
  fi

  local actual_http actual_https
  actual_http="$(docker inspect "${serverlb}" \
    --format '{{ with (index .NetworkSettings.Ports "80/tcp") }}{{ (index . 0).HostPort }}{{ end }}' 2>/dev/null || true)"
  actual_https="$(docker inspect "${serverlb}" \
    --format '{{ with (index .NetworkSettings.Ports "443/tcp") }}{{ (index . 0).HostPort }}{{ end }}' 2>/dev/null || true)"

  if [[ "${actual_http}" != "80" || "${actual_https}" != "443" ]]; then
    echo "ERROR: existing k3d cluster '${CLUSTER_NAME}' maps non-standard ingress ports:" >&2
    echo "  HTTP:  host ${actual_http:-?} → container 80" >&2
    echo "  HTTPS: host ${actual_https:-?} → container 443" >&2
    echo "  Portless origins are required. Run 'npm run k3d:down' to delete this" >&2
    echo "  cluster, then re-run bootstrap to recreate it on standard ports." >&2
    exit 1
  fi
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
      return 0
    fi
    sleep 3
  done

  echo "ERROR: cert-manager-webhook endpoint did not become ready within 60s." >&2
  echo "  ClusterIssuer apply will fail; aborting before downstream errors." >&2
  kubectl -n cert-manager get endpoints cert-manager-webhook -o yaml >&2 || true
  exit 1
}

create_mkcert_ca_secret() {
  echo "Creating mkcert-ca secret from CAROOT=${CAROOT}..."
  # The dev-ca ClusterIssuer (applied via the k3d overlay) references this
  # secret. It must exist before the overlay apply so the issuer can become
  # Ready and downstream Certificates can be signed.
  kubectl -n cert-manager create secret tls mkcert-ca \
    --cert="${CAROOT}/rootCA.pem" \
    --key="${CAROOT}/rootCA-key.pem" \
    --dry-run=client -o yaml \
    | kubectl apply -f -
}

# The dev-ca ClusterIssuer ships in deploy/k3s/overlays/k3d (applied below), not
# as a standalone manifest. After the overlay apply, wait for it to become Ready
# so downstream per-ingress Certificates are not left pending.
wait_for_dev_ca_issuer() {
  echo "Waiting for ClusterIssuer dev-ca to become Ready..."
  local attempt
  for attempt in 1 2 3 4 5; do
    if kubectl wait --for=condition=Ready --timeout=60s clusterissuer/dev-ca; then
      return 0
    fi
    echo "ClusterIssuer dev-ca not Ready (attempt ${attempt}/5) — retrying in 10s..." >&2
    kubectl describe clusterissuer dev-ca >&2 || true
    sleep 10
  done
  echo "ERROR: ClusterIssuer dev-ca did not become Ready after 5 attempts." >&2
  return 1
}

# Canonical platform secrets, created imperatively (secret provisioning
# unification is a separate later PR). The unified base/overlay manifests
# reference these names; without them postgres + keycloak would sit in
# CreateContainerConfigError.
create_platform_secrets() {
  echo "Creating canonical platform secrets (postgres + keycloak bootstrap)..."
  kubectl -n "${PLATFORM_NAMESPACE}" create secret generic platform-postgres-credentials \
    --from-literal=POSTGRES_USER=postgres \
    --from-literal=POSTGRES_PASSWORD=postgres \
    --from-literal=POSTGRES_DB=postgres \
    --dry-run=client -o yaml \
    | kubectl apply -f -

  kubectl -n "${PLATFORM_NAMESPACE}" create secret generic keycloak-bootstrap-env \
    --from-literal=KC_BOOTSTRAP_ADMIN_USERNAME=admin \
    --from-literal=KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
    --dry-run=client -o yaml \
    | kubectl apply -f -
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for tool in docker k3d kubectl; do
  require_tool "$tool"
done

validate_ingress_ports
validate_caroot

previous_kube_context="$(kubectl config current-context 2>/dev/null || true)"
trap restore_previous_context EXIT

if ! cluster_exists; then
  check_port_free "${HTTP_PORT}" "HTTP"
  check_port_free "${HTTPS_PORT}" "HTTPS"
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

# Namespace is also defined in the k3d overlay (applied below) and re-applied
# idempotently there, but it must exist first so the canonical secrets land in
# the right namespace before the overlay brings up postgres + keycloak.
kubectl create namespace "${PLATFORM_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f "${INGRESS_NGINX_MANIFEST_PATH}"
wait_for_rollout ingress-nginx ingress-nginx-controller 240s

install_cert_manager
create_mkcert_ca_secret
create_platform_secrets

# ---------------------------------------------------------------------------
# Apply the unified k3d overlay. This is the single umbrella that stands up the
# whole platform (namespace, dev-ca issuer, postgres, keycloak, control-plane,
# activator, portals) — mirroring how prod uses deploy/k3s/overlays/prod.
#
# The four application Deployments (control-plane, activator, portals) will
# crashloop until up.sh creates dnd-notes-control-plane-secrets /
# dnd-notes-activator-secrets and rolls them. That is expected: bootstrap brings
# up infra (postgres + keycloak healthy); up.sh brings up the apps.
# ---------------------------------------------------------------------------
echo "Applying unified k3d overlay (deploy/k3s/overlays/k3d)..."
kubectl apply -k "${K3D_OVERLAY_PATH}"

wait_for_dev_ca_issuer

wait_for_rollout "${PLATFORM_NAMESPACE}" platform-postgres 180s

# Create the control_plane database for the control-plane registry
if [[ "$(
  kubectl exec -n "${PLATFORM_NAMESPACE}" statefulset/platform-postgres -- \
    psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'control_plane'"
)" != "1" ]]; then
  kubectl exec -n "${PLATFORM_NAMESPACE}" statefulset/platform-postgres -- \
    psql -U postgres -c "CREATE DATABASE control_plane"
fi

# Create the keycloak database. The unified keycloak Deployment uses Postgres
# (KC_DB) instead of the default ephemeral H2 file storage, so per-tenant clients
# created dynamically by the control-plane survive Keycloak pod restarts.
if [[ "$(
  kubectl exec -n "${PLATFORM_NAMESPACE}" statefulset/platform-postgres -- \
    psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'keycloak'"
)" != "1" ]]; then
  kubectl exec -n "${PLATFORM_NAMESPACE}" statefulset/platform-postgres -- \
    psql -U postgres -c "CREATE DATABASE keycloak"
fi

# Keycloak first-boots before the keycloak DB exists and crashloops on the JDBC
# connection. Restart it now that the DB is present so --import-realm runs
# against a reachable database. --import-realm only imports on the first
# successful startup when a realm does not yet exist.
echo "Restarting Keycloak now that its database exists..."
kubectl rollout restart -n "${PLATFORM_NAMESPACE}" deployment/platform-keycloak >/dev/null
wait_for_rollout "${PLATFORM_NAMESPACE}" platform-keycloak 240s

# ---------------------------------------------------------------------------
# Seed dnd-notes-keycloak-admin using the bootstrap-admin credentials.
#
# This Job runs once per cluster using the KC_BOOTSTRAP_ADMIN_USERNAME /
# KC_BOOTSTRAP_ADMIN_PASSWORD bootstrap credentials from the keycloak-bootstrap-env
# Secret to create the dnd-notes-keycloak-admin service-account client in the
# dnd-notes tenant realm and bind its realm-management roles.
#
# On a fresh cluster --import-realm already created the client, so the Job is
# a no-op. On an existing cluster where the realm was imported before this
# client was added, the Job creates it.
#
# The Job is deleted and re-created on every bootstrap run so it can re-verify
# idempotency after a keycloak restart / realm change.
# ---------------------------------------------------------------------------
echo "Running keycloak-admin-bootstrap Job..."
kubectl delete job -n "${PLATFORM_NAMESPACE}" keycloak-admin-bootstrap --ignore-not-found >/dev/null
kubectl apply -f "${ROOT}/scripts/k3d/manifests/keycloak-admin-bootstrap-job.yaml" >/dev/null
if ! kubectl wait --for=condition=complete --timeout=300s \
  -n "${PLATFORM_NAMESPACE}" job/keycloak-admin-bootstrap; then
  kubectl logs -n "${PLATFORM_NAMESPACE}" job/keycloak-admin-bootstrap || true
  exit 1
fi

echo
echo "k3d platform bootstrap complete."
echo "- Cluster context: k3d-${CLUSTER_NAME}"
echo "- k3s image: ${K3S_IMAGE}"
echo "- Platform namespace: ${PLATFORM_NAMESPACE}"
echo "- Keycloak ingress: https://keycloak.127.0.0.1.nip.io"
echo "- Postgres service: platform-postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432"
