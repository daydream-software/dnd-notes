---
name: "same-browser-membership-claim"
description: "Link a guest collaboration membership to a real account without migrating note history."
domain: "api-design"
confidence: "high"
source: "earned"
---

## Context
Use this when a shared-link guest flow already has a browser-held guest token and you need a pragmatic first-release upgrade path into a real account. The goal is to keep prior activity on the same membership actor while adding a recoverable account attachment.

## Patterns
- Require both proofs at claim time: the guest token that already owns the shared session and an authenticated real-account session.
- Claim the existing guest membership by setting `campaign_memberships.user_id`; do not create a replacement actor row or rewrite note attribution.
- Rotate the guest token during claim and return the replacement token to the same browser; the pre-claim guest token must stop authenticating shared routes.
- Keep the guest membership's display name and membership ID stable so historical authorship keeps pointing at the same collaboration identity.
- Make the claim endpoint idempotent for the same account, but return conflicts when another account already claimed the membership or when the account already has a membership in that campaign.
- Put the create/sign-in plus claim UX directly on the shared route so the same browser context can complete the flow end to end.
- Treat authenticated campaign, overview, and note access as membership-based after the link; keep owner-only management surfaces gated separately so a claimed guest can open the main workspace without being promoted to owner.
- Persist the claimed campaign selection in browser storage during the shared-route handoff so reopening the signed-in app lands on the just-linked campaign.

## Examples
- `apps/api/src/app.ts` adds `POST /api/shared/:shareToken/membership/claim` and scopes it to the shared campaign plus the current guest token.
- `apps/api/src/note-store.ts` links the real account by updating `campaign_memberships.user_id` and rotating `guest_token_id` on the existing guest row.
- `apps/api/src/app.ts` and `apps/api/src/note-store.ts` resolve authenticated note access through `campaign_memberships.user_id` instead of filtering to `role = 'owner'`.
- `apps/web/src/SharedCampaignRoute.tsx` lets the guest create or sign in to an account, then immediately claims the membership from the same browser session, stores the replacement guest token, and primes the selected campaign for the signed-in app.
- `apps/api/test/app.test.ts` verifies attribution keeps the same membership ID before and after claim and that the linked account can create notes through authenticated routes.

## Anti-Patterns
- Migrating historical notes to a newly created owner membership just to attach an account.
- Treating account creation alone as enough proof to claim a guest membership without the existing guest token.
- Leaving the pre-claim guest token valid after linking the real account, which keeps an anonymous backdoor alive.
- Rewriting the guest membership display name during claim when the product wants campaign-scoped identity to remain stable.
- Silently creating duplicate memberships for the same account and campaign instead of surfacing a conflict.
- Requiring `role = 'owner'` for every authenticated campaign route after claim, which strands the linked account outside the main app even though the membership is attached correctly.
