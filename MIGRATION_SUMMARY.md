# Issue #97: Control-Plane Postgres Migration

## Summary

Migrated control-plane tenant registry from PVC-backed SQLite to shared Postgres instance, removing the PVC dependency and enabling stateless control-plane deployment.

## Changes

### Code Changes
- **Refactored TenantRegistry** into dual-mode async implementation:
  - `tenant-registry.ts` - Thin wrapper that detects SQLite vs Postgres
  - `tenant-registry-sqlite.ts` - SQLite backend (preserves local dev)
  - `tenant-registry-postgres.ts` - New Postgres backend
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
  - Updated k3d secret-patch with Postgres URL example
- **Updated k3d bootstrap:**
  - `scripts/k3d/bootstrap.sh` now creates `control_plane` database
- **Updated smoke tests:**
  - `scripts/k3d/full-stack-smoke.sh` wires CONTROL_PLANE_DATABASE_URL

## Validation

 `npm test --workspace apps/control-plane` - 111/111 tests pass
 `npm run build --workspace apps/control-plane` - builds cleanly
 `npm run lint --workspace apps/control-plane` - no issues
 `npm run platform:validate` - manifests valid

## Next Steps

- Run `npm run k3d:full-stack-smoke` for end-to-end validation
- Consider updating RUNTIME.md with CONTROL_PLANE_DATABASE_URL documentation

## Commits

- `c37a12a` - feat(control-plane): migrate registry to postgres fixes #97
- `d9b96f8` - fix(control-plane): support dual tenant registry backends fixes #97
- `a5bb8f3` - feat(platform): migrate control-plane to Postgres registry
- `222ee6d` - docs: record issue #97 completion in agent history
- `0f144ef` - chore: remove obsolete control-plane PVC manifest

## Technical Notes

**Challenge:** Node.js has no synchronous Postgres client, but TenantRegistry was built for synchronous better-sqlite3.

**Solution:** Converted entire TenantRegistry to async, which was acceptable because:
1. Express 5 naturally supports async route handlers
2. The provisioning layer already used async/await
3. Dual-mode implementation preserves local SQLite dev experience

**Key Decision:** Rather than trying to wedge synchronous Postgres access or add complex caching layers, we did the clean refactor to async. This makes the codebase more modern and maintainable.

