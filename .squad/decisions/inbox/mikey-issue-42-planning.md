# Issue #42 Planning — Phase 0 Kickoff & Decision Points

**By:** Mikey (Lead)  
**Date:** 2026-04-18  
**Type:** Epic Planning & Sequencing Decision  
**Context:** Resuming #42 planning after architecture spike completion. All three risk analyses (Mikey, Brand, Data) reviewed. FFMikha confirmed this is a real platform, not a throwaway spike.

---

## Status Assessment

The team produced excellent architecture analysis. Three independent risk reviews (Mikey: 11 gaps, Brand: 13 gaps, Data: 12 risks) converge on the same shape. The epic body, child issues, and phasing are structurally sound.

**What's missing is not more analysis — it's execution kickoff.**

All 9 sub-issues are open with zero implementation started. The gap between "architecture decided" and "Phase 0 underway" is the planning debt this decision resolves.

---

## Decision 1: Answer Data's Four Blocking Questions

These decision points from Data's risk analysis must be resolved before implementation fans out.

### 1a. Auth migration strategy → **Dual-mode with AuthAdapter interface**

Support both local auth (email/password) and OIDC simultaneously via an `AuthAdapter` abstraction. OIDC is not mandatory until Phase 3 production cutover. Self-hosted and local dev continue working with local auth throughout Phases 0–2.

**Rationale:** Forces clean interface design without breaking backward compat. Phase 1 can use mock OIDC (dev Keycloak in docker-compose) to validate the adapter. Real Keycloak deployment in Phase 2 becomes operational wiring, not architectural rework.

### 1b. Versioning scheme → **Semver + explicit schema version integer**

Product uses semver. Each tenant SQLite DB carries a `schema_version` integer. Compatibility rule: tenant app version N must read/write schema versions N and N-1. Control plane tracks desired and current version per tenant. Rollback is always to N-1 only.

**Rationale:** Simple, explicit, testable. No magic Git SHA compatibility guessing. Schema version integer already aligns with the existing `createNoteStore()` bootstrap pattern.

### 1c. Backup ownership → **Control plane orchestrates, tenant app executes**

Control plane schedules backups, tracks inventory (last success, next scheduled, retention policy), and initiates restore workflows. Tenant app owns `POST /internal/backup` and `POST /internal/restore` endpoints that execute against its own SQLite file. Control plane never touches tenant data directly.

**Rationale:** Separation of orchestration and execution. Control plane stays out of tenant data path. Tenant app's existing backup/restore code (already shipped) gets promoted behind an internal API rather than rewritten.

### 1d. Keycloak timing → **Phase 2 as planned, mock OIDC in Phase 1**

Phase 1 uses a lightweight dev Keycloak (docker-compose with realm import) to validate the `AuthAdapter` interface and token flow. Phase 2 deploys real Keycloak on the cluster. If mock OIDC works in Phase 1, real deployment is wiring, not architecture.

**Rationale:** De-risks auth migration early without pulling Keycloak operational weight into Phase 0-1. If the AuthAdapter proves unwieldy, the team learns before Keycloak is a committed dependency.

---

## Decision 2: Phase 0 Execution Plan — Start Now

Phase 0 is the immediate next slice. Two parallel tracks, no blockers.

### Track A: Containerize (#52) — Brand

**Goal:** App runs in a container on k3d with persistent SQLite.

**Deliverables:**
1. Multi-stage Dockerfile (Node 22.21.1, x64-first)
2. `scripts/dev-cluster.sh` — create k3d cluster, build image, deploy one tenant, verify health
3. K8s manifests: Deployment (single replica) + Service + PVC + basic Ingress
4. CI step: build container image on PR (no deploy, just prove it builds)
5. Measured data: cold start time, image size, SQLite on PVC behavior

**Acceptance:** `./scripts/dev-cluster.sh` produces a working single-tenant dnd-notes on k3d that survives pod restart with data intact.

### Track B: WAL Investigation (#39) — Data

**Goal:** Measured recommendation on WAL mode for production and multi-tenant scenarios.

**Deliverables:**
1. WAL vs rollback journal comparison under realistic note-edit traffic
2. Concurrent read/write behavior measured (single-writer constraint validated)
3. Backup behavior with WAL (checkpoint timing, snapshot consistency)
4. Recommendation: WAL on/off by default, with constraints documented
5. Pod eviction / crash recovery behavior documented

**Acceptance:** Clear go/no-go on WAL for per-tenant SQLite, with measured data, not assumptions.

### Track C: Deployment Artifacts (#43) — Brand (companion to #52)

Update #43 to explicitly track: Dockerfile, K8s manifests, k3d dev script, and CI container-build step as the deployment artifacts for the Kubernetes target. This issue becomes a tracking companion for #52, not a separate work stream.

---

## Decision 3: Phase 0→1 Overlap — Design Work That Can Start During Phase 0

These design tasks don't need Phase 0 code to start. They should run in parallel so Phase 1 doesn't stall after Phase 0 ships.

| Design task | Owner | Feeds into | Output |
|-------------|-------|-----------|--------|
| Control-plane state machine | Data | #53 | State diagram: `provisioning → bootstrapping → ready → upgrading → maintenance → failed → suspended → deprovisioned` |
| Internal API contract (`/internal/*`) | Data | #53, #54 | `ProvisioningContract` interface with endpoints, auth, idempotency, error cases |
| Ingress/wildcard DNS/TLS spike | Brand | #54 | Proven ingress config on k3d with hostname-based routing and self-signed wildcard |
| `AuthAdapter` interface draft | Data | #56 | Interface definition enabling local-auth and OIDC to be swapped via env config |

---

## Decision 4: Full Epic Sequencing — Concrete Dependency Order

```
Phase 0 (parallel, start immediately)
├── #52 Containerize (Brand)
├── #39 WAL investigation (Data)
└── #43 Deployment artifacts (Brand, companion to #52)

Phase 0→1 overlap (design, parallel with Phase 0)
├── Control-plane state machine (Data → feeds #53)
├── Internal API contract (Data → feeds #53, #54)
├── Ingress/TLS spike (Brand → feeds #54)
├── AuthAdapter interface (Data → feeds #56)
└── CI container build step (Brand → follows #52)

Phase 1 (after Phase 0 proven)
├── #53 Control-plane skeleton (Data + Brand)
│   └── depends on: state machine, internal contract, #52 proven
├── #54 Provision tenant workloads (Brand)
│   └── depends on: #53, #39, ingress spike
└── #55 Single-writer rollout rules (Data)
    └── depends on: #39, #54 started

Phase 2 (after Phase 1 proven)
├── #56 Keycloak OIDC (Data + Brand)
│   └── depends on: #53, AuthAdapter, Keycloak deployment spike
└── #40 Restore safety (Data)
    └── depends on: #55 lifecycle rules

Phase 3 (after Phase 2)
└── #57 Fleet status (Brand)
    └── depends on: operational experience from Phase 1-2
```

---

## Decision 5: What Needs Clarification NOW vs. LATER

### Resolve before Phase 0 coding starts (this session or next):
- ✅ Auth adapter interface shape (decided above: dual-mode)
- ✅ Backup approach direction (decided above: orchestrate/execute split)
- ✅ k3d dev loop ownership (Brand, bundled with #52)
- ✅ Versioning scheme (decided above: semver + schema int)

### Resolve between Phase 0 and Phase 1:
- Control-plane state machine (Data, design task)
- Internal API contract, `/internal/*` endpoints (Data)
- Ingress + wildcard DNS + TLS model (Brand, spike on k3d)
- CI for container builds and manifest validation (Brand)
- Secret management direction (Brand, K8s Secrets + RBAC for Phase 1)

### Defer to Phase 2+:
- Keycloak deployment and HA model
- Cross-origin auth flow between portal and tenant subdomains
- Observability stack beyond kubectl logs
- Resource limits and cost controls per tenant
- DR / multi-region / compliance / audit depth

---

## Impact

- Phase 0 is immediately unblocked for Brand (#52) and Data (#39).
- Four blocking decision points from Data's risk analysis are resolved.
- The epic has concrete dependency ordering, not just phase labels.
- Design work for Phase 1 can overlap with Phase 0 execution.
- Clarification items are triaged by urgency, not dumped in a backlog.

## Next Steps

1. FFMikha reviews and approves this sequencing.
2. Brand picks up #52 + k3d dev loop.
3. Data picks up #39 + control-plane state machine design.
4. Mikey gates Phase 0 completion before Phase 1 assignments.
