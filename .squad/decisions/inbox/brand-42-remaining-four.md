# Issue #42 — Remaining 4 Clarifications: Platform/Ops Recommendation

**Author:** Brand (Platform Dev)  
**Date:** 2026-04-19  
**Epic:** #42 (Multi-tenant K8s platform)  
**Status:** RECOMMENDATION — Do NOT edit GitHub yet

---

## Scope

The four remaining "Next points to clarify together" from the #42 epic body:

1. Control-plane state machine and tenant lifecycle states
2. Auth migration path from current auth to OIDC / Keycloak
3. Rollout / version-skew policy
4. Local Keycloak operational model for developer iteration

Everything below is written from the platform/ops angle — what operations needs to reason about safely, not what the backend schema looks like.

---

## 1. State Machine — Minimum Shape Ops Needs

### Context

The tenant contract is locked: control plane is the sole orchestrator, tenant app never calls back, coordination runs through K8s API + `/_control/*` endpoints, Postgres backups are direct DB ops. The state machine must tell the control-plane worker **what it can safely do next** and **what it must not touch**.

### Recommended States (Platform-Minimum)

```
provisioning → ready ⇄ maintenance → ready
                 ↓          ↓
              upgrading   restoring → ready
                 ↓          ↓
               ready      failed
                 ↓
              failed
                 ↓
          deprovisioned
```

| State | Ops Meaning | Writes? | Backups? | Rollout? |
|-------|-------------|---------|----------|----------|
| `provisioning` | K8s resources + Postgres DB being created | No (DB may not exist) | No | No |
| `ready` | Normal operation, serving traffic | Yes | Yes | Can start |
| `maintenance` | Drain mode, finishing in-flight requests | Read-only | Yes (preferred pre-action snapshot) | No |
| `upgrading` | Pod being replaced, new image version | No (old pod stopping, new starting) | No | In progress |
| `restoring` | `pg_restore` running against tenant DB | No | Safety snapshot taken before entry | No |
| `failed` | A transition broke; needs operator attention | Depends on failure point | If DB exists | No |
| `deprovisioned` | Tenant archived or deleted, resources released | No | Retention policy only | No |

### What I'd Lock Now

- **These 7 states are sufficient for Phase 1.** Don't add `suspended`, `scaling`, or `bootstrapping` until a real use case demands them. `suspended` is just `maintenance` with no planned exit; `scaling` doesn't apply (one pod per tenant); `bootstrapping` was already deferred from the contract decision.
- **Transitions must be control-plane-initiated, never tenant-initiated.** The tenant just answers `/_control/info` and `/_control/maintenance`.
- **Every transition must be idempotent except restore.** The pre-restore safety snapshot is the escape hatch (already locked in backup/restore decision).
- **`failed` is a sink state with manual recovery.** Control plane logs the failure reason and stops retrying. Operator investigates, then explicitly transitions to `provisioning` (rebuild) or `maintenance` (manual fix) → `ready`.
- **State persists in control-plane DB.** K8s resource status is the observed truth; control-plane DB state is the desired/intended truth. Reconciliation loop compares the two.

### What Should Stay Open

- **Timeout policy per state.** How long can a tenant sit in `provisioning` before it's marked `failed`? This needs real data from Phase 0/1. Placeholder: 5 minutes for provisioning, 10 minutes for upgrading, 30 minutes for restoring.
- **Retry semantics for `failed`.** Auto-retry count, backoff strategy, escalation — defer until we see real failure modes.
- **`deprovisioned` retention.** How long do we keep the control-plane record after resources are released? Compliance question, not ops.

---

## 2. Rollout / Version-Skew Policy

### Context

Locked direction: one monorepo, one release train, one image tag, control plane + tenant app deploy from the same image matrix. Persistence is Postgres (not SQLite). Rolling updates are stateless container restarts with connection pooling and graceful shutdown.

### Recommended Policy (Phase 0–1)

**Same-train, same-version, coordinated upgrade. No N/N-1 commitment.**

| Rule | Detail |
|------|--------|
| **Release unit** | One semver tag. Control plane and tenant app share the same version number. |
| **Rollout order** | Control plane first, then tenants in small batches (5–10% canary, wait, then remaining). |
| **Version skew tolerance** | **N only.** Control plane at version N must manage tenants at version N. No N-1 tenants left running after rollout completes. |
| **Rollout window** | Brief (minutes per tenant, not hours). Acceptable because Postgres restarts are stateless — no PVC handoff, no single-writer drain. |
| **Schema migrations** | Run on app startup (`knex migrate:latest` or equivalent). Migrations must be backwards-compatible within the same version (additive columns, no destructive changes mid-version). |
| **Downgrade** | Not supported. If a version is bad, roll forward with a fix. Pre-rollout safety snapshot (already locked in backup decision) is the escape hatch. |
| **Canary failure** | If canary batch fails health checks within 2 minutes, halt rollout. Operator decides: fix-forward or restore from pre-rollout backup. |

### What I'd Lock Now

- **N-only tolerance.** Don't promise N-1 compatibility. It adds testing cost (CI must run both versions against both schema states), migration complexity (schema must be forward-compatible *and* backward-compatible), and operational confusion (which version is canonical?). At this scale (single-digit tenants), coordinated upgrade is cheap.
- **Control plane upgrades first.** Always. If control-plane schema changes (tenant registry, backup catalog), tenants must talk to the new control plane, not the other way around.
- **Additive-only migrations within a version.** No column drops, no renames, no type changes in the same release that introduces them. Destructive cleanup happens in the *next* release after the old code path is removed.

### What Should Stay Open

- **N/N-1 tolerance for Phase 2+.** When tenant count reaches double digits and rollout takes >30 minutes, brief version skew becomes unavoidable. Design the migration strategy to be forward-compatible (new code reads old schema gracefully) so N/N-1 can be introduced later without rework. But don't commit to testing or supporting it now.
- **Blue-green vs. rolling.** Phase 1 uses simple rolling (one tenant at a time). Blue-green (full parallel fleet) is a Phase 3 optimization if rollout speed matters.
- **Automated canary analysis.** Phase 1 canary is manual (operator watches health checks). Automated canary promotion/rollback is Phase 3.

---

## 3. Local Keycloak Developer Model

### Context

Keycloak is the target IdP (two realms: admin + note-takers). Phase 2 is the integration point. But developers need a local Keycloak before Phase 2 coding starts — you can't write OIDC middleware against air.

### Recommended Model

**Docker Compose sidecar with realm-import JSON. Not Helm, not K8s, not embedded.**

```
infra/keycloak/
├── docker-compose.yml        # Keycloak + Postgres (dev-only)
├── realm-admin.json          # Admin realm export (operators)
├── realm-note-takers.json    # Note-takers realm export (customers)
├── .env.example              # KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD, etc.
└── README.md                 # "docker compose up" + "here's your test users"
```

| Component | Choice | Why |
|-----------|--------|-----|
| **Keycloak image** | `quay.io/keycloak/keycloak:latest` (pin version when stable) | Official, widely documented, ARM64 available |
| **Keycloak DB** | Postgres container in the same Compose file | Keycloak requires persistent storage; H2 is fragile for dev |
| **Realm provisioning** | `--import-realm` flag on container startup | Keycloak natively imports JSON realm files from `/opt/keycloak/data/import/` |
| **Test users** | Seeded in realm JSON (admin user, 2 test note-takers, 1 guest-claimable user) | Repeatable, no manual setup |
| **Network** | `localhost:8080` for Keycloak, tenant apps reach via Docker network or host | Simple; no DNS hacks needed for dev |
| **Persistence** | Named Docker volume for Keycloak Postgres | Survives `docker compose stop`; `docker compose down -v` resets |

### Parity Expectations

**Local Keycloak is NOT production-identical.** Accept these differences:

| Aspect | Local | Production |
|--------|-------|------------|
| TLS | None (HTTP only) | Required (cert-manager) |
| HA | Single instance | 2+ replicas with Infinispan cache |
| DNS | `localhost:8080` | `auth.dnd-notes.app` |
| Realm config | JSON import on start | GitOps-managed realm export (Phase 3) |
| User federation | None | Possibly LDAP/social (Phase 4+) |

**Parity contract:** Local Keycloak must produce valid OIDC tokens with the same claim shape as production (tenant ID, realm, roles, groups). Token validation code in the tenant app must work identically against local and production Keycloak — the only difference is the issuer URL (`localhost:8080` vs. `auth.dnd-notes.app`).

### What I'd Lock Now

- **Docker Compose, not Helm.** Keycloak-on-K8s is a Phase 2 production concern. Local dev should not require k3d just to test OIDC flows.
- **Realm JSON is version-controlled.** Changes to realm config (new roles, new groups, new client scopes) go through PR review. No manual realm editing in the Keycloak admin console.
- **`docker compose up` is the entire setup.** No init scripts, no post-start curl commands, no manual admin console clicks. If the realm JSON can't express it, it's not in local dev.

### What Should Stay Open

- **Keycloak version pin.** Use latest during Phase 1.5 spike; pin to a specific minor before Phase 2 implementation starts.
- **Production Keycloak deployment model.** Helm chart vs. K8s manifests vs. managed Keycloak service — production decision, not local dev decision.
- **Theme customization.** Branding the login page is a UI concern (Stef's domain), not a platform concern.

---

## 4. Auth Migration — Platform Sequencing Impact

### Context

Current app uses email/password + app-issued bearer tokens stored in localStorage. Target is Keycloak OIDC with two realms. The question for platform is: **how does this migration affect the build order and phase gates?**

### Recommended Sequencing

**Auth migration is a Phase 2 concern. It does not block Phase 0 or Phase 1. But platform must prepare the plumbing in Phase 1.**

| Phase | Auth Posture | Platform Action |
|-------|-------------|-----------------|
| **Phase 0** | Current app auth (email/password + bearer tokens) | None. Container runs with existing auth. |
| **Phase 1** | Current app auth, but control-plane admin API is separate | Control-plane admin endpoints use a separate auth mechanism (API key or basic auth). Do NOT couple control-plane admin auth to tenant app auth. |
| **Phase 1.5** (optional) | Local Keycloak spike | Stand up `infra/keycloak/` Docker Compose. Validate realm import, token shape, OIDC discovery. No app integration yet. |
| **Phase 2** | Dual auth: current + Keycloak | Tenant app accepts both old bearer tokens AND Keycloak JWTs. `AuthAdapter` middleware checks token type and validates accordingly. Grace period: 2–4 weeks for existing users to migrate. |
| **Phase 2 exit** | Keycloak-only | Old bearer token validation removed. All login flows redirect to Keycloak. localStorage tokens invalidated. |

### What I'd Lock Now

- **Phase 1 control-plane auth is independent.** Don't wait for Keycloak to build admin endpoints. Use API key or basic auth with a shared secret in K8s Secrets. Swap to Keycloak admin realm token validation in Phase 2.
- **Tenant app auth stays untouched until Phase 2.** No feature flags, no "prepare for OIDC" middleware in Phase 0–1. The app works as-is. OIDC middleware lands in one focused PR during Phase 2.
- **Grace period is mandatory.** No big-bang cutover. Dual auth runs for a defined window. Old tokens expire naturally or are invalidated at the end of the grace period.
- **Guest/share-link flows survive migration.** Share links must work without Keycloak login (anonymous access). Guest-to-user claim (#20) happens post-Keycloak-login, not during share-link access. Platform must not require authenticated sessions for share-link rendering.

### What Should Stay Open

- **Grace period duration.** 2 weeks? 4 weeks? Depends on user base size at Phase 2 start. Product decision, not platform.
- **User account linking UX.** How existing email/password users link to Keycloak accounts — Stef/Mikey territory.
- **Token revocation strategy.** Per-user, per-tenant, or fleet-wide? Depends on Keycloak setup. Design during Phase 2 implementation.
- **Social login / federation.** Phase 4+. Don't design for it now.

---

## Summary: Lock vs. Open

### Lock Now ✅

| Item | Decision |
|------|----------|
| State machine shape | 7 states (provisioning → ready ⇄ maintenance, upgrading, restoring, failed, deprovisioned) |
| State ownership | Control-plane DB = desired/intended; K8s = observed. Reconciliation loop bridges them. |
| Version-skew | N-only for Phase 0–1. No N-1 commitment. |
| Rollout order | Control plane first, then tenants in batches. |
| Migrations | Additive-only within a version. Run on startup. |
| Downgrade | Not supported. Fix-forward + backup is the escape. |
| Local Keycloak model | Docker Compose + realm JSON import. Not Helm, not K8s. |
| Realm JSON | Version-controlled, PR-reviewed. No manual admin console changes. |
| Auth migration timing | Phase 2. Dual auth with grace period. No Phase 0–1 impact. |
| Control-plane admin auth | Independent of tenant auth. API key/basic auth in Phase 1. |
| Share-link survival | Anonymous access preserved across auth migration. |

### Intentionally Open 🟡

| Item | Reason |
|------|--------|
| State timeout policy | Need real provisioning/restore timers from Phase 0–1. |
| Retry/backoff for `failed` state | Need real failure modes before designing. |
| N/N-1 tolerance | Defer to Phase 2+ when rollout duration justifies it. |
| Keycloak version pin | Pin when Phase 2 starts, not before. |
| Production Keycloak deployment | Helm vs. manifests — production concern, not local. |
| Grace period duration | Product decision at Phase 2 start. |
| Token revocation strategy | Depends on Keycloak config. |
| Automated canary analysis | Phase 3 optimization. |

---

## Platform Sequencing Impact

These four decisions do NOT change Phase 0 execution. They refine Phase 1 exit criteria and define Phase 2 entry conditions:

- **Phase 1 exit now requires:** state machine implemented in control-plane DB, rollout choreography tested (control plane first → tenant batches), pre-rollout safety snapshot verified.
- **Phase 2 entry now requires:** local Keycloak running (`docker compose up`), realm JSON producing valid OIDC tokens, dual-auth middleware design reviewed.
- **Phase 0 is unaffected.** Keep building containers and manifests.

---

**Next:** Mikey + Data review. If consensus, Mikey updates #42 epic body and removes these four items from "Next points to clarify together." Scribe merges to `.squad/decisions.md`.
