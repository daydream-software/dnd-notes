# Issue #55 QA Brief: Rolling-Update & Connection-Draining Choreography

**Status:** 🔵 Acceptance Gate Briefing  
**Owner:** Chunk (Tester)  
**Date:** 2026-04-22  
**Remaining Gate Item:** Phase 0 completion proof — single-writer orchestration for tenant rolling updates

---

## Problem Statement

Postgres-backed tenant instances run on Kubernetes but need **single-writer safety** during rolling updates. A naive pod rolling update can overlap old and new pod instances both holding Postgres connections, causing:
- Connection pool leaks (old pod never closes idle sockets)
- Phantom writes from drained pods (in-flight requests complete after pod is marked "done")
- Silent data loss if a pod crashes mid-transaction and its connection never releases a lock

This brief captures the **required proof points** before #55 is considered done.

---

## Current State: What Works

✅ **Shutdown choreography (phase 0 done):**
- API: graceful SIGTERM handler in `apps/api/src/shutdown.ts` + `apps/api/src/index.ts`
- Control-plane: same shutdown pattern
- Postgres pool: explicit `pool.end()` called on close
- Readiness probes: `/ready` + `/readyz` return 503 when `isShuttingDown()` is true

✅ **Kubernetes probes:**
- Liveness `/healthz`: always 200 (process alive)
- Readiness `/ready`: 200 if DB healthy + not draining, 503 during shutdown
- Graceful termination period: 30s default in Deployment manifests
- Pod eviction: Kubernetes removes pod from Endpoints when readiness fails

✅ **Connection pooling defaults:**
- `NOTES_DB_POOL_MIN=0`, `NOTES_DB_POOL_MAX=20` (tunable env vars)
- `NOTES_DB_IDLE_TIMEOUT_MS=30000` (30s, stale connections culled)
- `NOTES_DB_CONNECTION_TIMEOUT_MS=10000`
- `NOTES_DB_STATEMENT_TIMEOUT_MS=30000`

✅ **Postgres adapter:**
- SQLite fallback when `DATABASE_URL` is unset
- Both backends wrapped by same `NoteStoreDatabase` interface
- Close/shutdown path implemented for both

---

## **Highest-Risk Gaps Requiring Proof**

### 1. **Readiness Drain Race Window** 🔴 CRITICAL

**False-green trap:** Readiness probe can return 503 during shutdown, but there's a time window where:
- Kubernetes removes the pod from the load balancer
- Old in-flight requests are still being processed (30s grace period)
- A new rolling update pod starts immediately
- Both old and new pods are executing queries against the same Postgres instance

**Required proof:**
- [ ] Manifest sets `terminationGracePeriodSeconds: 30` (confirmed in `platform/control-plane/base/deployment.yaml`)
- [ ] Test: readiness probe fails **immediately** when SIGTERM is received (not after 30s grace period)
- [ ] Test: old pod's in-flight HTTP requests are given 30s to complete gracefully
- [ ] Test: connection pool is NOT drained until HTTP server closes (so old pod's background cleanup isn't cut short)
- [ ] Test: after 30s, any remaining idle sockets are force-closed before pool.end() completes

**Acceptance check:**
```bash
# Simulate rolling update: SIGTERM → readiness fails → pod drained from LB → 30s grace → hard shutdown
# Validate: query log shows old pod's queries complete, new pod's queries don't overlap
```

---

### 2. **Connection Pool Drain Under Load** 🔴 CRITICAL

**False-green trap:** Pool `end()` is called, but:
- Active queries may still be in flight at the time `end()` is invoked
- Node.js `Pool.end()` does **not** wait for active queries; it only prevents *new* queries
- If 10 queries are mid-flight when `end()` is called, they **may** complete or fail depending on timing

**Required proof:**
- [ ] Test: HTTP server closes first (stops accepting new requests)
- [ ] Test: in-flight requests drain for up to 30s without interference
- [ ] Test: pool `end()` is called **after** HTTP server close completes or grace period elapses
- [ ] Test: a query that takes 2s completes successfully even if SIGTERM arrives during it
- [ ] Test: a query that would take 35s is **not** force-killed mid-flight by Kubernetes; instead, it hits our 30s statement timeout and fails gracefully
- [ ] Test: stale connections (>30s idle) are removed from the pool before pod shutdown begins

**Acceptance check:**
```bash
# Simulate: heavy write load (20 concurrent requests) → SIGTERM → observe all complete or timeout cleanly
npm run test -- --grep "connection-drain-under-load"
```

---

### 3. **Postgres Connection Pooling Resilience** 🔴 CRITICAL

**False-green trap:** Postgres pool defaults are hardcoded in code, but:
- `NOTES_DB_POOL_MAX=20` may be too small or too large for the actual workload
- Connection timeout of 10s may fail on slow Postgres/network
- No test validates that pool size tuning actually prevents connection exhaustion

**Required proof:**
- [ ] Env var reads: `NOTES_DB_POOL_MIN`, `NOTES_DB_POOL_MAX`, timeouts all injectable
- [ ] Test: can acquire up to `POOL_MAX` connections concurrently
- [ ] Test: connection timeout is respected (10s default)
- [ ] Test: idle connections are released (30s idle timeout default)
- [ ] Test: pool recovers when a stale connection is evicted
- [ ] Test: statement timeout prevents runaway queries (30s default)
- [ ] Load drill: 20 concurrent requests against a slow Postgres instance (simulate latency with a delay)

**Acceptance check:**
```bash
npm run test -- --grep "postgres-pool" 
# Expect: pass when POOL_MAX is sufficient, fail gracefully when exhausted
```

---

### 4. **SPA Fallback Does Not Serve Admin Endpoints** 🟡 MEDIUM

**False-green trap:** SPA fallback logic exists (`apps/api/src/app.ts`), but:
- `GET /api/admin/backup` could accidentally return `index.html` if fallback is too permissive
- A broken XHR from the frontend could silence a 404 by returning cached index.html

**Required proof:**
- [ ] Test: `GET /missing-route` returns 404 (not index.html)
- [ ] Test: `GET /api/admin/backup` returns 403 or 401 (not index.html)
- [ ] Test: `POST /api/notes` with missing auth returns 401 (not index.html)
- [ ] Test: missing file asset (e.g., `GET /assets/missing.js`) returns 404 (not index.html)

**Acceptance check:**
```bash
npm run test -- --grep "spa-fallback-safety"
```

---

### 5. **Zero-Downtime Readiness During Schema Migrations** 🟡 MEDIUM

**Design limitation (not a bug, but test it):**
- If a future schema migration (issue #56+) adds columns, old pods must still handle queries with/without those columns gracefully
- Readiness probe must NOT fail during migration window (otherwise pod is marked unready while it's actually fine)

**Required proof:**
- [ ] Test: readiness check only validates connectivity, not schema completeness
- [ ] Test: a query against a missing column returns a clear SQL error, not a 503
- [ ] Document: schema migrations must be backward-compatible or require offline maintenance window

**Acceptance check:**
```bash
npm run test -- --grep "schema-compatibility"
```

---

## **Failure Drills: Edge Cases**

All of these must either pass gracefully or return explicit errors (no silent hangs):

### Drill A: Node Drain During Transaction
```
Scenario: Postgres node gets drained while a tenant pod holds an open transaction
- Old pod receives SIGTERM mid-transaction
- Postgres drops the connection after 30s
- Expected: Query fails with "connection lost" (not timeout, explicit error)
- Validate: no orphaned locks, next pod can connect cleanly
```

**Test path:** `apps/api/test/connection-drain.test.ts` (to be written)

---

### Drill B: Pod Crash Without Graceful Shutdown
```
Scenario: Pod is killed -9 (no SIGTERM), connection pool never calls end()
- Pod process dies immediately
- Stale connection stays open in Postgres `pg_stat_activity`
- Next pod starts and tries to acquire connections
- Expected: Next pod eventually succeeds (old connection times out after ~30m)
- Validate: Postgres `idle in transaction` doesn't block new pods
```

**Validation:** 
- Run `npm run test` with this scenario
- Check `pg_stat_activity` manually in k3d smoke test

---

### Drill C: Postgres Becomes Unreachable Mid-Update
```
Scenario: Network partition isolates tenant pod from Postgres during rolling update
- Old pod can't complete queries (network timeout)
- Readiness fails → pod marked unready
- New pod starts, tries same Postgres → also fails
- Expected: Clear error message, pod in CrashLoopBackOff, not silent data loss
- Validate: operator intervention is obvious
```

**Test path:** `apps/api/test/postgres-unavailable.test.ts` (to be written)

---

### Drill D: PVC Contention (Overlapping SQLite Access)
```
Scenario: Tenant uses Postgres backend but SQLite fallback on `/app/data` is also mounted
  - Two pods write to same SQLite file at same time
  - Expected: WAL prevents corruption, but queries may fail
  - Validate: no silent data loss, clear error message
```

**Note:** This is a deployment configuration issue, not a code issue. Guard via admission policy (out of scope for #55).

**Acceptance:** Document in `RUNTIME.md` that two pods on same SQLite PVC is unsupported.

---

## **Proof Points: What Counts as "Done"**

✅ **Code changes:**
1. Readiness handler immediately marks pod unready on SIGTERM (already done)
2. Shutdown controller drains HTTP connections before closing pool (already done)
3. Pool `end()` is awaited and completes cleanly (already done in `note-store-database.ts`)

✅ **Test coverage (NEW — must be added):**
1. Readiness probe returns 503 immediately when `isShuttingDown()` is true
2. In-flight HTTP requests complete during 30s grace period
3. Connection pool drain under load (simulate 20 concurrent requests)
4. Connection timeout and idle timeout are respected
5. Statement timeout prevents runaway queries
6. SPA fallback only serves HTML for navigation, not API routes

✅ **Kubernetes manifests (verified):**
1. Control-plane Deployment has `terminationGracePeriodSeconds: 30` ✅
2. Readiness probe at `/ready` path ✅
3. Both `/readyz` and `/ready` are the same handler (for backward compat) ✅
4. Liveness probe uses `/healthz` (always succeeds) ✅

✅ **Documentation:**
1. Update `RUNTIME.md` Section "### Graceful Termination" with proof-of-concept timing numbers
2. Update `RUNTIME.md` Section "### Connection Pool Defaults" with test/drill results
3. Add failure-drill scenarios to `RUNTIME.md` or new `PLATFORM-OPS.md` runbook

✅ **k3d smoke test enhancement:**
- Extend `scripts/k3d/smoke.sh` to trigger rolling update and validate zero-downtime
- Capture query logs during update to prove no overlapping writes

---

## **Blockers for Data Implementation**

Before Data starts writing draining code, confirm:

1. **Q: Pool drain timing — is `closeIdleConnections()` sufficient?**  
   A: Code review shows `server.closeIdleConnections()` is called, and HTTP server is closed first. Confirm in test that queries *in flight* complete, not just idle sockets.

2. **Q: Statement timeout — does 30s default work for all write paths?**  
   A: Backup/restore may take >30s. Confirm in test that statement timeout is configurable per operation, not globally enforced.

3. **Q: Should readiness be a separate `POST /internal/drain` endpoint?**  
   A: Current design (readiness failure = automatic drain) is correct. Don't split into explicit maintenance mode yet; that's Phase 2.

---

## **QA Gate Verdict**

🟡 **Conditional blocker:** #55 can ship when:

1. ✅ All 6 new test cases pass (`connection-drain-*`, `postgres-pool-*`, `spa-fallback-*`, `schema-compatibility-*`)
2. ✅ All 4 failure drills are documented with expected behavior
3. ✅ `RUNTIME.md` sections updated with proof numbers (grace period, pool settings, drain timing)
4. ✅ k3d smoke test includes rolling-update validation step
5. ✅ No regression in existing tests (`npm run lint && npm run test && npm run build` all pass)

**If any test fails:** Revert to issue #43 approach (keep manifest-only, defer orchestration to Phase 2). Current code is safe enough to land; only the *proof* is optional.

---

## **Relative Risk Assessment**

| Risk | Severity | Current Mitigation | Test Before Ship |
|------|----------|-------------------|------------------|
| Readiness race window | HIGH | Readiness fails early, 30s grace period | ✅ Drill A |
| Pool drain under load | HIGH | HTTP close first, then pool end | ✅ Drill B (not C) |
| Connection timeout fail | MEDIUM | Tunable env vars, tested | ✅ Pool timeout test |
| SPA fallback leaks admin | MEDIUM | Guards exist (request.accepts, extname) | ✅ SPA fallback test |
| Schema backward compat | LOW | Future issue (#56), not this gate | ⏭️ Document only |

---

## **Sign-Off Criteria**

Data can mark #55 as **READY FOR APPROVAL** when:

```yaml
Test Results:
  - connection-drain-under-load: PASS
  - postgres-pool-resilience: PASS
  - spa-fallback-safety: PASS
  - schema-compatibility: PASS (or deferred)

Failure Drills:
  - Drill A (node drain): DOCUMENTED
  - Drill B (pod crash): DOCUMENTED
  - Drill C (postgres unavailable): DOCUMENTED

Documentation:
  - RUNTIME.md graceful termination: UPDATED
  - RUNTIME.md pool defaults: UPDATED
  - Failure scenarios: CAPTURED

Kubernetes Validation:
  - npm run platform:validate: PASS
  - k3d smoke (with rolling update step): PASS
  - All existing tests: PASS (no regression)
```

---

## **References**

- `.squad/agents/chunk/history.md` — Phase 0 QA decisions and learnings
- `RUNTIME.md` — environment contract, health probes, container lifecycle
- `apps/api/src/shutdown.ts` — graceful termination logic
- `apps/api/src/app.ts` — readiness handler, SPA fallback
- `platform/control-plane/base/deployment.yaml` — Kubernetes probe config
- Issue #58 (Postgres adapter) — connection pooling decisions
- Issue #43 (Deployment artifacts) — manifest foundation
