# Session Log: PR #72 Second Review Wave

**Date:** 2026-04-21 20:14 UTC  
**Issue:** #72 (Per-Tenant Postgres Credentials)  
**Agent:** Data (Backend Dev)  
**Branch:** `squad/69-per-tenant-postgres-credentials`  
**Status:** Complete — Fresh review requested after hardening fixes

## Work Done

Data addressed a second wave of review feedback on PR #72 (least-privilege Postgres credentials), focusing on correctness guards and regression coverage.

### Fixed Issues

#### 1. **Blank Credential Guard**
   - **Problem:** Empty or whitespace-only runtime connection strings (`DATABASE_URL`) silently passed validation, allowing subsequent credential rotation paths to run on invalid state.
   - **Impact:** Could lead to silent failures if a secret was accidentally blanked during tenant provisioning.
   - **Resolution:** Added guard in `note-store-bootstrap.ts` to throw `missing-secret` error before any rotation path executes.
   - **Files:** `apps/api/src/note-store-bootstrap.ts`
   - **Commit:** `f85831b`

#### 2. **Owner Email Uniqueness Index Verification**
   - **Problem:** In least-privilege mode, the `note-store-bootstrap` verifies schema assumptions including the case-insensitive owner email uniqueness index.
   - **Gap:** No explicit verification that this index exists and functions correctly when running under restricted Postgres roles.
   - **Resolution:** Added explicit index verification step to confirm owner email uniqueness is enforced before other schema operations proceed.
   - **Files:** `apps/api/src/note-store-bootstrap.ts`
   - **Commit:** `f85831b`

#### 3. **Control-Plane Provisioning Schema Validation**
   - **Problem:** Runtime role revocation logic in `provisioning.ts` could apply blindly without verifying current state.
   - **Gap:** Missing validation that pre-init schema creation actually succeeded before bootstrap path continues.
   - **Resolution:** Added explicit pre-init verification in `TenantProvisioningService` before runtime role assignments proceed.
   - **Files:** `apps/control-plane/src/provisioning.ts`
   - **Commit:** `f85831b`

### Regression Coverage

Added focused regression tests to validate correctness guards:

- **`apps/api/test/note-store-bootstrap.test.ts`** (new):
  - Blank `DATABASE_URL` guard: verifies error thrown before bootstrap proceeds
  - Index existence validation: confirms owner email uniqueness check passes
  
- **`apps/control-plane/test/provisioning.test.ts`** (updated):
  - Pre-init schema verification: validates provisioning waits for bootstrap completion
  - Role revocation safety: confirms guarded application of REVOKE only when safe

**All 12 regression tests pass. No regressions in existing suites.**

## Validation

All changes validated against existing test suites:
- `npm run test --workspace apps/api -- --runInBand` → ✅ 48 tests pass
- `npm run test --workspace apps/control-plane -- --runInBand` → ✅ 28 tests pass
- `npm run lint --workspace apps/api` → ✅ Clean
- `npm run lint --workspace apps/control-plane` → ✅ Clean
- `npm run build --workspace apps/api` → ✅ Success
- `npm run build --workspace apps/control-plane` → ✅ Success
- `npm run platform:validate` → ✅ Full platform validation passes

## GitHub Review Status

All 6 review threads on PR #72 now resolved:

1. ✅ REVOKE PUBLIC privileges (3 threads) — Fixed in `27e810b` + hardened in `f85831b`
2. ✅ Schema privilege check fail-open bug — Fixed in `27e810b` + verified in `f85831b`
3. ✅ Missing secret guard — Implemented in `f85831b`
4. ✅ Duplicated schema DDL — Documented as deferred maintenance follow-up
5. ✅ Index verification — Implemented in `f85831b`
6. ✅ Pre-init validation — Implemented in `f85831b`

**Status:** Fresh review requested. All correctness guards in place. Ready for final approval.

## Key Changes in `f85831b`

- **`apps/api/src/note-store-bootstrap.ts`:**
  - Added blank `DATABASE_URL` check before credential rotation: throws `missing-secret` if value is empty or whitespace-only
  - Added explicit owner email uniqueness index verification
  - All schema operations now gated behind these guards

- **`apps/api/test/note-store-bootstrap.test.ts`:**
  - New test suite: blank credential guard, index existence validation
  - Comprehensive coverage of pre-init assumptions

- **`apps/control-plane/src/provisioning.ts`:**
  - Runtime role REVOKE now explicitly preceded by pre-init schema verification
  - Role assignment guarded to ensure safe execution state

- **`apps/control-plane/test/provisioning.test.ts`:**
  - Added pre-init verification and role-revocation safety tests

## Context for Next Reviewer

**PR Status:**
- All blocking review comments addressed across two fix batches
- Correctness guards in place (blank credential detection, index verification)
- Regression coverage complete (12 new tests, all green)
- Full platform validation passing
- Ready for fresh review

**Why Two Batches:**
- First batch (`27e810b`): Fixed REVOKE logic and schema verification failures
- Second batch (`f85831b`): Added hardening guards to prevent silent failures during credential rotation

**Architecture:**
- Per-tenant Postgres roles with minimal privileges (CONNECT, USAGE only)
- Least-privilege bootstrap verifies schema and secrets before proceeding
- Safe deprovision cleanup removes unused roles
- Existing tenants stay on shared creds until explicit migration

**Related Work:**
- Complements Issue #69 (per-tenant credential implementation)
- Paves way for Phase 2 identity work (#56) and restore orchestration (#40)

---

*Logged by Scribe. Session complete.*
