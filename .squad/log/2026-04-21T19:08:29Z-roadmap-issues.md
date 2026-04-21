# Session Log: Roadmap Issues Audit (2026-04-21T19:08:29Z)

## Agents Involved

- **Mikey (Lead):** Backlog audit, scope clarification, issue triage
- **Data (Backend):** Security audit, per-tenant Postgres design

## What Happened

1. Audit of Phase 0–1 roadmap revealed critical scope gaps:
   - **Operator UX:** No control surface for platform administration (provisioning, deprovisioning, rollouts, backups)
   - **Customer onboarding:** No public landing site or self-serve signup
   - **Tenant security:** All tenants share single Postgres credential — isolation violation

2. Issues created:
   - **#68 (Phase 3):** Operator control portal
   - **#70 (Phase 2–3):** Public landing + self-serve signup
   - **#69 (Phase 1 blocker):** Per-tenant Postgres roles + least-privilege credentials

3. Issue #71 closed as duplicate; merged into #69.

## Decisions

- Operator app and customer portal are separate surfaces with different stakeholders.
- Per-tenant Postgres isolation is Phase 1 critical path for production readiness.
- Three-layer architecture (Ingress → portal, ops, tenant subdomains).

## Roadmap Impact

- Phase 1 adds security hardening (per-tenant creds).
- Phase 3 adds operator dashboard + customer portal (parallel work).
- High-confidence additional gaps: backup/restore UX, tenant quotas, backend hardening tradeoffs.

## Next Steps

- Triage #68, #70 to squad ownership
- Integrate #69 into Phase 1 critical path
- Design K8s per-tenant secret strategy
