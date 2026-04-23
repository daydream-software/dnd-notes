# Chunk's QA Brief for Issue #97 — Control-Plane Registry Postgres Migration

## Executive Summary

Issue #97 migrates the control-plane registry from SQLite (`better-sqlite3`) to Postgres. The control-plane suite and platform validation should stay green, with focused test updates allowed where the Postgres-backed contract or regression coverage legitimately changes.

**Current Baseline:** SQLite-backed control-plane registry with a green control-plane test suite.
**Target State:** Postgres-backed control-plane registry with a green control-plane test suite and targeted regression coverage for the new runtime contract.

---

## Acceptance Gates (What Chunk Will Verify)

1. **No `better-sqlite3` import in `apps/control-plane/src/*`**
   - Verify with: `grep -r "better-sqlite3" apps/control-plane/src/`
   - Should return empty

2. **Control-plane Test Suite Passes Against Postgres**
   - Verify with: `npm test --workspace apps/control-plane`
   - Targeted test updates are acceptable when they lock down the Postgres-only contract or new regression coverage
   - Schema migrations (v1→v5) must work on real Postgres

3. **Constraint Error Mapping Correct**
   - SQLite `SQLITE_CONSTRAINT_UNIQUE` → Postgres `23505` (unique violation)
   - SQLite `SQLITE_CONSTRAINT_PRIMARYKEY` → Postgres `23505`
   - Other constraint codes mapped appropriately
   - API responses still return 409 (Conflict), not 500

4. **Graceful Shutdown Intact**
   - `shutdown.test.ts` tests must pass unchanged
   - `pool.end()` awaited during registry close

5. **Connection Pool Configuration Sensible**
   - `CONTROL_PLANE_DATABASE_URL` environment variable wired
   - Pool min/max connections configurable
   - Defaults reasonable for prod/staging/local

6. **K3d Smoke Passes**
   - `npm run k3d:full-stack-smoke` with control-plane on Postgres
   - Tenant creation, provisioning, state transitions all verify live

7. **PVC Removed + Migration Strategy Documented**
   - `platform/control-plane/base/pvc.yaml` gone
   - All PVC references from control-plane Deployment gone
   - Readme/docs note: "No production data to migrate on fresh deployment"

---

## High-Risk Parity Gaps (What to Watch For)

### 1. Schema Idempotence
**SQLite:** `CREATE TABLE IF NOT EXISTS`
**Postgres:** Must use explicit migration framework (e.g., raw SQL with `IF NOT EXISTS`, Knex, or custom migrator)
**Gate:** Run migration suite v1→v5 on both fresh DB and pre-existing v4 DB. Both must succeed.

### 2. Transaction Semantics
**SQLite:** Default SERIALIZABLE isolation
**Postgres:** Default READ COMMITTED isolation
**Watch for:** Concurrent tests that rely on isolation. Test duplicate subdomain and email reservations under load.
**Gate:** Collision detection must still work atomically.

### 3. Error Code Mapping
**SQLite:** Free-form error messages (e.g., "UNIQUE constraint failed: tenants.id")
**Postgres:** Structured error codes (23505, 23503, 23514, etc.)
**Gate:** Every constraint error path tested in `app.test.ts` must return correct HTTP status.

### 4. Graceful Shutdown
**Risk:** Pool not properly closed during pod termination could orphan connections or delay shutdown.
**Gate:** Existing `shutdown.test.ts` must pass. Verify `pool.end()` is awaited.

### 5. Type Coercion
**SQLite:** Everything is TEXT or INTEGER
**Postgres:** Explicit types (UUID, BIGINT, TIMESTAMP, JSONB, etc.)
**Watch for:** Implicit conversions in response marshaling (timestamps, IDs, etc.)
**Gate:** Response schema unchanged; types verified in app tests.

---

## Testing Checkpoints During Implementation

### Checkpoint 1: Schema + Test Adapter Ready
- [ ] Postgres schema defined (tenants, portal_accounts, portal_sessions, state_transitions, schema_metadata, audit_log if needed)
- [ ] Test database setup working (testcontainers, ephemeral instance, or CI-managed)
- [ ] TenantRegistry constructor wired to `CONTROL_PLANE_DATABASE_URL` or test DB
- [ ] Run: `npm test --workspace apps/control-plane -- test/tenant-registry.test.ts`
- [ ] Result: ≥7 tests pass (migration tests + subdomain tests + portal tests)

**Chunk's approval:** Green tenant-registry tests = ready for next slice.

### Checkpoint 2: Constraint Error Mapping
- [ ] `app.ts` constraint handlers check Postgres error codes (23505, 23503, etc.)
- [ ] Test conflict paths: duplicate ID, slug, email, subdomain
- [ ] Verify no 500 responses on constraint violations
- [ ] Run: `npm test --workspace apps/control-plane -- test/app.test.ts`
- [ ] Result: 0 regressions in signup, tenant create, portal account paths

**Chunk's approval:** All app tests pass + constraint responses reviewed = ready for pooling.

### Checkpoint 3: Connection Pooling
- [ ] `CONTROL_PLANE_DATABASE_URL` env var used
- [ ] Pool min/max configured via env or defaults
- [ ] `registry.close()` calls `pool.end()` and awaits
- [ ] Run: `npm test --workspace apps/control-plane -- test/shutdown.test.ts`
- [ ] Result: shutdown tests pass unchanged

**Chunk's approval:** Shutdown tests green + pool config sensible = ready for k3d.

### Checkpoint 4: K3d Setup
- [ ] `platform/k3d/postgres.yaml` provisions control-plane DB + user
- [ ] Smoke script injects real Postgres URL into Secret
- [ ] Verify tenant creation, provisioning, state transitions work live

**Chunk's approval:** K3d smoke passes = implementation complete.

### Checkpoint 5: PVC Removal + Docs
- [ ] `platform/control-plane/base/pvc.yaml` deleted
- [ ] Control-plane Deployment has no `volumeMounts` for PVC
- [ ] Readme/RUNTIME updated with migration note

**Chunk's approval:** All artifacts removed cleanly = ready to merge.

---

## Chunk's Approval Criteria (Binary)

**APPROVE:** All of the following:
- ✅ `npm test --workspace apps/control-plane` passes with any necessary targeted regression updates for the Postgres-backed contract
- ✅ Zero `better-sqlite3` imports in src
- ✅ Constraint errors map correctly (409, not 500)
- ✅ Shutdown tests unchanged and green
- ✅ K3d smoke passes
- ✅ PVC removed
- ✅ Docs note no migration needed for fresh deployment

**REJECT:** Any of the following:
- ❌ Test assertions rewritten to match Postgres behavior
- ❌ Constraint errors not mapped (500 on unique conflict instead of 409)
- ❌ Pool not properly closed on shutdown
- ❌ K3d smoke fails
- ❌ Better-sqlite3 still in imports

---

## Notes for Copilot

1. **Start with schema + test adapter** — this is the hardest part. Get the control-plane suite passing first.
2. **Preserve behavior where possible** — only change tests when the Postgres-backed contract or new regressions genuinely require it.
3. **Postgres error codes:** 23505 (unique), 23503 (foreign key), 23514 (check constraint), others as needed.
4. **Test framework:** Choose migration path early (knex, raw SQL, or custom). Affects whole slice.
5. **Isolation level:** Should be okay with Postgres default READ COMMITTED for this workload, but confirm with team if needed.
6. **No production data yet** — so no data migration needed, just schema bootstrap on fresh deployment.

---

## Reviewer's Proof Points

After implementation, run from repo root:

```bash
# Full test suite
npm run lint && npm test && npm run build

# Focused control-plane validation
npm test --workspace apps/control-plane
npm run lint --workspace apps/control-plane
npm run build --workspace apps/control-plane

# K3d smoke (if environment permits)
npm run k3d:full-stack-smoke
```

All should exit 0, and any test diffs should stay narrowly tied to the Postgres-backed migration contract.
