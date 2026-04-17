# Issue #42 Architecture Direction — Multi-Instance SaaS Shape

**Decided by:** Mikey (Lead)  
**Date:** 2026-04-17  
**Status:** RECOMMENDATION — awaiting team alignment  
**Triggered by:** FFMikha's expanded vision for #42 (SSO, customer portal, K8s operator)

---

## Context

Issue #42 asks to prototype dynamic provisioning of isolated SQLite-backed customer instances. FFMikha has since expanded the vision: Keycloak for SSO, a separate admin/public portal for registration and subscription, and possibly a Kubernetes operator with ingress for automated routing.

The current product is a single-tenant Express + SQLite app (one API process, one database file, localStorage-based owner tokens, same-origin deployment). There is no shared identity layer, no multi-instance orchestration, and no customer-facing portal.

---

## 1. Target Architecture (Full Vision)

If dnd-notes grows into multi-instance SaaS with SSO and a customer portal, the system decomposes into five layers:

```
┌─────────────────────────────────────────────────┐
│                  Routing Layer                   │
│  (reverse proxy / ingress)                       │
│  portal.example.com → Portal                     │
│  auth.example.com   → Keycloak                   │
│  {slug}.example.com → Customer Instance           │
└──────────┬───────────┬──────────────┬────────────┘
           │           │              │
     ┌─────▼────┐ ┌────▼─────┐ ┌─────▼──────────┐
     │  Portal  │ │ Keycloak │ │ Instance Pool   │
     │  (new)   │ │  (IdP)   │ │ N × dnd-notes   │
     └──────────┘ └──────────┘ │ each w/ own      │
                               │ SQLite + volume   │
                               └──────────────────┘
           │
     ┌─────▼─────────────┐
     │  Control Plane DB  │
     │  (Postgres or      │
     │   SQLite)           │
     │  tenants, billing,  │
     │  instance state     │
     └────────────────────┘
```

### Components

| Component | Responsibility | Tech |
|-----------|---------------|------|
| **Portal** | Registration, subscription, instance dashboard, admin | New app (Express or Next.js) |
| **Keycloak** | SSO / OIDC provider for all components | Keycloak container |
| **Instance** | Existing dnd-notes app, unmodified except auth adapter | Current Express + SQLite |
| **Routing layer** | Maps subdomain/path → instance, TLS termination | Caddy / Traefik / K8s Ingress |
| **Control Plane** | Provisions/deprovisions instances, tracks lifecycle | New service or part of Portal |
| **Control Plane DB** | Tenant registry, instance state, billing hooks | Postgres (shared) or SQLite |

### Auth flow (target)

1. User registers at Portal → Keycloak account created
2. User requests new instance → Control Plane provisions container + volume + subdomain
3. User accesses `{slug}.example.com` → redirected to Keycloak for OIDC login
4. Instance API validates OIDC token against Keycloak (replaces current localStorage token model)
5. Portal can also show a dashboard of the user's instances, all behind the same SSO session

---

## 2. Thinnest Credible Next Slice for #42

**The prototype should prove instance lifecycle mechanics, not build the platform.**

### Scope IN for #42

- **Provisioning script or minimal API** that can: create an instance (container + SQLite volume), start it, health-check it, stop it, destroy it
- **Docker Compose template** as the runtime: one `docker-compose.yml` per instance, or a shared compose with dynamic services
- **Measured data**: instance cold-start time, SQLite WAL checkpoint under concurrent requests, backup snapshot time
- **Routing stub**: a simple Caddy/Traefik config that maps `localhost:{port}` per instance (no real subdomain DNS yet)
- **Documented control-plane contract**: what operations exist, what state they manage, what the operator needs to know

### Scope OUT for #42

- No Keycloak integration (auth is a separate slice — see §3)
- No portal app (provisioning triggered by script/CLI for the prototype)
- No Kubernetes operator (deployment target is a later decision)
- No billing, subscription, or public landing page
- No production DNS or wildcard TLS

### Deliverable shape

A `provisioning/` directory (or `tools/provisioning/`) at repo root containing:
- A shell script or small Node CLI for create/start/stop/destroy
- A parameterized Docker Compose template for an instance
- A brief README documenting measured results and go/no-go findings

---

## 3. What to Defer and Why

| Deferred item | Why defer | When to revisit |
|--------------|-----------|-----------------|
| **Keycloak / SSO** | Auth migration is a cross-cutting change to the existing app. Proving it before knowing if provisioning even works wastes effort. | After #42 proves lifecycle; then a focused slice replaces localStorage tokens with OIDC in the instance API. |
| **Kubernetes operator** | K8s is an optimization of the deployment target. Docker Compose proves the same isolation model with 10× less infrastructure complexity. | Only if scale projections justify K8s over a simpler Docker host or managed container service. |
| **Full ingress automation** | Wildcard DNS + auto-TLS is infra plumbing. The prototype can use port-mapping or a static reverse proxy config. | After provisioning is proven and a deployment target is chosen. |
| **Portal / landing app** | Building registration + subscription UI before the provisioning contract is stable creates coupling risk. | After #42 lands a stable control-plane API; the portal becomes a frontend to that API. |
| **Billing** | Billing is a business concern, not a technical validation. Premature billing integration constrains the provisioning model. | After product-market fit signals justify it. |

---

## 4. Decision Points to Settle Before Implementation

### Must decide now (before #42 coding starts)

1. **Isolation boundary**: Container per customer, or process per customer on a shared host?
   - *Recommendation:* Container per customer. Strongest isolation guarantee, maps cleanly to volumes and resource limits, and is the unit that K8s or any container orchestrator expects if we scale later.

2. **Prototype scope confirmation**: Does #42 stay as a pure spike (throwaway), or should the provisioning script be production-path code?
   - *Recommendation:* Production-path but thin. Write it well enough to keep, but don't over-engineer. A clean shell script or Node CLI is fine.

### Decide soon (before auth slice)

3. **Auth migration strategy**: Replace localStorage tokens with OIDC, or add OIDC as an alternative auth method alongside the current model?
   - *Recommendation:* Add OIDC as an alternative first (feature flag or env var). This lets existing dev/local workflows keep working while instances in the pool authenticate via Keycloak.

4. **Routing model**: Subdomain per instance (`alice.dndnotes.app`) vs. path-prefix (`dndnotes.app/i/alice`)?
   - *Recommendation:* Subdomain. It gives each instance full origin isolation (cookies, localStorage, service workers stay separate). Path-prefix creates subtle sharing bugs.

### Can wait

5. **Control Plane persistence**: Postgres vs. SQLite for the tenant registry?
6. **Upgrade strategy**: Rolling container replacement vs. in-place migration per instance?
7. **Shared vs. per-instance Keycloak realm**: One realm with user attributes, or separate realms?

---

## Summary

**The shape is right**: multi-instance SaaS with Keycloak SSO and a portal is a credible target architecture for dnd-notes. **But the build order matters.** Issue #42 should prove that we can dynamically spin up, health-check, and tear down isolated dnd-notes instances. Everything else — SSO, portal, K8s, billing — layers on top of that proven foundation. Building the platform before the foundation is validated creates expensive rework if the instance model turns out to have deal-breaking operational costs.

**Proposed build order:**
1. **#42** — Provisioning prototype (container lifecycle + SQLite volume + measurements)
2. **Auth slice** — OIDC adapter in the instance API + Keycloak dev setup
3. **Portal MVP** — Registration + instance dashboard backed by the control-plane API
4. **Routing automation** — Reverse proxy config generation for new instances
5. **Deployment target decision** — Docker host, managed containers, or K8s

Each slice delivers a working increment and validates the next one's assumptions.
