#!/usr/bin/env node
// cleanup-ghcr-versions.mjs — tag-aware GHCR retention for container images.
//
// Usage (dry-run, the default):
//   node scripts/platform/cleanup-ghcr-versions.mjs <package-name>
//
// Usage (apply deletions, CI only):
//   APPLY=1 node scripts/platform/cleanup-ghcr-versions.mjs <package-name>
//
// Retention rules applied per image (inspect metadata.container.tags[]):
//   1. Untagged versions       -> always delete.
//   2. prod-* versions         -> always keep; bound to the 3 newest by created_at.
//                                 Older prod-* beyond 3 are deleted.
//   3. sha-*/latest versions   -> keep the 10 newest by created_at.
//                                 A version tagged with BOTH sha-* and prod-* is
//                                 counted as prod-* only (does not consume a sha-*
//                                 slot; prod-* wins).
//   4. Unrecognised tags       -> keep unconditionally + print a warning.
//                                 (Safety default: never silently delete unknown tags.)
//
// Environment variables:
//   APPLY=1            -- actually call the DELETE API; default is dry-run.
//   GH_TOKEN           -- GitHub token (read by `gh` CLI automatically).
//   GHCR_ORG           -- GitHub org owning the packages (default: daydream-software).
//
// The script exits non-zero if any DELETE call fails.
//
// Security note: package-name is validated against an allowlist before being
// interpolated into shell commands; version IDs are numeric and validated.

import { execFileSync } from 'node:child_process';

const ORG = process.env.GHCR_ORG ?? 'daydream-software';
const APPLY = process.env.APPLY === '1';
const SHA_KEEP = 10;
const PROD_KEEP = 3;

// Allowed package names — whitelist to prevent command injection via argv.
const ALLOWED_PACKAGES = new Set([
  'dnd-notes',
  'dnd-notes-control-plane',
  'dnd-notes-customer-portal',
  'dnd-notes-operator-portal',
  'dnd-notes-activator',
]);

// ---------------------------------------------------------------------------
// Pure decision logic — no I/O, fully testable.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: number, name: string, created_at: string,
 *             metadata: { container: { tags: string[] } } }} GhcrVersion
 */

/**
 * Classify a single version's tags into a category.
 * Returns: 'untagged' | 'prod' | 'sha' | 'unknown'
 *
 * Classification rules (in priority order):
 *   - Any prod-* tag present -> 'prod'   (prod wins over sha-*)
 *   - Any sha-* or 'latest' tag present -> 'sha'
 *   - No tags at all -> 'untagged'
 *   - Any other tag -> 'unknown'
 */
export function classifyVersion(version) {
  const tags = version.metadata?.container?.tags ?? [];
  if (tags.length === 0) return 'untagged';
  if (tags.some((t) => t.startsWith('prod-'))) return 'prod';
  if (tags.some((t) => t.startsWith('sha-') || t === 'latest')) return 'sha';
  return 'unknown';
}

/**
 * Compute which versions to keep and which to delete.
 *
 * @param {GhcrVersion[]} versions  -- Raw array from the GHCR versions API.
 * @returns {{ keep: GhcrVersion[], delete: GhcrVersion[], warnings: string[] }}
 */
export function decide(versions) {
  const keep = [];
  const toDelete = [];
  const warnings = [];

  // Partition by category.
  const untagged = [];
  const prod = [];
  const sha = [];
  const unknown = [];

  for (const v of versions) {
    const cat = classifyVersion(v);
    if (cat === 'untagged') untagged.push(v);
    else if (cat === 'prod') prod.push(v);
    else if (cat === 'sha') sha.push(v);
    else unknown.push(v);
  }

  // 1. Untagged -> always delete.
  toDelete.push(...untagged);

  // 2. Unknown tags -> always keep + warn.
  for (const v of unknown) {
    const tags = v.metadata.container.tags;
    warnings.push(
      `version ${v.id} has unrecognised tags [${tags.join(', ')}] -- keeping (manual review needed)`,
    );
    keep.push(v);
  }

  // 3. prod-* -> keep the PROD_KEEP newest; delete the rest.
  const prodSorted = [...prod].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  keep.push(...prodSorted.slice(0, PROD_KEEP));
  toDelete.push(...prodSorted.slice(PROD_KEEP));

  // 4. sha-*/latest -> keep the SHA_KEEP newest; delete the rest.
  //    prod-* versions are already excluded from this pool above, so a version
  //    carrying both sha-* and prod-* tags correctly occupies zero sha-* slots.
  const shaSorted = [...sha].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  keep.push(...shaSorted.slice(0, SHA_KEEP));
  toDelete.push(...shaSorted.slice(SHA_KEEP));

  return { keep, delete: toDelete, warnings };
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

/** Fetch all versions of a package, following pagination via gh --paginate. */
function fetchVersions(org, pkg) {
  // gh api --paginate concatenates all pages into a single JSON array.
  const raw = execFileSync(
    'gh',
    ['api', '--paginate', `/orgs/${org}/packages/container/${pkg}/versions?per_page=100`],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw);
}

/** Delete a single package version via the GitHub API. */
function deleteVersion(org, pkg, versionId) {
  // versionId must be a positive integer.
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throw new Error(`Invalid version ID: ${versionId}`);
  }
  execFileSync(
    'gh',
    ['api', '-X', 'DELETE', `/orgs/${org}/packages/container/${pkg}/versions/${versionId}`],
    { encoding: 'utf8', stdio: 'pipe' },
  );
}

function formatVersion(v) {
  const tags = v.metadata.container.tags;
  const tagStr = tags.length > 0 ? tags.join(', ') : '(untagged)';
  return `id=${v.id} created=${v.created_at} tags=[${tagStr}]`;
}

// ---------------------------------------------------------------------------
// Main — runs only when executed directly (not imported by tests).
// ---------------------------------------------------------------------------

// ESM equivalent of require.main === module.
const isMain =
  process.argv[1] != null &&
  (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const pkg = process.argv[2];
  if (!pkg) {
    console.error('Usage: node cleanup-ghcr-versions.mjs <package-name>');
    process.exit(1);
  }

  if (!ALLOWED_PACKAGES.has(pkg)) {
    console.error(`Unknown package: ${pkg}`);
    console.error(`Allowed packages: ${[...ALLOWED_PACKAGES].join(', ')}`);
    process.exit(1);
  }

  console.log(`Package:  ${ORG}/${pkg}`);
  console.log(`Mode:     ${APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no changes)'}`);
  console.log('');

  let versions;
  try {
    versions = fetchVersions(ORG, pkg);
  } catch (err) {
    // Package not found is non-fatal -- the activator package will not exist
    // until the first push job creates it. Print a notice and exit cleanly.
    const stderr = err.stderr ?? '';
    const msg = err.message ?? '';
    if (stderr.includes('404') || msg.includes('404') || stderr.includes('Package not found')) {
      console.log(`Package ${pkg} not found in GHCR (may not have been pushed yet) -- skipping.`);
      process.exit(0);
    }
    throw err;
  }

  console.log(`Fetched ${versions.length} version(s).`);
  console.log('');

  const result = decide(versions);

  if (result.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of result.warnings) {
      console.log(`  WARN: ${w}`);
    }
    console.log('');
  }

  console.log(`Keep (${result.keep.length}):`);
  for (const v of result.keep) {
    console.log(`  KEEP  ${formatVersion(v)}`);
  }
  console.log('');

  console.log(`Delete (${result.delete.length}):`);
  for (const v of result.delete) {
    console.log(`  ${APPLY ? 'DELETE' : 'WOULD DELETE'}  ${formatVersion(v)}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('Dry-run complete. Set APPLY=1 to apply deletions.');
    process.exit(0);
  }

  let errors = 0;
  for (const v of result.delete) {
    try {
      deleteVersion(ORG, pkg, v.id);
      console.log(`Deleted version ${v.id}.`);
    } catch (err) {
      console.error(`Failed to delete version ${v.id}: ${err.message}`);
      errors++;
    }
  }

  if (errors > 0) {
    console.error(`${errors} deletion(s) failed.`);
    process.exit(1);
  }

  console.log('Cleanup complete.');
}
