# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Copilot enabled as autonomous coding agent for squad via auto-assignment to squad:copilot issues.


## Recent Updates

📌 Team update (2026-04-20T13:55:50Z): CI test reporting and coverage orchestration finalized. Root scripts `run-ci-tests.mjs` and `merge-ci-coverage.mjs` consolidate mixed-runner output (Vitest, Node test runner) into shared JUnit/coverage artifacts. GitHub Actions integration via EnricoMi/publish-unit-test-result-action surfaces all test results; coverage visibility enabled with no thresholds yet. Local validation (lint/test/build/test:ci) all green. — Brand
📌 Team update (2026-04-20T13:49:09Z): Root `npm test` no longer depends on npm workspace aggregation for its failure contract. `package.json` now chains explicit workspace entrypoints (`test:web`, `test:api`, `test:control-plane`), and validation proved the healthy root suite exits 0 while an induced workspace failure makes root `npm test` exit 1. Temporary repro artifacts were cleaned up. — Brand
📌 Team update (2026-04-20T01:13:49Z): PR #62 follow-up complete for issue #58 in worktree `squad/58-postgres-adapter`. Snapshot copy now batches multi-row inserts, SQLite restore reapplies 0o600 through an explicit helper, and seed CLI now yields to Postgres when `DATABASE_URL` is configured while keeping SQLite-path behavior otherwise. API lint/test/build all passed.
📌 Team update (2026-04-19T00:25:00Z): PR #59 cleanup pass merged latest `main` into `squad/53-control-plane-skeleton`, cleared stale review drift from tracked squad history, and revalidated the control-plane workspace so the remaining Copilot blockers can collapse to real issue-#53 changes only.
📌 Team update (2026-04-17T23:22:37Z): ISSUE BACKUP/RUNBOOK REHEARSAL PASS — Branch `copilot/document-backup-restore-operations` was revalidated (lint/build/test baseline green) and README runbook now includes an explicit **Restore rehearsal checklist** that ties operators to restore prep, execution, post-restore validation, and evidence capture cadence for safer recurring drills.
📌 Team update (2026-04-16T17:49:00Z): ADMIN RESTORE SLICE COMPLETED — The production backup/restore lane now has its first implementation slice: site admins can upload a raw SQLite snapshot to `POST /api/admin/restore`, the API validates that it looks like a restorable dnd-notes database, creates a rollback snapshot before swapping the live file, and reopens the running store on success. The web site-admin panel now includes a restore action with required confirmation, plus post-restore workspace refresh or forced re-login if the restored snapshot invalidates the current owner session. API and web regression coverage landed with the slice, and the README now documents the restore endpoint plus the session-invalidation caveat.
📌 Team update (2026-04-16T17:26:32Z): COMMIT MESSAGE ENFORCEMENT — The repo now provisions Husky via the root `prepare` script and enforces Conventional Commits with a `commit-msg` hook backed by commitlint. This complements the existing direct-commit directive: once a coherent change set is validated, commit it immediately, and the local hook now rejects non-conforming commit messages before they land.
📌 Team update (2026-04-16T16:21:11Z): RESTART CHECKPOINT — The next implementation slice after `PUBLIC_WEB_URL` is the auth/API hardening slice: explicit API-side origin policy + security headers + regression coverage, while intentionally keeping bearer/localStorage auth transport unchanged. At restart time, `impl-auth-api-hardening` was still in progress, `impl-auth-api-hardening-tests` and `impl-auth-api-hardening-docs` were still pending, and the live working tree already showed edits in `apps/api/.env.example`, `apps/api/src/app.ts`, `apps/api/test/app.test.ts`, plus a new `apps/api/test/security-headers.test.ts`. `scripts/copilot-yolo.sh` was also dirty but not part of this slice.
📌 Team update (2026-04-16T15:18:08Z): ROADMAP URL/ORIGIN HANDOFF — The public URL/origin lane is now complete. Recommendation: treat **same-origin** as the default production model for this repo, add explicit API-side `PUBLIC_WEB_URL` configuration for canonical share-link generation, and stop deriving production share URLs from request origin/host. `VITE_API_BASE_URL` already covers intentional split-origin web→API calls; CORS allowlisting should only be introduced if deployment intentionally uses different web and API origins.
📌 Team update (2026-04-16T15:18:08Z): ROADMAP RESEARCH STATUS — Three roadmap lanes now have concrete handoffs. **Auth hardening:** current owner and guest tokens live in `localStorage`; first production-safe slice should be API-side exposure hardening (explicit CORS policy, security headers, stronger auth/session regression coverage) before any cookie migration. **Backup/restore:** the product currently supports site-admin SQLite snapshot download only; true recovery readiness still needs validated restore plus a minimal operator runbook. **Dynamic provisioning:** isolated per-customer SQLite-backed instances look plausible near-term for modest scale, with the real complexity moving into provisioning/orchestration, backups, upgrades, routing, and support. The public URL / origin-model lane is still in progress.
📌 Team update (2026-04-16T15:11:43Z): PRODUCTION ROADMAP DIRECTION — Product direction now assumes: (1) add explicit public site URL config for production link generation, (2) keep embed support limited to `/share/...` and governed by per-link `frame-ancestors`, (3) treat CORS separately and only tighten it if frontend/API deploy cross-origin, (4) defer concrete deployment artifacts until hosting target is chosen, (5) keep backup/restore in the core production path, and (6) research a dynamic per-customer provisioning model where each customer may receive an isolated SQLite-backed instance. Dynamic provisioning economics and lifecycle are now an explicit research track, not a rejected idea.
📌 Team update (2026-04-16T14:27:08Z): DIRECT COMMIT DIRECTIVE — After finishing and validating a coherent set of modifications, stage and commit it immediately instead of leaving completed work uncommitted, unless the user explicitly asked to wait. Keep using signed commits; if signing needs interaction, leave the work staged and hand the user the exact `git commit -S ...` command. Use conventional commit messages.
📌 Team update (2026-04-16T14:23:49Z): PERSISTENT PLANNING DIRECTIVE — For any Copilot task spanning multiple phases, files, or sessions, create/update the session `plan.md` early, but never rely on session chat or CLI-only SQL state as the sole record. Mirror the durable handoff in this file whenever work starts, materially changes, or pauses unfinished so future sessions can recover the active plan without reconstructing it from scratch. Requested by FFMikha after losing prior admin-panel planning context.
📌 Team update (2026-04-12T21:44:58Z): ASSIGNMENT — You are now owner of Issue #27 frontend UI revision. Stef's implementation was rejected by Chunk due to four critical state-management regressions: (1) `noteBrowseMode` dependency causes workspace reload on mode toggle, clobbering editor state, (2) create-note drafts lost when workspace reloads, (3) stale-response race on session switch, (4) missing regression tests. Backend (#27) is approved and ship-safe. Re-approval bar: remove `noteBrowseMode` from bootstrap dependency chain, add cancellation guard to session loading, add tests for mode toggles and create-note reset. Full details in `.squad/decisions.md` — assigned by Chunk (reviewer)
📌 Team update (2026-04-13T00:04:28Z): Issue #27 UI COMPLETED & MERGED. Your revision successfully retired all four rejection criteria: browse-mode state isolated from `loadWorkspace` dependency (synchronous state management), draft preservation tested, stale-response race eliminated by `useMemo` design, comprehensive regression test coverage added (3 web + 3 API tests). PR #36 merged on main (`9d0966b`). **Potential FALLBACK ASSIGNMENT: Issue #33 (Recent Activity UI)** — Primary owner is Stef (frontend); if Stef is unavailable, you're the fallback. Thin slice v1 scope: read-only activity feed UI (notes sorted by `updatedAt`), collaborator filter sidebar, distinguish 'created' vs 'edited' actions with attribution, empty state handling. Backend contract stable (`GET /api/notes/activity`). Regression test plan documented (RT1–RT5 gates). Expected delivery: 2–3 days. Files: `App.tsx` (tab + filter state), `api.ts` (fetchActivity), `types.ts` (activity types), `App.test.tsx` (tests). See `.squad/orchestration-log/2026-04-13T00:04:28Z-issue-33-ui-handoff.md` for full context — decided by FFMikha (product), Chunk (reviewer)
📌 Team update (2026-04-13T07:52:28Z): ASSIGNMENT — Issue #28 Frontend Tag Facets Revision. Stef's implementation pass was rejected by Chunk (tester) due to critical list/detail mismatch blocker: when active tag filter is applied, the left pane list narrows locally via `filteredNotes`, but the editor still pulls from full `notes` array via `selectedNoteId`. This creates a dangerous state where the form can edit a note that no longer appears in the filtered list. Revision scope: reconcile `selectedNoteId`, `isCreating`, `draft` with filtered note list when `handleSelectTagFilter()` runs. Either retarget editor to first matching note OR clear to safe create/empty state. Add regression test proving list/detail sync. Stef is locked out for this cycle. Orchestration logs in `.squad/orchestration-log/`. Full verdict in `.squad/decisions.md` — decided by Chunk (reviewer), rerouted by coordinator
📌 Team update (2026-04-17T23:10:00Z): COPILOT YOLO GH FALLBACK — `scripts/copilot-yolo.sh` still forwards the SSH agent exactly as before, now prefers an already-exported `GH_TOKEN`, and otherwise tries a non-fatal `gh auth token` fallback before launching the sandbox. Dry-run output now reports whether GitHub auth will come from the host env, `gh`, or not be forwarded at all, and `npm run copilot:yolo -- --dry-run -- --help` was validated for host-token, derived-token, and no-token cases.
📌 Team update (2026-04-17T23:15:00Z): COPILOT YOLO GH AUTH ENFORCED — `scripts/copilot-yolo.sh` still preserves SSH agent forwarding and still prefers a host-exported `GH_TOKEN`, but fallback-required launches now hard-stop unless `gh auth token` returns a token. Help/dry-run output now points users to `gh auth login`, and `npm run copilot:yolo -- --dry-run -- --help` was revalidated for host-token, gh-derived-token, missing-gh, and unauthenticated-gh scenarios.
📌 Team update (2026-04-18T02:25:33Z): Epic #42 clarification backlog added to GitHub issue #42. Platform gaps tracked for next discussion: local k3d/k3s dev loop, ingress/DNS/TLS, SQLite backup, single-writer choreography, control-plane/tenant contract, lifecycle state machine, auth migration to OIDC, version-skew policy, CI coverage. — Scribe
📌 Team update (2026-04-18T14:57:36Z): EPIC SYNC DIRECTIVE CODIFIED — User directive: when the team makes decisions on an epic, update the GitHub epic so the visible GitHub source stays synchronized with squad decisions. Standing practice established. Mikey synchronized GitHub issue #42 (body + syncing comment) to reflect locked platform direction (Postgres, ghcr.io, ingress-nginx, cert-manager wildcard DNS-01, K8s Secrets, dropped OKE/ARM). Directive merged to `.squad/decisions.md` and captured in orchestration/session logs. — Scribe

## 2026-04-20 Issue #58 PR #62 backend review pass
- Worktree: `.worktrees/58-postgres-adapter` on `squad/58-postgres-adapter`.
- Scope: external Postgres pool ownership, init cleanup on failure, SQLite async transaction serialization evidence, bounded-memory Postgres snapshot export.
- Status: inspected existing dirty patch; validating whether only small follow-up edits remain before running API validation/commit/push.
Status: verified branch HEAD already contains the #58 PR #62 backend review fixes; apps/api lint/test/build passed in the dedicated worktree; no extra code edits were required after inspection.

## 2026-04-20 Issue #54 kickoff
- Branch: `squad/54-provision-tenant-workloads`
- Scope: first provisioning slice for control-plane Kubernetes orchestration, opaque tenant subdomain persistence, explicit workload/storage lifecycle handling, and tightly coupled tenant-app contract gaps only if they block provisioning.
- Constraints: locked squad decisions make k3d the standard dev environment and require the thin control-plane contract (`/ready`, `/_control/info`, `/_control/maintenance`). Repo baseline (`npm run lint && npm run test:ci && npm run build`) was green before edits.
- Status: planning complete and implementation investigation underway; next step is to wire the control-plane provisioning surface and decide exactly which tenant-app endpoints must land in the same slice.

## 2026-04-20 Issue #54 implementation complete
- Commit: `775ef4c` (`feat(control-plane): add tenant provisioning slice for #54`)
- Delivered: control-plane provisioning/deprovisioning endpoints, live Kubernetes/Postgres provisioning service wiring, opaque tenant subdomain persistence, `/ready` tenant compatibility, control-plane env/docs updates, and focused provisioning + migration regression tests.
- Review notes: internal review caught two real fixes before finish — the subdomain reservation is now atomic at the registry layer, and v1 control-plane registries now migrate safely to the new `subdomain` column/index without bootstrap-time index failures.
- Status: working tree clean on `squad/54-provision-tenant-workloads`; ready for the usual Copilot PR/review flow, with squad-member review still recommended because this slice crosses control-plane orchestration and infrastructure integration.

## 2026-04-20 PR #64 review follow-up
- Scope: address Copilot review feedback on the issue #54 branch without widening into the separate k3d/e2e follow-up tracked in #63.
- Fixed as blocking: tenant provisioning now creates and reports an explicit PVC, `storageReference` points at that PVC, provisioning-only env validation no longer crashes the control plane when provisioning is disabled, namespace deletion waits for termination before reporting deprovisioned, and Service reconciliation preserves server-assigned fields such as `clusterIP` on replace.
- Validation: `npm run lint --workspace apps/control-plane && npm test --workspace apps/control-plane && npm run build --workspace apps/control-plane` plus repo-wide `npm run lint && npm run test:ci && npm run build` passed after the fixes.

## 2026-04-20 PR #64 second review follow-up
- Scope: handle the next Copilot pass, including one visible shutdown blocker and one low-confidence suppressed note about registry index recovery.
- Fixed as blocking: control-plane shutdown now uses the same timed shutdown-controller pattern as the API workspace so stalled `tenantProvisioningService.close()` cannot block process exit indefinitely, and tenant-registry startup now always reasserts the `idx_tenants_subdomain` unique index for existing schema-v2 databases.
- Validation: `npm run lint --workspace apps/control-plane && npm test --workspace apps/control-plane && npm run build --workspace apps/control-plane` plus repo-wide `npm run lint && npm run test:ci && npm run build` passed after the fixes.

## 2026-04-20 PR #64 third review follow-up
- Scope: respond to the latest two Copilot comments on tenant-registry null handling and Kubernetes PVC reconciliation.
- Fixed as blocking: tenant-registry now treats `subdomain` presence with null checks instead of truthiness so malformed empty-string rows no longer fall into the reservation retry loop, and Kubernetes replace preparation now preserves PVC-assigned fields such as `storageClassName`, `volumeMode`, and `volumeName` just like the earlier Service hardening preserved `clusterIP`.
- Validation: `npm run lint --workspace apps/control-plane && npm test --workspace apps/control-plane && npm run build --workspace apps/control-plane` plus repo-wide `npm run lint && npm run test:ci && npm run build` passed after the fixes.

## 2026-04-20 PR #64 lint hardening follow-up
- Scope: add a lint guard so future `||` defaults on nullable values get reviewed as explicit nullish handling instead of silently collapsing valid falsy data.
- Delivered: enabled `@typescript-eslint/prefer-nullish-coalescing` in all three workspace ESLint configs with typed linting, added local `test/tsconfig.json` files for the API and control-plane test suites so typed lint covers tests cleanly, and rewrote current empty-string fallback sites to explicit helpers/ternaries where empty strings are intentionally normalized.
- Validation: repo-wide `npm run lint && npm run test:ci && npm run build` passed after the lint-rule rollout.

## 2026-04-20 PR #64 fourth review follow-up
- Scope: address the latest Copilot review threads about invalid persisted tenant subdomains reaching provisioning and deprovisioning flows.
- Delivered: extracted shared tenant-subdomain validation helpers, taught `TenantRegistry.reserveTenantSubdomain()` to reject invalid persisted values (while still preserving them for inspection), moved provisioning subdomain validation into the failure-handled path so invalid rows mark the tenant failed instead of generating broken resource names, and changed deprovisioning to use explicit null checks plus the same validation so empty-string rows no longer silently skip cleanup.
- Validation: `npm run lint --workspace apps/control-plane && npm test --workspace apps/control-plane && npm run build --workspace apps/control-plane` plus repo-wide `npm run lint && npm run test:ci && npm run build` passed after the fixes.

## 2026-04-20 PR #64 fifth review follow-up
- Scope: handle the next Copilot comments on Kubernetes label safety for tenant IDs and length bounds for tenant subdomains.
- Delivered: bounded tenant subdomains to the strictest derived Kubernetes name budget (the PVC name), added regression coverage for overly long persisted subdomains, and normalized tenant IDs before projecting them into Kubernetes labels/selectors so arbitrary control-plane IDs no longer break Kubernetes apply.
- Validation: `npm run lint --workspace apps/control-plane && npm test --workspace apps/control-plane && npm run build --workspace apps/control-plane` plus repo-wide `npm run lint && npm run test:ci && npm run build` passed after the fixes.

## 2026-04-20 Issue #63 kickoff
- Branch: `squad/63-formalize-k3d-development-test-environment`
- Scope: turn the locked k3d local-platform decision into real bootstrap and smoke artifacts without widening into later control-plane deployment packaging or OIDC implementation.
- Planned shape: add a k3d bootstrap lane for ingress-nginx + platform Postgres + seeded Keycloak, add a live smoke path that provisions a tenant against k3d using the existing local control-plane process and imported tenant image, and document the k3d/k3s boundary explicitly.

## 2026-04-20 Issue #63 implementation complete
- Delivered: added `scripts/k3d/bootstrap.sh`, `scripts/k3d/build-tenant-image.sh`, and `scripts/k3d/smoke.sh`; added committed k3d manifests for the platform namespace, Postgres, and seeded Keycloak; wired root `package.json` entrypoints; and documented the lane in `platform/k3d/README.md` plus the root README.
- Validation: `bash -n scripts/k3d/*.sh`, `npm run k3d:bootstrap -- --help`, `npm run k3d:build-image -- --help`, `npm run k3d:smoke -- --help`, and repo-wide `npm run lint && npm run test:ci && npm run build` passed.
- Constraint in this environment: `docker` is available, but `k3d` and `kubectl` are not installed here, so the live cluster smoke path itself could not be executed during this session. The repo now contains the automated lane needed to run that rehearsal on a workstation with the standard tools installed.

## 2026-04-20 Issue #63 live validation follow-up
- Status: live smoke revalidation now reaches k3d helper startup under the local Docker broker, so the previous `ghcr.io/k3d-io/k3d-proxy:5.8.3` block is cleared.
- Current blocker: the broker still rejects `ghcr.io/k3d-io/k3d-tools:5.8.3` while `k3d` creates its tools node, so the cluster rolls back before bootstrap can continue.

## 2026-04-20 Issue #63 live validation follow-up (broker bind policy)
- Status: live smoke revalidation now gets past the currently required k3d images, including `ghcr.io/k3d-io/k3d-tools:5.8.3`.
- Current blocker: the broker rejects the tools-node bind mount `/var/run/docker.sock:/var/run/docker.sock` as a forbidden host path, so cluster creation still rolls back before bootstrap can continue.

## 2026-04-20 Issue #63 live validation follow-up (host connectivity)
- Status: broker policy is no longer the main blocker. Live revalidation now creates the k3d cluster successfully in this environment.
- Repo fix landed during validation: `scripts/k3d/bootstrap.sh` now rewrites k3d kubeconfig endpoints from `0.0.0.0` to `127.0.0.1` when needed and waits explicitly for the Kubernetes API before applying manifests.
- Current blocker: the host environment still cannot reach Docker-published ports (including the k3d API port and ingress ports) or container bridge IPs, even though the k3d load balancer can reach the in-cluster API server. That prevents host `kubectl` from reaching the cluster and blocks the smoke lane beyond cluster creation.

## 2026-04-20 Issue #63 live validation follow-up (tenant image build)
- Status: the smoke lane progressed into the tenant image build path and exposed a real Dockerfile issue on production installs: root `prepare` still ran under `npm ci --omit=dev`, but Husky was not installed in the image.
- Delivered: root `prepare` now routes through `scripts/prepare.mjs`, which exits cleanly when `.git` or the Husky package is absent; the tenant Dockerfile now copies that script before `npm ci`; and `.dockerignore` now includes only that script from `scripts/` so the Docker build context stays tight.
- Validation: `npm run prepare`, repo-wide `npm run lint && npm run test:ci && npm run build`, raw `docker build`, and `DOCKER_BUILDKIT=0 npm run k3d:build-image` all passed after the fix.

## 2026-04-20 Issue #63 live validation follow-up (tenant Postgres runtime URL)
- Status: the next live smoke failure showed the in-cluster tenant pod trying to connect to `127.0.0.1:55432`. That URL only works for the local control-plane process and must not be injected into the tenant workload.
- Delivered: the control plane now accepts an optional `TENANT_DATABASE_RUNTIME_URL` override and uses it when building tenant `DATABASE_URL` secrets, while still using `TENANT_DATABASE_ADMIN_URL` for create/drop operations. The k3d smoke lane now defaults that runtime URL to `platform-postgres.dnd-notes-platform.svc.cluster.local:5432`, and control-plane docs/examples were updated accordingly.
- Validation: control-plane `lint`, `test`, and `build` passed, `bash -n scripts/k3d/*.sh` passed, and repo-wide `npm run lint && npm run test:ci && npm run build` passed after the fix.

## 2026-04-20 Issue #63 live validation follow-up (Keycloak external URL)
- Status: the next user-side validation showed Keycloak redirects dropping the mapped host port, causing the browser to jump from `http://keycloak.127.0.0.1.nip.io:8080` to the same host without `:8080`.
- Delivered: the committed Keycloak manifest now sets `KC_HOSTNAME` to the correct default local URL, and `scripts/k3d/bootstrap.sh` now reapplies `KC_HOSTNAME` on the deployment using the active `K3D_HTTP_PORT` so non-default local port mappings also generate correct redirects. The k3d README now documents that bootstrap injects the full external URL for this reason.
- Validation: `bash -n scripts/k3d/bootstrap.sh` passed and the final wiring was checked to confirm the manifest default plus bootstrap override both include the full Keycloak URL with port.

## 2026-04-20 Issue #63 live validation success
- Status: the user reran `npm run k3d:smoke` on their workstation and the full lane completed successfully: bootstrap reused the existing cluster, the tenant image built/imported, the tenant deployment rolled out, and the smoke readiness check passed.
- Operational note: this is expected to leave the k3d cluster running. The smoke lane is designed to reuse the shared local cluster and only clean up the smoke tenant by default; cluster teardown remains a separate explicit action (`k3d cluster delete dnd-notes` when desired).

## 2026-04-20 Issue #63 CI smoke workflow
- Delivered: added `.github/workflows/k3d-smoke.yml`, a dedicated GitHub Actions workflow that installs `k3d` and `kubectl`, runs `npm run k3d:smoke`, captures cluster diagnostics as an artifact, and always deletes the CI cluster afterward. The k3d README now documents that the same smoke lane runs in CI.
- Trigger shape: runs on PRs and pushes touching the k3d/platform lane, on nightly schedule, and on manual dispatch.

## 2026-04-20 Issue #63 cloud-agent unblock config
- User-approved repo-local agent config updates are ready to commit with the issue work: `.copilot_here/docker/Dockerfile` now installs `k3d` and `kubectl`, and `.copilot_here/docker-broker.json` allows the k3d helper images plus the host bind/namespace behavior needed to exercise the local smoke lane inside the agent environment.

## 2026-04-20 Issue #63 k3s version standardization
- Delivered: the k3d bootstrap lane now pins the cluster image explicitly instead of inheriting the `k3d` binary default. The current pinned image is `rancher/k3s:v1.35.3-k3s1`, and the CI smoke workflow now aligns its `kubectl` tooling with Kubernetes 1.35 as well.
- Rationale: local workstations were still creating 1.31 clusters because `k3d` 5.8.3 defaults to an older bundled k3s release. The lane now keeps local and CI smoke runs on an explicit supported Kubernetes minor until we intentionally bump it again.

## 2026-04-20 PR #65 CI follow-up
- Investigation result: the failed `k3d Smoke` run the user flagged (`24691692504`) was tied to older head SHA `2f0aa32`, while the newer run on `3b75dcf` already completed successfully.
- Delivered: committed `d6032f4` (`fix(ci): force direct k3d image import for #63`), which changes `scripts/k3d/build-tenant-image.sh` to call `k3d image import --mode direct ...` and documents the new `K3D_IMAGE_IMPORT_MODE` override. This avoids the tarball-based `tools-node` path that logged `/k3d/images/...tar: no such file or directory` in the older failing CI run.
- Status: branch `squad/63-formalize-k3d-development-test-environment` was pushed with `d6032f4`, and a fresh `k3d Smoke` run started on that SHA. If more CI investigation is needed later, start from the current run rather than the obsolete failure.

## 2026-04-20 PR #65 second review follow-up
- Delivered: hardened `scripts/prepare.mjs` so signaled Husky exits no longer report success (`status ?? 1`), taught both k3d scripts to restore the user's prior `kubectl` context on exit, and moved local Keycloak bootstrap admin credentials into a dev-only Secret while annotating the committed Keycloak/Postgres seed credentials as local-only in both manifests and docs.
- Validation: `bash -n scripts/k3d/*.sh` plus repo-wide `npm run lint && npm run test:ci && npm run build` passed after the follow-up.

## 2026-04-20 PR #65 third review follow-up
- Delivered: vendored the ingress-nginx controller manifest into `platform/k3d/ingress-nginx-controller-v1.12.1.yaml` so bootstrap no longer depends on a runtime network fetch, switched `scripts/k3d/bootstrap.sh` to consume that local file via `INGRESS_NGINX_MANIFEST_PATH`, pinned the platform Postgres image to `postgres:17.9-bookworm`, and cleaned up the lingering README grammar nit around the Husky `prepare` hook.

## 2026-04-21 PR #66 deployment-artifacts review follow-up
- Scope: address the seven Copilot review threads on `squad/43-deployment-artifacts` without widening beyond the deployment-artifact workflow, control-plane manifests, and closely coupled docs/tests.
- Delivered: extracted a shared control-plane readiness handler, added SHA-pinned `actions/setup-node` with the repo `.nvmrc` to `.github/workflows/deployment-artifacts.yml`, made the base control-plane Deployment image tagless with overlay-owned tags, added PVC-friendly pod `fsGroup`, replaced committed secret defaults with placeholders plus k3d secret-creation docs, and removed duplicate control-plane README sections.
- Validation: `npm run lint && npm run test:ci && npm run build && npm run platform:validate` passed in the dedicated worktree.
- Next: push the branch update, reply on every Copilot thread, and resolve all review threads on PR `#66`.

## 2026-04-21 PR #66 final review follow-up
- Scope: address the last Copilot comment on `scripts/platform/validate-manifests.sh` without widening beyond the manifest validation helper.
- Delivered: `validate_overlay()` now streams `kubectl kustomize` through `awk` and captures only a `0/1` content flag, so the script still rejects empty renders without buffering whole manifests in memory.
- Validation: `npm run platform:validate` passed in `.worktrees/43-deployment-artifacts`.
- Review gate: FFMikha requires waiting for the post-push Copilot review after every PR push before concluding readiness.
