# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Brand initialized as Platform Dev for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team update (2026-04-11T19:27:38Z): GitHub Actions in all workflows pinned to commit SHAs; decision merged to team decisions log — Brand

## Learnings

- **Web test entrypoints (2026-04-14):** Keep web CI and local commands rooted in `package.json` with explicit workspace paths (`apps/web`), not shorthand names like `web`; this repo's reliable smoke lane is `npm run test:web:focused` and the full workspace suite remains `npm run test:web`.
- **Worktree Governance (2026-04-13):** Treat `.squad/config.json` as the authoritative worktree path source. When `workTreesFolder` is set, resolve worktrees from repo root; when absent, fall back to sibling-path legacy behavior. This alignment removes ambiguity across governance docs, lifecycle guides, and coordinator templates.
- Treat `.squad/config.json` as the preferred worktree path source of truth: if `workTreesFolder` is set, resolve it from the repo root; if not, document the sibling-path fallback consistently across governance, lifecycle docs, and workflow skills.
- Initial squad setup complete.
- GitHub Actions refs in active `.github/workflows/` files and source `.squad/templates/workflows/` templates need SHA pins for orgs that enforce immutable action references; keep the current major visible with inline comments for maintainability.
- **Squad upgrade workflow audit (2026-04-14):** After `squad upgrade`, treat `.squad/templates/workflows/` as the source of truth for synced squad workflows, then verify `.github/workflows/` only keeps repo-fit automations. For this app, keep `sync-squad-labels`, `squad-triage`, `squad-heartbeat`, `squad-issue-assign`, `squad-label-enforce`, and `web-test`; remove upgrade-added docs/release/preview/insider/test workflows that assume Squad CLI branches, docs, or root `test/*.test.js`.
- Guest account linking now runs through `POST /api/shared/:shareToken/membership/claim`, with the shared-route UI handling register/sign-in plus claim in `apps/web/src/SharedCampaignRoute.tsx`.
- Same-browser guest claims should attach `campaign_memberships.user_id` on the existing guest membership and leave that membership's ID/display name intact so note attribution stays stable across account upgrades.

## 2026-04-13: Issue #28 Handoff Visibility — Repair Complete

**Context:**
Reviewed branch state after rejection reroute to inspect for handoff safety.

**Finding:**
Mikey had already committed the implementation artifact with clear rejection reason (list/detail mismatch blocker) and documented routing. No additional artifact commits needed.

**Learning:**
Rejection-path visibility risk: when a reviewer rejects and the team reroutes before push, the next reviser must dig through logs to find the actual blocker. **Mitigation:** Commit rejected artifacts immediately with clear failure message, push before rerouting. Makes rejection discoverable without additional process overhead.

**Platform action taken:**
Documented handoff integrity check in `.squad/decisions/inbox/brand-issue-28-handoff.md`. Next reviser (@copilot) has public artifact + clear blocker message ready for revision cycle.

## 2026-04-13: Branch Cleanup — PR #37 and Issue #28 Consolidation

**Action:** Consolidated local branches after PR #37 merged to origin/main.

**What I found:**
- Remote main (`e5bb1b6`) contained the squashed PR #37 merge with all tag facets functionality shipped
- Local branches `pr-37-review` and `issue/28-tag-facets-autocomplete` contained full development history plus Scribe consolidation commits (PR #37 approvals from Mikey and Chunk)
- The actual code was already on origin/main; branches diverged due to different squash strategies

**What I did:**
1. Pulled latest origin/main to local main
2. Cherry-picked just the Scribe consolidation commit (`f990862`) from pr-37-review to preserve team decision records
3. Deleted both local branches (`pr-37-review` and `issue/28-tag-facets-autocomplete`)
4. Pushed main to origin to keep in sync
5. Remote branch `issue/28-tag-facets-autocomplete` was already deleted by remote prune

**Rationale:**
- Avoided merging full development history into main (which would have added 13 commits of intermediate work)
- Preserved important team metadata (Mikey lead approval, Chunk QA approval) via single cherry-picked commit
- Clean main history: only shipped functionality + team decisions, no development trail noise
- Branches fully deleted locally and remotely to eliminate confusion

**Key insight for future:** When PR is merged via GitHub squash, local feature branches with full history should not be merged back—cherry-pick only the metadata/decision consolidation commits if needed. This keeps main clean while preserving team records.

## 2026-04-13: Squad Worktrees in Dedicated Folder

**Requestor:** FFMikha  
**Task:** Set up squad worktrees under `.worktrees/` folder instead of sibling folders at repo parent

**Implementation:**
1. Updated `.squad/config.json` with `worktrees: true` and `workTreesFolder: ".worktrees"`
2. Added `.worktrees/` to `.gitignore` to keep runtime state out of version control
3. Created `.squad/docs/worktree-setup.md` with comprehensive guide covering:
   - Configuration explanation
   - Folder structure and organization
   - Usage for squad members and manual operations
   - Rationale for the design

**What it delivers:**
- All issue worktrees now organized under `repo-root/.worktrees/{issue-number}`
- Clean workspace — no sibling `dnd-notes-42` folders
- Project-level configuration — no ephemeral shell-only setup
- Example: Issue #42 worktree at `.worktrees/42/` instead of `../dnd-notes-42`

**How it works:**
- Coordinator parses `.squad/config.json` and reads `workTreesFolder: ".worktrees"`
- When creating worktrees, Coordinator uses this path instead of default sibling behavior
- Git itself has no path restrictions, so arbitrary relative or absolute paths work
- `node_modules` symlink from worktree to main repo still works (Unix: `ln -s ../../node_modules`)

**Limitation & follow-up:**
- The `workTreesFolder` key is a team convention. Full automation depends on Coordinator implementation parsing the config and applying it during `Pre-Spawn: Worktree Setup`
- Current squad.agent.md template describes sibling-folder default behavior
- **Next step if needed:** If Coordinator doesn't yet parse `workTreesFolder`, team should test and confirm behavior, then update squad agent template path calculation logic if required
- Documented in `.squad/decisions/inbox/brand-worktree-setup.md` with exact follow-up steps

---

**2026-04-13T13:26:28Z — Scribe Session:** Task completed. Decision merged to `.squad/decisions.md`. Orchestration and session logs created.

## 2026-04-14: Squad Upgrade Cleanup — Orchestration Dispatch

**Requested by:** FFMikha  
**Type:** Background agent spawn

**Work delegated to Brand:**
- Audit `.github/workflows/` post-squad-upgrade for floating-tag refs and repo topology fit
- Restore SHA pinning on kept workflows (sync-squad-labels, squad-triage, squad-heartbeat, squad-issue-assign, squad-label-enforce, web-test)
- Remove upgrade-added workflows that target different repo structure
- Validate with `npm run lint`, `npm run build`, `npm test`

**Decisions created:**
- `brand-fix-upgrade-pinning.md`: Post-upgrade workflow audit strategy documented
- `brand-web-test-infra.md`: Web CI fixed via root workspace scripts + focused smoke lane

**Scribe actions:**
- Orchestration log written: `.squad/orchestration-log/2026-04-14T15-52-31Z-brand-upgrade-cleanup.md`
- Session log written: `.squad/log/2026-04-14T15-52-31Z-upgrade-cleanup.md`
- Decision inbox merged to `.squad/decisions.md`

📌 Team update (2026-04-14T15:52:31Z): Squad upgrade cleanup delegated to Brand; workflows pinning and repo-fit audit underway — Scribe

## 2026-04-16: Origin/Web URL Configuration Investigation — Handoff Report

**Requested by:** FFMikha  
**Task:** Investigate codebase for PUBLIC WEB URL / origin-model track — env surfaces, deployment assumptions, same-origin preference, and production-safe slice guidance.

### Summary of Findings

**Config Surfaces:**
- Web: `VITE_API_BASE_URL` (Vite env, defaults to http://localhost:3001)
- API: `PORT` (dotenv, defaults to 3001)
- Shared routes: per-link `frameAncestors` policy (stored in db, configured at share-link creation)
- CORS: blanket `app.use(cors())` with no options (allows all origins)

**Deployment Assumptions:**
1. Frontend defaults same-machine, different-port model (not true same-origin)
2. API origin detection: `buildSharedUrl()` reads request.header('origin')
3. No production config surface: no nginx template, no docker-compose, no deployment docs
4. Vite build-time env injection: VITE_API_BASE_URL must be set before `npm run build`

**Same-Origin Recommendation:** YES, strongly. Eliminates CORS config, simplifies frame-ancestors policy, improves deployment friction.

**Smallest Safe Production Slice (priority order):**
1. Document VITE_API_BASE_URL as build-time requirement in README
2. Add nginx.conf template routing web + api under single origin
3. Create docker-compose.prod.yml showing /api/* reverse-proxy pattern
4. Add production deployment guide with env var checklist

### Key Files Referenced

**Config:**
- `apps/web/vite.config.ts:68-70` (VITE_API_BASE_URL reading)
- `apps/web/.env.example` (VITE_API_BASE_URL default)
- `apps/api/.env` (PORT, NOTES_DB_PATH, SITE_ADMIN_EMAILS)
- `apps/api/src/app.ts:502` (cors() blanket enable)
- `apps/api/src/app.ts:485-493` (buildSharedUrl origin extraction)

**Validation:**
- `apps/api/src/validation.ts:133-159` (frameAncestors policy validation)

**Shared Route Model:**
- `apps/web/src/App.tsx` (share token routing)
- `apps/api/src/app.ts:1070-1125` (POST /api/campaigns/:id/share-links endpoint)
- `apps/api/src/app.ts:427-435` (applySharedLinkPolicy CSP header)

**CI/Deployment:**
- `.github/workflows/ci.yml` (no prod config, localhost hardcoded)
- `.copilot_here/docker/Dockerfile` (dev-focused, no API_BASE_URL injection)

### Next Steps

This handoff is ready for whoever picks up production deployment work. All assumptions, config surfaces, and origin decisions are now explicit. The reverse-proxy same-origin model is documented and safe to implement without rearchitecting the app.

---
**2026-04-16T18:45:00Z — Investigation complete. Zero code changes. Handoff decision pending squad action.**
📌 Team update (2026-04-16T15:30:33Z): Origin-model audit completed. Frontend ready for split-origin deployment. Backend: add PUBLIC_WEB_ORIGIN env var to buildSharedUrl(). Platform: same-origin reverse proxy recommended for prod. — decided by Stef, Data, Brand, Mikey
