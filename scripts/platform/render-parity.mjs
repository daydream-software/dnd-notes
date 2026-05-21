// Render-parity checker for deploy/k3s/overlays/{k3d,prod}.
//
// Invoked by scripts/platform/validate-render-parity.sh with two file-path
// arguments: the rendered k3d overlay and the rendered prod overlay. Asserts
// structural parity (same keys / same resources) while allowing environment-
// specific values to differ. Exits non-zero with a precise diff on any mismatch.

import { readFileSync } from 'node:fs';
import jsYaml from 'js-yaml';

const [k3dPath, prodPath] = process.argv.slice(2);
if (!k3dPath || !prodPath) {
  console.error('Usage: node render-parity.mjs <k3d-render.yaml> <prod-render.yaml>');
  process.exit(1);
}

const ENVS = {
  k3d: readFileSync(k3dPath, 'utf8'),
  prod: readFileSync(prodPath, 'utf8'),
};

for (const [name, value] of Object.entries(ENVS)) {
  if (!value || !value.trim()) {
    console.error(`Empty render for ${name} overlay.`);
    process.exit(1);
  }
}

/** Parse a multi-doc YAML render into an array of resource objects. */
function parseRender(text) {
  const docs = [];
  jsYaml.loadAll(text, (doc) => docs.push(doc));
  return docs.filter((obj) => obj && obj.kind && obj.metadata && obj.metadata.name);
}

const k3d = parseRender(ENVS.k3d);
const prod = parseRender(ENVS.prod);

const errors = [];

// ---------------------------------------------------------------------------
// 1. ConfigMap data-key parity for the four hand-authored app ConfigMaps.
//    (The keycloak theme ConfigMaps are generated + hash-suffixed and carry
//    identical content in both envs; the realm ConfigMaps deliberately diverge
//    in value but are validated for structure by validate-manifests.sh.)
// ---------------------------------------------------------------------------
const PARITY_CONFIGMAPS = [
  'dnd-notes-control-plane-config',
  'customer-portal-config',
  'operator-portal-config',
  'dnd-notes-activator-config',
];

function findConfigMap(resources, cmName) {
  return resources.find((r) => r.kind === 'ConfigMap' && r.metadata.name === cmName);
}

for (const cmName of PARITY_CONFIGMAPS) {
  const a = findConfigMap(k3d, cmName);
  const b = findConfigMap(prod, cmName);
  if (!a) {
    errors.push(`ConfigMap "${cmName}" missing from k3d render.`);
    continue;
  }
  if (!b) {
    errors.push(`ConfigMap "${cmName}" missing from prod render.`);
    continue;
  }
  const aKeys = new Set(Object.keys(a.data ?? {}));
  const bKeys = new Set(Object.keys(b.data ?? {}));
  for (const key of aKeys) {
    if (!bKeys.has(key)) {
      errors.push(`ConfigMap "${cmName}": key "${key}" present in k3d but absent in prod (dropped-key class).`);
    }
  }
  for (const key of bKeys) {
    if (!aKeys.has(key)) {
      errors.push(`ConfigMap "${cmName}": key "${key}" present in prod but absent in k3d (dropped-key class).`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Workload + RBAC resource-set parity. Each named resource present in one
//    overlay must be present in the other. Names are stable (not hash-suffixed)
//    for these kinds, so a plain name match is exact.
// ---------------------------------------------------------------------------
const PARITY_KINDS = new Set([
  'Deployment',
  'Service',
  'CronJob',
  'ClusterRole',
  'ClusterRoleBinding',
  'ServiceAccount',
  'StatefulSet',
]);

// ClusterRole / ClusterRoleBinding are cluster-scoped and carry no namespace.
// Bucketing them under a fixed scope keeps their key stable across overlays
// instead of leaking an `undefined` namespace segment into the identity.
const CLUSTER_SCOPED_KINDS = new Set(['ClusterRole', 'ClusterRoleBinding']);

function resourceKeys(resources) {
  const keys = new Set();
  for (const r of resources) {
    if (PARITY_KINDS.has(r.kind)) {
      // Two namespaced resources with the same kind+name in different
      // namespaces are distinct; fold the namespace into the identity so a
      // missing-resource regression in one namespace cannot be masked by a
      // same-named resource in another.
      const scope = CLUSTER_SCOPED_KINDS.has(r.kind)
        ? '_cluster'
        : (r.metadata.namespace ?? '_default');
      keys.add(`${r.kind}/${scope}/${r.metadata.name}`);
    }
  }
  return keys;
}

const k3dKeys = resourceKeys(k3d);
const prodKeys = resourceKeys(prod);

for (const key of k3dKeys) {
  if (!prodKeys.has(key)) {
    errors.push(`Resource "${key}" present in k3d but absent in prod.`);
  }
}
for (const key of prodKeys) {
  if (!k3dKeys.has(key)) {
    errors.push(`Resource "${key}" present in prod but absent in k3d.`);
  }
}

// ---------------------------------------------------------------------------
// 3. Sanity: the #363 canary key must exist in BOTH control-plane configmaps.
// ---------------------------------------------------------------------------
for (const [envName, resources] of [['k3d', k3d], ['prod', prod]]) {
  const cm = findConfigMap(resources, 'dnd-notes-control-plane-config');
  for (const requiredKey of ['ACTIVATOR_EXTERNAL_NAME', 'ACTIVATOR_PORT']) {
    if (!cm || !Object.hasOwn(cm.data ?? {}, requiredKey)) {
      errors.push(`${envName}: dnd-notes-control-plane-config is missing required key "${requiredKey}".`);
    }
  }
}

if (errors.length > 0) {
  console.error('Render-parity check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nOverlays must express only environment deltas. A structural key present');
  console.error('in one overlay but absent in the other is the #363 dropped-key regression.');
  process.exit(1);
}

console.log('Render-parity check passed:');
console.log(`  ConfigMap data keys match across ${PARITY_CONFIGMAPS.length} app config maps.`);
console.log(`  ${k3dKeys.size} workload/RBAC resources match across both overlays.`);
console.log('  ACTIVATOR_EXTERNAL_NAME + ACTIVATOR_PORT present in both control-plane configmaps.');
