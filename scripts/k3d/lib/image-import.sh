# shellcheck shell=bash
# Shared k3d image import + in-cluster verification helpers (epic #362).
#
# Sourced by BOTH scripts/k3d/build-image.sh and scripts/k3d/up.sh so the
# digest-verification logic lives in exactly one place.
#
# Source contract — the sourcing script must provide, in scope:
#   CLUSTER_NAME                      cluster to import into
#   IMAGE_IMPORT_MODE                 primary `k3d image import` mode
#   IMAGE_IMPORT_FALLBACK_MODE        retry mode when the primary stalls/fails
#   IMAGE_IMPORT_TIMEOUT_SECONDS      per-import timeout in seconds
#   log()                             writes a line to stderr
#
# Every function takes the fully-qualified image ref (repo:tag) as its first
# argument; none of them read a global image ref.

# Run a single `k3d image import` with the given mode, under a timeout when the
# `timeout` binary is available. Returns the import exit status.
run_k3d_image_import() {
  local image_ref="$1"
  local mode="$2"
  local status=0

  log "Importing ${image_ref} into k3d cluster ${CLUSTER_NAME} with mode ${mode}..."
  if command -v timeout >/dev/null 2>&1; then
    if timeout "${IMAGE_IMPORT_TIMEOUT_SECONDS}" \
      k3d image import --mode "${mode}" -c "${CLUSTER_NAME}" "${image_ref}"; then
      return 0
    fi
    status=$?
    return "${status}"
  fi

  if k3d image import --mode "${mode}" -c "${CLUSTER_NAME}" "${image_ref}"; then
    return 0
  fi
  status=$?
  return "${status}"
}

# Verify the FRESHLY BUILT image actually landed in the cluster's containerd.
#
# `k3d image import --mode direct` can exit 0 WITHOUT the image landing on a node
# (more likely for large images) — a silent false success that surfaces later as
# ImagePullBackOff on an IfNotPresent pod. Matching by repo:tag alone is NOT
# enough: the tag is the mutable `:k3d`, so a STALE same-tag image already on a
# node would make a repo:tag check pass even when the new import never landed.
#
# So we compare by image ID (sha256 content digest):
#   - the host image ID comes from `docker image inspect --format '{{.Id}}'`
#   - each node's ID for that repo:tag comes from `crictl images --no-trunc`
#     (the IMAGE ID column), and must match the host ID exactly.
#
# Node enumeration: iterate every server/agent node container (skip the
# *-serverlb load balancer, which has no containerd). If NO node container can
# be enumerated we cannot verify the import — that is a failure, not a success
# (returning 0 here would "verify" nothing).
image_present_in_cluster() {
  local image_ref="$1"
  local repo="${image_ref%:*}"
  local tag="${image_ref##*:}"
  local node node_count=0
  local expected_id node_id

  # Host-side image ID of the freshly built ref. Fail closed if we can't read it
  # (e.g. the host image was pruned before verify) — we can't prove a match.
  expected_id="$(docker image inspect --format '{{.Id}}' "${image_ref}" 2>/dev/null)"
  if [ -z "${expected_id}" ]; then
    log "Cannot read host image ID for ${image_ref}; unable to verify the in-cluster image by digest."
    return 1
  fi

  for node in $(docker ps --filter "label=k3d.cluster=${CLUSTER_NAME}" --format '{{.Names}}' 2>/dev/null); do
    case "${node}" in *serverlb*) continue ;; esac
    node_count=$((node_count + 1))

    # crictl images --no-trunc columns: IMAGE  TAG  IMAGE-ID  SIZE.
    # Capture the IMAGE-ID for the matching repo:tag row (first match wins).
    node_id="$(docker exec "${node}" crictl images --no-trunc 2>/dev/null \
      | awk -v repo="${repo}" -v tag="${tag}" \
          '$1==repo && $2==tag {print $3; exit}')"

    if [ -z "${node_id}" ]; then
      log "Image ${image_ref} not found on node ${node}."
      return 1
    fi
    if [ "${node_id}" != "${expected_id}" ]; then
      log "Image ${image_ref} on node ${node} has ID ${node_id}, expected ${expected_id} (stale same-tag image — import did not land)."
      return 1
    fi
  done

  if [ "${node_count}" -eq 0 ]; then
    log "Could not enumerate any k3d node container for cluster ${CLUSTER_NAME}; unable to verify the import landed."
    return 1
  fi
  return 0
}

# Import, then confirm the image is really present by digest. A clean exit from
# `k3d image import` is necessary but not sufficient (see image_present_in_cluster).
import_and_verify_into_cluster() {
  local image_ref="$1"
  local mode="$2"

  run_k3d_image_import "${image_ref}" "${mode}" || return 1
  if ! image_present_in_cluster "${image_ref}"; then
    log "Import (mode ${mode}) exited 0 but ${image_ref} did not land in the cluster node containerd; treating as failed."
    return 1
  fi
  return 0
}

# Import with the primary mode; on failure (or unverified landing) retry with
# the configured fallback mode. Returns non-zero only if both modes fail.
#
# Fast-path: if the image (by host-side digest) is already present on every
# cluster node, skip the import entirely — `k3d image import` is idempotent
# but takes 12–18s per image. The fast-path turns a repeat `k3d:up --no-rebuild`
# from ~1 min (5 silent re-imports) into ~1 s of node inspections.
ensure_image_imported_into_cluster() {
  local image_ref="$1"

  if image_present_in_cluster "${image_ref}"; then
    log "${image_ref} already imported into cluster — skipping import."
    return 0
  fi

  if ! import_and_verify_into_cluster "${image_ref}" "${IMAGE_IMPORT_MODE}"; then
    if [ "${IMAGE_IMPORT_FALLBACK_MODE}" = "${IMAGE_IMPORT_MODE}" ]; then
      log "Image import failed/unverified for ${image_ref} with mode ${IMAGE_IMPORT_MODE} and no alternate fallback mode is configured."
      return 1
    fi

    log "Image import of ${image_ref} with mode ${IMAGE_IMPORT_MODE} failed or did not land; retrying with ${IMAGE_IMPORT_FALLBACK_MODE}."
    if ! import_and_verify_into_cluster "${image_ref}" "${IMAGE_IMPORT_FALLBACK_MODE}"; then
      log "Image ${image_ref} did not land in the cluster after both modes (${IMAGE_IMPORT_MODE}, ${IMAGE_IMPORT_FALLBACK_MODE})."
      return 1
    fi
  fi
  return 0
}
