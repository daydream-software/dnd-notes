# Session: Campaign Share-Link Re-reveal

**Date:** 2026-04-12T14:38:40Z  
**Agents:** Mikey, Data, Stef, Chunk, Scribe  
**Outcome:** COMPLETE

## What Happened

The user asked for owner re-reveal of campaign share links using the same reusable link instead of per-person links. Data implemented backend support by storing a nullable plaintext token for new share links alongside the existing hash, keeping list responses metadata-only, and exposing owner reveal through `GET /api/campaigns/:campaignId/share-links/:shareLinkId` returning `{ token, url }`. Stef implemented the owner UI flow with per-card reveal, blurred-until-shown URL display, copy-again support, and an inline legacy-link warning. Chunk reviewed the combined worktree and approved it.

## Decisions Made

- Consolidated the share-link user directives, architecture notes, implementation details, and QA approval into one canonical decision in `.squad/decisions.md`
- Documented the legacy-link limitation: hash-only links created before plaintext storage cannot be re-revealed and must be revoked/recreated if owners need a revealable URL
- Propagated the merged decision to affected agent history files

## Key Outcomes

- Campaign share links remain single reusable links rather than per-person links
- Owner reveal stays on-demand and metadata-only by default in listings
- Repo validation passed in the current worktree: `npm run lint`, `npm run test`, `npm run build`
