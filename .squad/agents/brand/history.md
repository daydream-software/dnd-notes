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

- Initial squad setup complete.
- GitHub Actions refs in active `.github/workflows/` files and source `.squad/templates/workflows/` templates need SHA pins for orgs that enforce immutable action references; keep the current major visible with inline comments for maintainability.
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

