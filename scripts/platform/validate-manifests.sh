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

validate_keycloak_hosted_workforce_realm() {
  local manifest_path="$1"
  local display_path="${manifest_path#"${ROOT}/"}"

  node - "$manifest_path" <<'EOF'
const fs = require('node:fs');

const manifestPath = process.argv[2];
const manifest = fs.readFileSync(manifestPath, 'utf8');
const realmMatch = manifest.match(
  /^\s{2}dnd-notes-workforce-realm\.json: \|\n((?:^\s{4}.*\n?)*)/m,
);

if (!realmMatch) {
  throw new Error(`Could not find dnd-notes-workforce-realm.json block in ${manifestPath}`);
}

const realmJson = realmMatch[1].replace(/^ {4}/gm, '');
const realm = JSON.parse(realmJson);
const clients = Array.isArray(realm.clients) ? realm.clients : [];

if (clients.some((client) => Object.hasOwn(client, 'roles'))) {
  throw new Error(
    'Keycloak workforce realm seed defines client roles under clients[].roles; use top-level roles.client.<clientId> instead.',
  );
}

const controlPlaneRoles = realm.roles?.client?.['dnd-notes-control-plane'];
if (!Array.isArray(controlPlaneRoles) || controlPlaneRoles.length === 0) {
  throw new Error(
    'Keycloak hosted-reference workforce realm must define control-plane client roles under roles.client["dnd-notes-control-plane"].',
  );
}

const cpClient = clients.find((c) => c.clientId === 'dnd-notes-control-plane');
if (!cpClient) {
  throw new Error('Keycloak hosted-reference workforce realm is missing dnd-notes-control-plane client.');
}
if (cpClient.attributes?.login_theme !== 'operator-login') {
  throw new Error(
    `dnd-notes-control-plane client must have attributes.login_theme = "operator-login" (got: ${cpClient.attributes?.login_theme})`,
  );
}
EOF

  echo "Validated ${display_path}"
}

validate_keycloak_hosted_tenant_realm() {
  local manifest_path="$1"
  local display_path="${manifest_path#"${ROOT}/"}"

  node - "$manifest_path" <<'EOF'
const fs = require('node:fs');

const manifestPath = process.argv[2];
const manifest = fs.readFileSync(manifestPath, 'utf8');
const realmMatch = manifest.match(
  /^\s{2}dnd-notes-realm\.json: \|\n((?:^\s{4}.*\n?)*)/m,
);

if (!realmMatch) {
  throw new Error(`Could not find dnd-notes-realm.json block in ${manifestPath}`);
}

const realmJson = realmMatch[1].replace(/^ {4}/gm, '');
const realm = JSON.parse(realmJson);
const clients = Array.isArray(realm.clients) ? realm.clients : [];

if (clients.some((client) => Object.hasOwn(client, 'roles'))) {
  throw new Error(
    'Keycloak tenant realm seed defines client roles under clients[].roles; use top-level roles.client.<clientId> instead.',
  );
}

if (realm.loginTheme !== 'customer-login') {
  throw new Error(
    `Keycloak tenant realm must have loginTheme = "customer-login" (got: ${realm.loginTheme})`,
  );
}

const portalClient = clients.find((c) => c.clientId === 'dnd-notes-customer-portal');
if (!portalClient) {
  throw new Error('Keycloak hosted-reference tenant realm is missing dnd-notes-customer-portal client.');
}

const adminClient = clients.find((c) => c.clientId === 'dnd-notes-keycloak-admin');
if (!adminClient) {
  throw new Error('Keycloak hosted-reference tenant realm is missing dnd-notes-keycloak-admin service account client.');
}

const users = Array.isArray(realm.users) ? realm.users : [];
const svcAccount = users.find((u) => u.username === 'service-account-dnd-notes-keycloak-admin');
if (!svcAccount) {
  throw new Error(
    'Keycloak hosted-reference tenant realm is missing service-account-dnd-notes-keycloak-admin user entry (required for realm-management role grants).',
  );
}
const rmRoles = Array.isArray(svcAccount.clientRoles?.['realm-management'])
  ? svcAccount.clientRoles['realm-management']
  : [];
for (const requiredRole of ['manage-clients', 'view-clients']) {
  if (!rmRoles.includes(requiredRole)) {
    throw new Error(
      `service-account-dnd-notes-keycloak-admin must have realm-management role "${requiredRole}" (got: [${rmRoles.join(', ')}])`,
    );
  }
}
EOF

  echo "Validated ${display_path}"
}

require_tool kubectl
require_tool node

# Both overlays of the unified deploy/k3s tree must render to non-empty manifests.
validate_overlay "${ROOT}/deploy/k3s/overlays/prod"
validate_overlay "${ROOT}/deploy/k3s/overlays/k3d"

# Keycloak 2-realm seeds. The prod content lives in the base; the k3d content is
# patched in the k3d overlay. Both files carry both realm JSON blocks
# (tenant dnd-notes + workforce dnd-notes-workforce), so each is validated by the
# tenant + workforce realm-seed checkers.
validate_keycloak_hosted_tenant_realm "${ROOT}/deploy/k3s/base/keycloak/realm-config.yaml"
validate_keycloak_hosted_workforce_realm "${ROOT}/deploy/k3s/base/keycloak/realm-config.yaml"
validate_keycloak_hosted_tenant_realm "${ROOT}/deploy/k3s/overlays/k3d/keycloak-realm-config.yaml"
validate_keycloak_hosted_workforce_realm "${ROOT}/deploy/k3s/overlays/k3d/keycloak-realm-config.yaml"
