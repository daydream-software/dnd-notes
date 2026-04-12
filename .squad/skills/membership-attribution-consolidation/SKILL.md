---
name: "membership-attribution-consolidation"
description: "Safely move note authorship/editorship from one campaign membership to another without rewriting note content or auth state."
domain: "api-design"
confidence: "high"
source: "earned"
---

## Context
Use this when duplicate campaign memberships represent the same person and owners need to clean up historical note attribution without risking note text changes or implicit auth/account merges.

## Patterns
- Make consolidation owner-only and scope both memberships to the same campaign.
- Support a preview step that returns authored/edited note counts plus warnings before anything is rewritten.
- Treat the operation as note-attribution-only: reassign membership foreign keys on notes, but leave membership rows, linked accounts, guest tokens, and note timestamps alone.
- Require an extra confirmation flag when the target membership changes the historical role shown on notes (for example owner -> guest or guest -> owner).
- Return warnings when note attribution display names or roles will change so the caller can explain the impact clearly.

## Examples
- `apps/api/src/app.ts` exposes `POST /api/campaigns/:campaignId/memberships/consolidations` for both preview (`confirm: false`) and apply (`confirm: true`).
- `apps/api/src/note-store.ts` updates `notes.created_by_membership_id` and `notes.last_edited_by_membership_id` in one scoped statement without touching note bodies or `updated_at`.
- `apps/api/test/app.test.ts` verifies guest-to-guest consolidation counts and role-changing owner-to-guest confirmation behavior.

## Anti-Patterns
- Deleting source memberships or moving auth/session state as part of an authorship-cleanup endpoint without an explicit product decision.
- Rewriting note bodies or note timestamps during attribution cleanup.
- Allowing role-changing consolidations to execute without an extra confirmation path.
- Applying consolidation across campaigns or when source and target are the same membership.
