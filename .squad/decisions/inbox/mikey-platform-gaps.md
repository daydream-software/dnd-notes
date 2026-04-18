# Platform Gaps & Blind Spots — Architecture Risk Review for #42

**Author:** Mikey (Lead)  
**Date:** 2026-04-18  
**Requested by:** FFMikha  
**Context:** k3d/k3s testing question escalated to architecture risk review of #42 platform direction

---

## Summary

The #42 epic has good phase sequencing and explicit architectural notes. The gaps below are things the plan _doesn't yet cover_ that would bite us during delivery. Grouped by urgency.

---

## 🔴 Must Resolve Early (before or during Phase 0–1)

### 1. No local K8s development loop

The user's instinct is right — k3d/k3s is the obvious local testing target. But nobody has defined the dev loop: how does a developer build the tenant image, push it to a local registry, deploy to a local cluster, and iterate? This needs a `make dev-cluster` or equivalent _before_ Phase 1 starts, or the control-plane and provisioning work (#53, #54) will be developed blind.

**Action:** Brand should spike a k3d-based local dev environment alongside #52 (containerization). One script to stand up cluster + registry + deploy one tenant.

### 2. Ingress, wildcard DNS, and wildcard TLS are untracked

The epic's architectural notes mention "ingress + cert-manager + wildcard DNS" but no issue covers it. Opaque subdomains (`<random>.app.example.com`) require:
- A wildcard DNS record
- A wildcard TLS certificate (cert-manager + Let's Encrypt DNS-01 challenge, or similar)
- An ingress controller configured for dynamic host matching

This is a hard prerequisite for #54 (provisioning with subdomain assignment). It's also non-trivial to replicate locally with k3d (needs Traefik config + nip.io or `*.localhost` workaround).

**Action:** File an issue in Phase 0 or early Phase 1 to nail down the ingress/TLS story. Can't test provisioning without it.

### 3. SQLite backup strategy for PVCs is undefined

The plan says "keep PVCs and scale workloads to zero when idle" and the restore story (#40) exists, but the _backup_ side is missing. How do you get a consistent SQLite snapshot off a PVC?
- Volume snapshots (CSI-level, cloud-dependent)?
- Sidecar or CronJob that copies the file while the pod is up (WAL checkpoint required)?
- Only backup during scale-to-zero windows?

The answer shapes #39 (WAL investigation), #55 (single-writer rollout), and #40 (restore safety). It's upstream of all three.

**Action:** Data should include a backup strategy recommendation as part of the #39 WAL investigation. Don't let backup be an afterthought.

### 4. Control-plane SQLite is a latent SPOF

#53 says the control plane will use SQLite "unless a concrete limit is hit." Fair for Phase 1, but this means the control plane _cannot_ run multiple replicas. If the control plane pod dies, no tenant provisioning or lifecycle operations work until it restarts and re-attaches its PVC.

This is acceptable for the first slice if it's _explicitly_ called out as a known constraint with a documented upgrade path (Postgres, Turso, etc.).

**Action:** #53 acceptance criteria should include "document the single-replica constraint and the trigger for moving off SQLite."

### 5. No CI for container builds or K8s manifests

CI currently runs lint + test + build for the Node.js monorepo. There's no image build step, no manifest validation, and no integration test against a cluster. The platform work will be untested in CI until this is added.

**Action:** Brand should extend CI (or add a parallel workflow) once #52 lands — at minimum, build the image and lint any K8s manifests. k3d-based integration tests can come later.

---

## 🟡 Resolve Before Phase 2

### 6. Keycloak deployment and operational model

#56 covers the OIDC integration, but not _where Keycloak runs_. Self-hosted on the same cluster? Managed service? Keycloak itself needs persistence, HA (or at least restart tolerance), backup, and realm configuration-as-code. This is a significant operational dependency.

On k3d for local dev, Keycloak is another stateful service to stand up — helm chart + realm import. Should be part of the local dev environment script (gap #1).

**Action:** Scope a "Keycloak deployment + local dev" sub-task before #56 implementation begins.

### 7. Cross-origin communication between portal and tenants

Opaque subdomains mean the portal (`portal.app.example.com`) and a tenant (`abc123.app.example.com`) are different origins. This has consequences:
- Cookies don't share across origins (even with `SameSite=None`)
- Keycloak tokens need to work for both the portal and the tenant, or the user re-authenticates per subdomain
- CORS must be configured per-tenant dynamically

The current app uses `cors` middleware with `allowedOrigins` from env. That won't scale to dynamic tenants.

**Action:** Data and Stef should design the auth-flow-across-subdomains contract explicitly in or before #56. This is the kind of thing that breaks late.

### 8. Secret management at scale

Keycloak client secrets, potential tenant DB encryption keys, OIDC signing material. The current app uses `.env` files. That doesn't work for a multi-tenant K8s platform. Need to decide: Kubernetes Secrets? External Secrets Operator? Sealed Secrets? Vault?

**Action:** Brand should pick a direction as part of Phase 1 infrastructure. Doesn't need to be fancy — K8s Secrets with RBAC is fine for the first slice — but it needs to be explicit.

---

## 🟢 Can Wait (Phase 3+)

### 9. Observability stack

No logging, metrics, or tracing strategy exists. The fleet status surface (#57) is Phase 3, but operators will want `kubectl logs` plus basic Prometheus metrics from Phase 0 on. This isn't blocking, but the app should emit structured logs and a `/metrics` endpoint early so the plumbing is in place.

### 10. Per-tenant resource limits and cost controls

Resource quotas, PVC size limits, CPU/memory limits per tenant. Important at scale but not for the first handful of tenants. Document the intent and defer.

### 11. Multi-cluster / cloud provider portability

The plan doesn't pick a managed K8s provider. That's fine — k3s/k3d for dev, any managed K8s for prod. Don't optimize for multi-cloud portability yet.

---

## The k3d/k3s question specifically

k3d is a great fit for this project's local development and integration testing. It supports:
- Local container registries (needed for tenant image iteration)
- Traefik ingress out of the box
- Multiple nodes (for testing node drain / PVC failover)
- Fast cluster creation/teardown

The gap is that nobody has wired it up. The highest-leverage action is a `scripts/dev-cluster.sh` (or similar) that creates a k3d cluster, pushes the tenant image to a local registry, and deploys one tenant instance. That script becomes the foundation for both developer iteration and CI integration tests.

---

## Priority summary

| # | Gap | Urgency | Owner suggestion |
|---|-----|---------|-----------------|
| 1 | Local K8s dev loop (k3d) | 🔴 Phase 0 | Brand |
| 2 | Ingress + wildcard DNS + TLS | 🔴 Phase 0–1 | Brand |
| 3 | SQLite PVC backup strategy | 🔴 Phase 0–1 | Data |
| 4 | Control-plane SPOF acknowledgment | 🔴 Phase 1 | Data |
| 5 | CI for containers/manifests | 🔴 Phase 0–1 | Brand |
| 6 | Keycloak deployment model | 🟡 Pre-Phase 2 | Brand + Data |
| 7 | Cross-origin auth flow | 🟡 Pre-Phase 2 | Data + Stef |
| 8 | Secret management | 🟡 Phase 1 | Brand |
| 9 | Observability | 🟢 Phase 3 | Brand |
| 10 | Resource limits | 🟢 Phase 3+ | Brand |
| 11 | Cloud portability | 🟢 Defer | — |
