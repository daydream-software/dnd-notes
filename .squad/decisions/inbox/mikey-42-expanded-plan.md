# Decision: Issue #42 — Expanded Platform Architecture Plan

**By:** Mikey (Lead)
**Requested by:** FFMikha
**Date:** 2026-04-18
**Status:** PROPOSED — awaiting FFMikha confirmation

## Context

FFMikha's directive on #42 upgrades the issue from a disposable provisioning spike
to the canonical place where the team documents and de-risks the real multi-tenant
platform model. The stated preferences are: Kubernetes, per-instance containers,
subdomain routing with opaque names, rolling updates, a service status page,
freedom to change the auth model now, and a Keycloak deployment with separate
admin and note-takers realms.

This note captures my analysis of the five questions raised and records the
architecture direction for the team.

---

## 1. Issue #42 as the durable platform decision record

**Yes — treat #42 as the real thing, not a throwaway spike.**

The original acceptance criteria ("concrete prototype exists, measured data for
operational unknowns, go/no-go decision point") already describe a
decision-making vehicle, not a disposable prototype. FFMikha is saying: the
decision is "go" — now make the prototype into the plan.

**Action:** Retitle #42 to something like _"Define and de-risk the multi-tenant
container platform model"_ and update the body to reflect the expanded scope.
Keep the original measured-data criteria — they still apply — but add the
architectural targets below as additional acceptance criteria.

---

## 2. Target architecture

### Overview

The platform splits into three concerns:

| Layer | Responsibility | Persistence |
|-------|---------------|-------------|
| **Control plane** | Tenant registry, provisioning API, routing config, status page, admin auth | Its own SQLite database |
| **Data plane** | Per-tenant dnd-notes instances (API + web in one container) | Per-tenant SQLite database |
| **Auth service** | Keycloak — shared across all tenants | Keycloak's own backing store (Postgres or embedded H2 for dev) |

### Control plane

A new service (likely `apps/control-plane` in the monorepo) that:

- Maintains a tenant registry (tenant ID, opaque subdomain slug, status, created/updated timestamps)
- Exposes provisioning API: create, pause, resume, delete tenant instances
- Programmatically manages Kubernetes resources (Deployment + Service + Ingress per tenant)
- Generates opaque subdomain names (e.g., `k7xm2p.notes.example.com` — no campaign names in URLs)
- Aggregates health checks for the status page
- Authenticated via Keycloak admin realm tokens

### Data plane

Each tenant gets:

- A Kubernetes Deployment running the existing dnd-notes container image (API + static web build)
- A PersistentVolumeClaim for the tenant's SQLite database
- A Service + Ingress rule for subdomain routing
- Rolling update strategy (K8s native `RollingUpdate` with `maxUnavailable: 0`)
- Health/readiness probes on the API

The tenant container is the **same image** for every tenant — config (auth
audience, DB path, public URL) is injected via environment variables.

### Subdomain routing

- Wildcard DNS: `*.notes.example.com` → K8s Ingress controller
- Ingress rules map each opaque slug to the correct tenant Service
- The control plane creates/updates Ingress resources on provisioning events
- Opaque slugs: short random alphanumeric strings, no semantic content

### Auth (Keycloak)

See section 5 below for the realm split analysis.

### Status page

- The control plane periodically probes each tenant's health endpoint
- Exposes an aggregated status page (public or admin-gated, TBD)
- Minimal MVP: JSON endpoint listing tenant statuses; fancy UI later

---

## 3. Recommended phasing

The principle is the same as always: prove risk in stages, ship the thinnest
slice that tells you something real, don't build the whole platform before
validating each layer.

### Phase 0 — Containerize and prove the single-instance deploy (Brand)

**Goal:** The existing app runs correctly in a container on K8s with zero-downtime updates.

- Production Dockerfile (multi-stage: build web, copy into API image)
- Health check endpoint on the API (`GET /healthz`)
- Helm chart or K8s manifests for a single Deployment + Service + Ingress
- Prove rolling update with `maxUnavailable: 0`
- This directly unblocks issue #43 (deployment artifacts)

**Risk retired:** "Can we deploy and update this app without downtime?"

### Phase 1 — Control plane skeleton + second tenant (Brand + Data)

**Goal:** Programmatically create a second tenant instance from the control plane.

- `apps/control-plane` service with tenant registry (SQLite)
- Provisioning API: `POST /tenants` creates K8s Deployment + Service + Ingress
- Opaque subdomain generation
- `GET /tenants` lists tenants and their status
- `DELETE /tenants/:id` tears down the K8s resources
- Wildcard DNS + Ingress controller configuration

**Risk retired:** "Can we dynamically provision isolated tenant instances?"

### Phase 2 — Auth integration (Data + Brand)

**Goal:** Tenant instances authenticate users via Keycloak.

- Deploy Keycloak to the cluster
- Configure admin realm (platform operators) and note-takers realm (end users)
- Integrate tenant app with Keycloak OIDC (replace current auth model)
- Per-tenant OIDC client or audience scoping in the note-takers realm
- Control plane authenticated via admin realm

**Risk retired:** "Does the Keycloak realm split work? Can we swap auth without breaking the app?"

### Phase 3 — Operational maturity (Brand)

**Goal:** The platform is operable, not just deployable.

- Backup/restore for tenant SQLite databases (PVC snapshots or file-level backup)
- Status page (aggregated health from control plane probes)
- Tenant lifecycle: pause (scale to 0), resume, delete with data cleanup
- Logging, monitoring, alerting foundations
- WAL mode evaluation per issue #39 (directly relevant to backup safety)

**Risk retired:** "Can we actually operate this without losing data?"

### Relationship to existing issues

- **#43 (deployment artifacts):** Unblocked by Phase 0. Update #43 to track the Dockerfile + K8s manifests.
- **#39 (WAL mode):** Feeds into Phase 3 backup strategy. Keep as-is.
- **#40 (restore safety):** Becomes a tenant-level concern in Phase 3. Keep as-is but note the multi-tenant context.

---

## 4. Monorepo — keep it, for now

**The monorepo is still the right choice.** Reasons:

1. **Shared tooling.** TypeScript config, lint, commit hooks, and CI are already wired for the workspace. Splitting adds coordination overhead the team doesn't need yet.
2. **Control plane is tightly coupled to the tenant app.** It needs to know the container image, the config shape, the health endpoint contract. Colocation makes that easy to keep in sync.
3. **Team is small.** One repo, one CI pipeline, one set of PRs to review. Multi-repo makes sense when you have separate teams with different release cadences.

**When to split:**

- If the control plane gets its own deployment cadence (daily control-plane deploys vs. weekly tenant app deploys)
- If a separate team starts owning the control plane
- If the repo gets so large that CI becomes slow

None of those are true today. Revisit after Phase 1.

The control plane should live at `apps/control-plane` as a new workspace entry,
following the existing `apps/api` and `apps/web` pattern.

---

## 5. Keycloak realm split — admin + note-takers

**The two-realm shape is sound.** Here's why and where to watch out.

### Why it works

| Concern | Admin realm | Note-takers realm |
|---------|------------|-------------------|
| Users | Platform operators (small, trusted) | DMs and players (potentially large) |
| Auth requirements | Strong MFA, IP restrictions | Social login, magic links, lighter MFA |
| Token policies | Short-lived, high-privilege | Longer-lived, scoped to tenant |
| User directory | Internal/corporate | Self-registration or invite-based |

Separating realms means you can enforce different security policies, different
identity providers, and different session lifetimes without conditional logic
in a single realm. Admin actions can never leak into user tokens because the
token issuers are different.

### Cross-tenant identity

This is the key design question: if a player participates in campaigns on
multiple tenant instances, do they have **one identity** or **many**?

**Recommendation: one identity, multiple tenant scopes.**

- All note-takers live in one realm
- Each tenant instance registers as a separate OIDC client (or uses a shared client with audience restriction)
- A user authenticates once and can access any tenant they've been invited to
- Tenant isolation happens at the application layer (membership model), not the auth layer

This preserves the existing `campaign_memberships` model — a user's membership
in a campaign is the authorization boundary, and Keycloak provides the
authentication identity. The claim flow from issue #20 maps cleanly: a guest
claims a membership by linking their Keycloak identity to the existing
membership row.

### Watch out for

- **Keycloak operational weight.** Keycloak is a real service to run — it needs its own database (Postgres recommended for production), its own backup, its own updates. Don't underestimate this.
- **Dev experience.** Local development needs a lightweight Keycloak (docker-compose with realm import). Brand should own making this painless.
- **Migration path.** The current app has no auth. Adding Keycloak means the API needs OIDC token validation middleware. Design this as a middleware layer so it can be swapped if we later move to a different IdP.

---

## Summary of actions

| Action | Owner | Depends on |
|--------|-------|-----------|
| Retitle and update #42 body to reflect expanded scope | Mikey | This decision being accepted |
| Phase 0: Dockerfile + K8s manifests + rolling update proof | Brand | Nothing — start here |
| Update #43 to track Phase 0 artifacts specifically | Mikey | Phase 0 starting |
| Phase 1: Control plane skeleton in `apps/control-plane` | Brand + Data | Phase 0 complete |
| Phase 2: Keycloak deploy + auth integration | Data + Brand | Phase 1 complete |
| Phase 3: Backup, status page, tenant lifecycle | Brand | Phase 2 complete |
| Evaluate monorepo split | Mikey | After Phase 1 |

---

## Decision

Treat issue #42 as the team's canonical platform architecture record.
Target a Kubernetes-based control-plane + data-plane model with per-tenant
containers, opaque subdomain routing, and Keycloak auth (admin realm +
note-takers realm). Sequence work in four phases to retire risk incrementally.
Keep the monorepo. Begin with containerization (Phase 0) immediately.

**This decision is PROPOSED.** FFMikha should confirm or adjust before the team
begins Phase 0 work.
