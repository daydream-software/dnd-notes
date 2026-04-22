# Brand — Platform Dev

## Core Context

Brand is the Platform Dev responsible for infrastructure, Kubernetes orchestration, deployment artifacts, and platform-layer integrations.

**Historical Milestones (2026-04-11 to 2026-04-20):**
- Executed Issue #28 handoff and branch cleanup after PR #37 merged (2026-04-12 to 2026-04-14)
- Conducted origin/deployment config audit; recommended same-origin reverse proxy for production (2026-04-16)
- Implemented GH_TOKEN passthrough in copilot_yolo.sh (2026-04-17)
- Co-authored Issue #42 platform direction: managed K8s, provider-managed control plane, scale-to-zero with PVC retention, shared ingress/cert-manager (2026-04-18)
- Led backup/restore strategy for Phase 1: two-layer approach (managed PITR + daily per-tenant pg_dump), locked with Data co-authorship (2026-04-18)
- Identified 13 blind spots for Phase 0–3 across single-writer enforcement, PVC lifecycle, ingress/DNS/TLS, observability, disaster recovery (2026-04-18)
- Consolidated Issue #42 Phase 0–1 decisions; prepared execution readiness analysis (2026-04-19)
- Published Issue #43 QA brief identifying 5 critical deployment-artifact checkers (2026-04-20)
- Diagnosed and fixed npm test infrastructure (missing root npm install) (2026-04-20)
- Produced Dockerfile multi-stage build, RUNTIME.md environment contract, platform K8s manifests (postgres.yaml, k3d bootstrap) (Phase 0 artifacts)

**Key Pattern:** Infrastructure-first approach — lock platform topology and deployment contracts before application code churn.

## Recent Updates (Last 5)

- **Phase 2 Platform Readiness Assessment (2026-04-21):** Conducted full audit of #56 (Keycloak OIDC) and #69 (per-tenant Postgres roles) platform prerequisites. Identified 8 critical areas: Keycloak bootstrap (partial, needs control-plane integration), database secret wiring (CRITICAL GAP: all tenants share one runtime URL, must split to per-tenant role + secret), local dev experience (k3d works, docs missing), CI coverage (smoke test gaps for auth/privileges), K8s manifests (RBAC ready, network policy not documented), secrets strategy (defer Sealed Secrets to Phase 2+), rollout dependencies (#69 independent of #56 after foundational work), and documentation gaps. Produced 8-item readiness list with 3-4 PR decomposition for #69 work.

- **Issue #76 Keycloak Runtime Auth Platform Lane (2026-04-22):** Owned platform/config side of runtime Keycloak auth integration. Updated k3d Keycloak realm to seed tenant-app and control-plane service-account clients with test users (owner@example.com, site-admin@example.com). Wired Keycloak environment variables across control-plane overlays (k3d and hosted-reference) with AUTH_MODE switch (local|keycloak) and per-environment ConfigMap/Secret placeholders. Updated RUNTIME.md with Keycloak Runtime Authentication section (env vars, auth flows, modes). Created comprehensive docs/KEYCLOAK_RUNTIME_AUTH.md guide covering architecture, configuration, local testing, hosted setup, troubleshooting. Updated platform/k3d/README.md with seeded client credentials and k3d test flow validation. Updated platform/control-plane/README.md with admin auth modes (static vs Keycloak service-account) and k3d/hosted setup instructions. Preserved backward compat: AUTH_MODE=local remains default, guest/share-link flows anonymous. All platform manifests validated (platform:validate passed). Committed as commit da15a38 on squad/76 branch.

## Learnings

- **Config Surfaces:** Web: `VITE_API_BASE_URL` (Vite env, defaults to http://localhost:3001). API: `PORT` (dotenv, default 3001). Shared routes: per-link `frameAncestors` policy. CORS: blanket allow (no options).

- **Same-Origin Recommendation:** Eliminates CORS config, simplifies frame-ancestors, improves deployment friction. Recommend strongly for production.

- **Production Deployment Slice:** (1) Document VITE_API_BASE_URL as build-time requirement. (2) nginx.conf routing web + api under single origin. (3) docker-compose.prod.yml with /api/* reverse-proxy. (4) Production deployment guide with env checklist.

- **GH_TOKEN Forwarding:** Forward only when set on host; preserves SSH agent socket forwarding. Developer convenience without breaking existing flows.

- **Kubernetes Platform Shape:** Managed single-cluster K8s with provider-managed control plane. Thin app-level control plane using Kubernetes API (no custom operator). Tenant workloads scale to zero while keeping PVCs. Shared ingress/cert-manager in first real hosted slice. Provider selection prioritizes storage, ingress, automation, low-friction ops.

- **Backup/Restore Strategy (Phase 1):** Two-layer approach: managed Postgres PITR (~5 min RPO for fleet DR) + daily per-tenant pg_dump (24h RPO for single-tenant restore). CronJob iterates tenant list, pg_dump per tenant per day to blob storage. Blob lifecycle auto-expires backups >7 days. Health monitoring: /internal/status includes last_backup_age; alert if >12h stale. Control-plane owns backup catalog + restore log schema; tenant lifecycle includes `restoring` state.

- **Phase 0–1 Critical Gaps:** Single-writer enforcement on K8s; PVC lifecycle during scale-to-zero; ingress/DNS/TLS routing; observability baseline; backup/restore at scale. Control-plane DB persistence; tenant realm isolation; rollout discipline; cost model; disaster recovery; compliance.

- **Phase 2 Platform Requirements:** (1) Keycloak bootstrap present in k3d (scripts/k3d/bootstrap.sh, platform/k3d/keycloak.yaml) but lacks control-plane ↔ Keycloak token validation + realm setup logic. (2) Per-tenant Postgres role strategy critical for #69: currently all tenants share TENANT_DATABASE_RUNTIME_URL; Phase 2b must split to per-tenant role (CREATE ROLE tenant_<id>_<subdomain> WITH PASSWORD, grant CONNECT + USAGE only), update buildTenantInfrastructureBundle to pass per-tenant secret material, remove shared secret reference from tenant Deployment. (3) Control-plane RBAC already includes create/patch/delete on Secrets (clusterrole.yaml lines 15–16); no networking gaps. (4) k3d-smoke validates provisioning + /ready but misses: Keycloak realm/client presence, per-tenant role privilege constraints, environment isolation. (5) CI coverage: lint/test/build complete; add per-tenant role creation + deprovisioning tests to control-plane suite. (6) Secrets strategy: keep K8s Secrets for Phase 2 start (lowest friction); defer Sealed Secrets/Vault to Phase 2+. (7) Rollout dependencies: #69 (per-tenant roles) does NOT depend on #56 (Keycloak); can land in parallel after Phase 2a Keycloak foundational work. (8) Docs: add LOCAL_DEV_KEYCLOAK.md, append "Phase 2 Secrets Management" section to RUNTIME.md, update apps/control-plane/README.md with per-tenant role provisioning design.

- **Issue #43 QA Checkers (5 critical):** (1) Manifest/runtime mismatch — full K8s manifests for tenant provisioning missing. (2) Workflow drift — k3d-smoke validates only readiness, not CRUD. (3) Postgres env wiring — DATABASE_URL not tested end-to-end. (4) SPA fallback safety — no regression tests for missing routes or XHR. (5) Same-origin default enforcement — ALLOWED_ORIGINS doesn't accidentally split origins.

- **npm Test Infrastructure:** Root npm install is prerequisite for workspace test fanning to succeed. CI should explicitly `npm install` at root before running workspace tests.

- **Phase 0 Gate Readiness:** Approves Dockerfile multi-stage, RUNTIME.md env contract, postgres.yaml K8s manifest, platform scripts (k3d bootstrap, smoke validation). No production secrets in manifests. Validation path: lint → test → build → platform:validate → k3d-smoke.

- **Deployment Artifacts Delivered (Phase 0):** Dockerfile (multi-stage: base → deps → build → runtime, non-root appuser, SQLite fallback), RUNTIME.md (env contract, probes, graceful shutdown, same-origin), CI yaml (lint → test → build pipeline), k3d smoke (k3s v1.35.3, tenant image build, provisioning validation), k3d bootstrap scripts, postgres.yaml (5Gi PVC, pg_isready probe, dev-only secrets).

- **False-Green Trap in k3d-smoke:** Validates tenant provisioning + /ready probes but does NOT create/read actual notes. Smoke depth is shallow; future gates should call this out explicitly.

- **Keycloak Runtime Auth Config Strategy (Issue #76):** Adopt sealed-in-manifest approach for k3d Keycloak clients + secrets (checked-in realm JSON with dev-only credentials). Control-plane overlays carry AuthMode enum (local|keycloak) with per-environment ConfigMap/Secret patches. Tenants receive per-pod KEYCLOAK_* env vars injected by control-plane during provisioning (not in base Secret). Backward compat: AUTH_MODE=local continues as default (no breaking changes); old session tokens work until re-login. Guest/share-link flows bypass auth entirely (local+anonymous regardless of mode). Phase 2 can migrate to Keycloak-backed owner-account auto-creation or explicit seeding; Phase 1 assumes pre-seeded owner_accounts with keycloak_sub values.

- **Keycloak Email-Collision Reconciliation:** If a subject-linked Keycloak owner later presents an email already held by another local account, keep the linked account’s persisted email and derived admin flag instead of clobbering the unique column. Regression should prove the bearer-token flow still reaches tenant campaigns while owner-only admin routes stay denied unless the local row itself is privileged.

---



