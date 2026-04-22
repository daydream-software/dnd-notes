#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

validate_keycloak_realm_seed() {
  local manifest_path="$1"
  local display_path="${manifest_path#"${ROOT}/"}"

  node - "$manifest_path" <<'EOF'
const fs = require('node:fs');

const manifestPath = process.argv[2];
const manifest = fs.readFileSync(manifestPath, 'utf8');
const realmMatch = manifest.match(
  /^\s{2}dnd-notes-dev-realm\.json: \|\n((?:^\s{4}.*\n?)*)/m,
);

if (!realmMatch) {
  throw new Error(`Could not find dnd-notes-dev-realm.json block in ${manifestPath}`);
}

const realmJson = realmMatch[1].replace(/^ {4}/gm, '');
const realm = JSON.parse(realmJson);
const clients = Array.isArray(realm.clients) ? realm.clients : [];

if (clients.some((client) => Object.hasOwn(client, 'roles'))) {
  throw new Error(
    'Keycloak realm seed defines client roles under clients[].roles; use top-level roles.client.<clientId> instead.',
  );
}

const controlPlaneRoles = realm.roles?.client?.['dnd-notes-control-plane'];
if (!Array.isArray(controlPlaneRoles) || controlPlaneRoles.length === 0) {
  throw new Error(
    'Keycloak realm seed must define control-plane client roles under roles.client["dnd-notes-control-plane"].',
  );
}
EOF

  echo "Validated ${display_path}"
}

validate_overlay() {
  local overlay_path="$1"
  local display_path="${overlay_path#"${ROOT}/"}"
  local has_manifest_content
  has_manifest_content="$(
    kubectl kustomize "$overlay_path" | awk '
      BEGIN { found = 0 }
      /[^[:space:]]/ { found = 1 }
      END { print found }
    '
  )"

  if [[ "${has_manifest_content}" != "1" ]]; then
    echo "Rendered manifest was empty for ${display_path}" >&2
    exit 1
  fi

  echo "Validated ${display_path}"
}

require_tool kubectl
require_tool node

validate_overlay "${ROOT}/platform/control-plane/overlays/k3d"
validate_overlay "${ROOT}/platform/control-plane/overlays/hosted-reference"
validate_keycloak_realm_seed "${ROOT}/platform/k3d/keycloak.yaml"
