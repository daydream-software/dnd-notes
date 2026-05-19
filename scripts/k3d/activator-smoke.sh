#!/usr/bin/env bash
# Smoke test for the scale-to-zero activator (issue #340).
#
# Prerequisites:
#   1. A running k3d cluster — run scripts/k3d/bootstrap.sh if needed.
#   2. The activator deployed in dnd-notes-platform:
#        kubectl apply -k deploy/k3s/base/activator
#      (ensure the Secret dnd-notes-activator-secrets with CONTROL_PLANE_DATABASE_URL is present)
#   3. A tenant provisioned with the slug matching TENANT_SUBDOMAIN (default: smoke-sto).
#      Run the full smoke first with the tenant kept alive:
#        KEEP_K3D_SMOKE_TENANT=true TENANT_SUBDOMAIN=smoke-sto \
#          bash scripts/k3d/smoke.sh
#      Then run this script.
#
# Three test scenarios:
#   1. Warm-path: tenant already running, activator forwards immediately
#   2. Cold-start (wake path): tenant sleeping, activator wakes and forwards
#   3. Resource-pressure detection: Deployment patched with unschedulable memory
#      request (64Gi); activator fires pod_schedule_deadline_exceeded after
#      POD_SCHEDULE_BUDGET_MS, then returns HTTP 503 cold_start_timeout after
#      COLD_START_TIMEOUT_MS. Patch is reverted before section 6.
#
# The script measures cold-start wall time and prints p50/p95 via the
# /metrics endpoint.
#
# Environment overrides:
#   K3D_CLUSTER_NAME        Cluster name (default: dnd-notes)
#   ACTIVATOR_PORT          Local port-forward port (default: 18080)
#   TENANT_SUBDOMAIN        Subdomain to use for smoke tenant (default: smoke-sto)
#   TENANT_BASE_DOMAIN      Base domain (default: 127.0.0.1.nip.io)
#   COLD_START_TIMEOUT_S    Max cold-start budget for this smoke (default: 90)
#   KEEP_TENANT             Set "true" to skip cleanup (default: false)
set -Eeuo pipefail

if (( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) )); then
  shopt -s inherit_errexit
fi

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/k3d/_load-dotenv.sh
source "${ROOT}/scripts/k3d/_load-dotenv.sh"

CLUSTER_NAME="${K3D_CLUSTER_NAME:-dnd-notes}"
ACTIVATOR_PORT="${ACTIVATOR_PORT:-18080}"
TENANT_SUBDOMAIN="${TENANT_SUBDOMAIN:-smoke-sto}"
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-127.0.0.1.nip.io}"
COLD_START_TIMEOUT_S="${COLD_START_TIMEOUT_S:-90}"
KEEP_TENANT="${KEEP_TENANT:-false}"
PLATFORM_NAMESPACE="dnd-notes-platform"
WORK_DIR="${ROOT}/.k3d-activator-smoke-work"

activator_forward_pid=""
failed_command=""
failed_line=""

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

wait_for_tcp() {
  local port="$1"
  local timeout="${2:-30}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if bash -c "</dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for TCP port ${port}" >&2
  return 1
}

record_failure() {
  failed_command="${BASH_COMMAND}"
  failed_line="${BASH_LINENO[0]:-}"
}

cleanup() {
  local exit_code=$?
  set +e

  for pid in "${activator_forward_pid}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1
      wait "${pid}" 2>/dev/null
    fi
  done

  if (( exit_code != 0 )); then
    echo >&2
    echo "Activator smoke failed with exit code ${exit_code}." >&2
    if [[ -n "${failed_command}" ]]; then
      if [[ -n "${failed_line}" ]]; then
        echo "Failed command (around line ${failed_line}): ${failed_command}" >&2
      else
        echo "Failed command: ${failed_command}" >&2
      fi
    fi
  fi

  if (( exit_code == 0 )); then
    rm -rf "${WORK_DIR}"
  fi

  exit "${exit_code}"
}

trap 'record_failure $?' ERR
trap cleanup EXIT

for tool in docker k3d kubectl curl node; do
  require_tool "$tool"
done

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

# ---------------------------------------------------------------------------
# 1. Start port-forward to the activator service
# ---------------------------------------------------------------------------
echo "Starting port-forward to activator on port ${ACTIVATOR_PORT}..."
kubectl -n "${PLATFORM_NAMESPACE}" port-forward \
  svc/dnd-notes-activator \
  "${ACTIVATOR_PORT}:8080" \
  >"${WORK_DIR}/activator-port-forward.log" 2>&1 &
activator_forward_pid=$!

wait_for_tcp "${ACTIVATOR_PORT}" 30
echo "Activator port-forward ready."

# ---------------------------------------------------------------------------
# 2. Verify activator health probes
# ---------------------------------------------------------------------------
echo "Checking /healthz..."
healthz_status="$(curl -fsS -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:${ACTIVATOR_PORT}/healthz")"
if [[ "${healthz_status}" != "200" ]]; then
  echo "Healthz returned ${healthz_status}, expected 200" >&2
  exit 1
fi
echo "/healthz OK (${healthz_status})"

echo "Checking /readyz..."
readyz_status="$(curl -fsS -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:${ACTIVATOR_PORT}/readyz")"
if [[ "${readyz_status}" != "200" ]]; then
  echo "Readyz returned ${readyz_status}, expected 200" >&2
  exit 1
fi
echo "/readyz OK (${readyz_status})"

# ---------------------------------------------------------------------------
# 3. Warm-path test: tenant already running, activator proxies immediately
# ---------------------------------------------------------------------------
TENANT_NAMESPACE="tenant-${TENANT_SUBDOMAIN}"
DEPLOYMENT_NAME="dnd-notes"

echo
echo "Warm-path test: ensuring tenant ${TENANT_SUBDOMAIN} is running (replicas=1)..."
kubectl -n "${TENANT_NAMESPACE}" scale deployment/"${DEPLOYMENT_NAME}" --replicas=1 >/dev/null
kubectl rollout status -n "${TENANT_NAMESPACE}" deployment/"${DEPLOYMENT_NAME}" --timeout=120s

echo "Sending warm-path request through activator..."
warm_t0="${SECONDS}"
warm_status="$(curl -fsS -o "${WORK_DIR}/warm-response.json" -w '%{http_code}' \
  -H "Host: ${TENANT_SUBDOMAIN}.${TENANT_BASE_DOMAIN}" \
  "http://127.0.0.1:${ACTIVATOR_PORT}/ready")"
warm_elapsed=$(( SECONDS - warm_t0 ))

if [[ "${warm_status}" != "200" ]]; then
  echo "Warm-path /ready returned ${warm_status}, expected 200" >&2
  exit 1
fi
echo "Warm-path OK: HTTP ${warm_status} in ${warm_elapsed}s"

# ---------------------------------------------------------------------------
# 4. Cold-start (wake) test
# ---------------------------------------------------------------------------
echo
echo "Cold-start test: scaling tenant ${TENANT_SUBDOMAIN} to 0 replicas..."
kubectl -n "${TENANT_NAMESPACE}" scale deployment/"${DEPLOYMENT_NAME}" --replicas=0 >/dev/null

# Wait for the pod to terminate fully so the endpoint flushes
echo "Waiting for pod to terminate..."
kubectl wait -n "${TENANT_NAMESPACE}" \
  --for=delete pod \
  --selector=app.kubernetes.io/name=dnd-notes \
  --timeout=60s 2>/dev/null || true

echo "Sending cold-start request through activator (budget: ${COLD_START_TIMEOUT_S}s)..."
cold_t0="${SECONDS}"
cold_http_code="$(curl -fsS \
  -o "${WORK_DIR}/cold-response.json" \
  -w '%{http_code}' \
  --max-time "${COLD_START_TIMEOUT_S}" \
  -H "Host: ${TENANT_SUBDOMAIN}.${TENANT_BASE_DOMAIN}" \
  "http://127.0.0.1:${ACTIVATOR_PORT}/ready" 2>/dev/null || echo "curl_failed")"
cold_elapsed=$(( SECONDS - cold_t0 ))

echo "Cold-start result: HTTP ${cold_http_code} in ${cold_elapsed}s"

if [[ "${cold_http_code}" != "200" ]]; then
  echo "Cold-start failed: expected HTTP 200, got ${cold_http_code}" >&2
  if [[ -s "${WORK_DIR}/cold-response.json" ]]; then
    echo "Response body:" >&2
    cat "${WORK_DIR}/cold-response.json" >&2
  fi
  exit 1
fi
echo "Cold-start OK: HTTP ${cold_http_code} in ${cold_elapsed}s"

# ---------------------------------------------------------------------------
# 5. Second wake request (should be near-instant — tenant already up)
# ---------------------------------------------------------------------------
echo
echo "Second request after cold-start (should be warm)..."
second_t0="${SECONDS}"
second_status="$(curl -fsS -o /dev/null -w '%{http_code}' \
  -H "Host: ${TENANT_SUBDOMAIN}.${TENANT_BASE_DOMAIN}" \
  "http://127.0.0.1:${ACTIVATOR_PORT}/ready")"
second_elapsed=$(( SECONDS - second_t0 ))
echo "Second request: HTTP ${second_status} in ${second_elapsed}s"

if [[ "${second_status}" != "200" ]]; then
  echo "Second request returned ${second_status}, expected 200" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 5b. Resource-pressure detection: pod_schedule_deadline_exceeded
#
# Steps:
#   1. Patch the tenant Deployment with an unschedulable memory request (64Gi)
#      so any pod the scheduler tries to place stays Pending indefinitely.
#   2. Scale the Deployment to 0 (ensure the pod is gone before the wake).
#   3. Send a wake request — the activator patches replicas: 1 and starts
#      waiting. After POD_SCHEDULE_BUDGET_MS (default 30s) the activator
#      inspects the pending pod and fires pod_schedule_deadline_exceeded.
#      After COLD_START_TIMEOUT_MS (default 60s) it returns HTTP 503.
#   4. Assert: the response is HTTP 503 with error=cold_start_timeout.
#   5. Assert: /metrics shows pod_schedule_deadline_exceeded_total >= 1.
#   6. Revert: remove the resource request patch and scale back to 0 so the
#      cluster is clean for subsequent runs.
# ---------------------------------------------------------------------------
echo
echo "Resource-pressure test: patching tenant with unschedulable memory request..."

# Patch: add an unschedulable memory request to the first container
kubectl -n "${TENANT_NAMESPACE}" patch deployment/"${DEPLOYMENT_NAME}" \
  --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/resources","value":{"requests":{"memory":"64Gi"}}}]'

# Scale to 0 so there is no running pod before the wake attempt
kubectl -n "${TENANT_NAMESPACE}" scale deployment/"${DEPLOYMENT_NAME}" --replicas=0 >/dev/null

echo "Waiting for pod to terminate after patch..."
kubectl wait -n "${TENANT_NAMESPACE}" \
  --for=delete pod \
  --selector=app.kubernetes.io/name=dnd-notes \
  --timeout=60s 2>/dev/null || true

# The activator's cold-start budget is COLD_START_TIMEOUT_MS (60s default) and
# we must also allow a few seconds for the curl to collect the 503 body.
pressure_curl_timeout=$(( COLD_START_TIMEOUT_S + 15 ))

echo "Sending wake request (expect 503 after ~${COLD_START_TIMEOUT_S}s cold-start timeout)..."
pressure_http_code="$(curl -sS \
  -o "${WORK_DIR}/pressure-response.json" \
  -w '%{http_code}' \
  --max-time "${pressure_curl_timeout}" \
  -H "Host: ${TENANT_SUBDOMAIN}.${TENANT_BASE_DOMAIN}" \
  "http://127.0.0.1:${ACTIVATOR_PORT}/ready" 2>/dev/null || echo "curl_failed")"

echo "Resource-pressure result: HTTP ${pressure_http_code}"

if [[ "${pressure_http_code}" != "503" ]]; then
  echo "Resource-pressure test: expected HTTP 503, got ${pressure_http_code}" >&2
  if [[ -s "${WORK_DIR}/pressure-response.json" ]]; then
    echo "Response body:" >&2
    cat "${WORK_DIR}/pressure-response.json" >&2
  fi
  # Revert before exiting
  kubectl -n "${TENANT_NAMESPACE}" patch deployment/"${DEPLOYMENT_NAME}" \
    --type=json \
    -p '[{"op":"remove","path":"/spec/template/spec/containers/0/resources"}]' 2>/dev/null || true
  kubectl -n "${TENANT_NAMESPACE}" scale deployment/"${DEPLOYMENT_NAME}" --replicas=0 2>/dev/null || true
  exit 1
fi

# Verify the response body contains error=cold_start_timeout
pressure_error="$(node -e "
  const b = require('fs').readFileSync('${WORK_DIR}/pressure-response.json', 'utf8');
  const j = JSON.parse(b);
  process.stdout.write(j.error ?? '');
" 2>/dev/null || true)"

if [[ "${pressure_error}" != "cold_start_timeout" ]]; then
  echo "Resource-pressure test: expected error=cold_start_timeout in body, got: ${pressure_error}" >&2
  # Revert before exiting
  kubectl -n "${TENANT_NAMESPACE}" patch deployment/"${DEPLOYMENT_NAME}" \
    --type=json \
    -p '[{"op":"remove","path":"/spec/template/spec/containers/0/resources"}]' 2>/dev/null || true
  kubectl -n "${TENANT_NAMESPACE}" scale deployment/"${DEPLOYMENT_NAME}" --replicas=0 2>/dev/null || true
  exit 1
fi
echo "Resource-pressure 503 body: error=${pressure_error} (correct)"

# Assert pod_schedule_deadline_exceeded_total >= 1 in /metrics
echo "Checking pod_schedule_deadline_exceeded_total metric..."
curl -fsS "http://127.0.0.1:${ACTIVATOR_PORT}/metrics" \
  >"${WORK_DIR}/pressure-metrics.txt"

# Extract the counter value: line format is
# pod_schedule_deadline_exceeded_total{tenant="..."} <value>
deadline_count="$(grep -E '^pod_schedule_deadline_exceeded_total' \
  "${WORK_DIR}/pressure-metrics.txt" \
  | grep -o '[0-9][0-9]*$' \
  | awk '{s+=$1} END {print (s == "" ? 0 : s)}')"

echo "pod_schedule_deadline_exceeded_total: ${deadline_count}"
if (( deadline_count < 1 )); then
  echo "Resource-pressure test: expected pod_schedule_deadline_exceeded_total >= 1, got ${deadline_count}" >&2
  # Revert before exiting
  kubectl -n "${TENANT_NAMESPACE}" patch deployment/"${DEPLOYMENT_NAME}" \
    --type=json \
    -p '[{"op":"remove","path":"/spec/template/spec/containers/0/resources"}]' 2>/dev/null || true
  kubectl -n "${TENANT_NAMESPACE}" scale deployment/"${DEPLOYMENT_NAME}" --replicas=0 2>/dev/null || true
  exit 1
fi

# Confirm the pod is actually Pending (sanity check)
pending_count="$(kubectl get pods -n "${TENANT_NAMESPACE}" --no-headers 2>/dev/null \
  | grep -c 'Pending' || true)"
echo "Pending pods in ${TENANT_NAMESPACE}: ${pending_count}"

echo "Resource-pressure test passed."

# Revert: remove the unschedulable resource request and scale to 0
echo "Reverting unschedulable patch..."
kubectl -n "${TENANT_NAMESPACE}" patch deployment/"${DEPLOYMENT_NAME}" \
  --type=json \
  -p '[{"op":"remove","path":"/spec/template/spec/containers/0/resources"}]'
kubectl -n "${TENANT_NAMESPACE}" scale deployment/"${DEPLOYMENT_NAME}" --replicas=0 >/dev/null
echo "Revert complete. Tenant ${TENANT_SUBDOMAIN} is back at 0 replicas with normal resource spec."

# ---------------------------------------------------------------------------
# 6. Metrics scrape
# ---------------------------------------------------------------------------
echo
echo "Scraping /metrics..."
curl -fsS "http://127.0.0.1:${ACTIVATOR_PORT}/metrics" \
  >"${WORK_DIR}/metrics.txt"

echo "Metrics output:"
grep -E "^(activator_wake_total|activator_cold_start_duration_seconds|activator_held_connections|activator_error_total|pod_schedule_deadline_exceeded)" \
  "${WORK_DIR}/metrics.txt" || true

# Print cold-start histogram bucket summary
echo
echo "Cold-start histogram:"
grep "activator_cold_start_duration_seconds" "${WORK_DIR}/metrics.txt" || true

# ---------------------------------------------------------------------------
# 7. Unroutable host returns 400
# ---------------------------------------------------------------------------
echo
echo "Testing unroutable host returns 400..."
unroutable_status="$(curl -fsS -o /dev/null -w '%{http_code}' \
  -H "Host: not-a-tenant.example.com" \
  "http://127.0.0.1:${ACTIVATOR_PORT}/any" 2>/dev/null || true)"
if [[ "${unroutable_status}" != "400" ]]; then
  echo "Unroutable host test: expected 400, got ${unroutable_status}" >&2
  exit 1
fi
echo "Unroutable host: HTTP ${unroutable_status} (correct)"

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
echo
echo "Activator smoke passed."
echo "  Warm-path latency:       ${warm_elapsed}s"
echo "  Cold-start wall time:    ${cold_elapsed}s"
echo "  Second-request latency:  ${second_elapsed}s"
echo
echo "Metrics saved to: ${WORK_DIR}/metrics.txt"
