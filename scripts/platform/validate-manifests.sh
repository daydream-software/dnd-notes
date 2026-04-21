#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

validate_overlay() {
  local overlay_path="$1"
  local display_path="${overlay_path#"${ROOT}/"}"

  local rendered_manifest
  rendered_manifest="$(kubectl kustomize "$overlay_path")"

  if [[ -z "${rendered_manifest}" ]]; then
    echo "Rendered manifest was empty for ${display_path}" >&2
    exit 1
  fi

  echo "Validated ${display_path}"
}

require_tool kubectl

validate_overlay "${ROOT}/platform/control-plane/overlays/k3d"
validate_overlay "${ROOT}/platform/control-plane/overlays/hosted-reference"
