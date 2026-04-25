# Issue #97: Control-Plane Postgres Migration

## Summary

Migrated control-plane tenant registry from PVC-backed SQLite to shared Postgres instance, removing the PVC dependency and enabling stateless control-plane deployment.

## Changes

### Code Changes
- **Refactored TenantRegistry** into a Postgres-only async implementation:
  - `tenant-registry.ts` - Thin entrypoint that re-exports the Postgres registry
  - `tenant-registry-postgres.ts` - Postgres-backed registry with schema bootstrap and pooling
- **Updated app.ts** - Added `await` to 40+ TenantRegistry call sites
- **Updated index.ts** - Added CONTROL_PLANE_DATABASE_URL support

### Platform Changes
- **Removed PVC dependency:**
  - Deleted `platform/control-plane/base/pvc.yaml`
  - Removed from `kustomization.yaml`
  - Removed volume mounts from Deployment
  - Removed DATABASE_PATH from base ConfigMap
- **Added Postgres support:**
  - Added CONTROL_PLANE_DATABASE_URL to Secret
  - Added optional `CONTROL_PLANE_DATABASE_*` pool tuning env vars for min/max/timeout settings
  - Updated k3d secret-patch with Postgres URL example
- **Updated k3d bootstrap:**
  - `scripts/k3d/bootstrap.sh` now creates `control_plane` database
- **Updated smoke tests:**
  - `scripts/k3d/smoke.sh` wires CONTROL_PLANE_DATABASE_URL for the local control-plane process
  - `scripts/k3d/full-stack-smoke.sh` wires CONTROL_PLANE_DATABASE_URL for the in-cluster control-plane secret

## Validation

 `npm test --workspace apps/control-plane` - passes
 `npm run build --workspace apps/control-plane` - builds cleanly
 `npm run lint --workspace apps/control-plane` - no issues
 `npm run platform:validate` - manifests valid

## Next Steps

- Run `npm run k3d:full-stack-smoke` for end-to-end validation
- Consider updating RUNTIME.md with CONTROL_PLANE_DATABASE_URL documentation

## Migration Strategy

- Hosted rollouts assume a fresh control-plane Postgres bootstrap; this PR does not add an automated SQLite-to-Postgres migration path for pre-existing control-plane registries.
- That matches the intended deployment path for this slice: there is no production control-plane SQLite dataset that must be preserved before switching hosted environments to `CONTROL_PLANE_DATABASE_URL`.
- Older local/dev SQLite registries should be treated as disposable unless someone explicitly needs to preserve their metadata, in which case that migration remains a separate manual follow-up.

## Commits

- `c37a12a` - feat(control-plane): migrate registry to postgres fixes #97
- `a5bb8f3` - feat(platform): migrate control-plane to Postgres registry
- `175bf29` - fix(control-plane): address #97 review feedback
- `e6fcb3e` - chore(control-plane): align #97 follow-up docs and tests

## Technical Notes

**Challenge:** Node.js has no synchronous Postgres client, but TenantRegistry was built for synchronous better-sqlite3.

**Solution:** Converted the control-plane TenantRegistry to async, which was acceptable because:
1. Express 5 naturally supports async route handlers
2. The provisioning layer already used async/await
3. The hosted control-plane now has a single Postgres runtime contract

**Key Decision:** Rather than trying to wedge synchronous Postgres access or add complex caching layers, we did the clean refactor to async. This makes the codebase more modern and maintainable.
