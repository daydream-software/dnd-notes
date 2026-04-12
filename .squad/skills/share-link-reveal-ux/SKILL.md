---
name: "share-link-reveal-ux"
description: "Implement metadata-only share-link lists with intentional per-card reveal and copy flows"
domain: "frontend"
confidence: "high"
source: "earned"
tools:
  - name: "github-mcp-server-*"
    description: "Review related API and squad context when coordinating frontend and backend reveal behavior"
    when: "The reveal flow depends on backend endpoint shape or team decisions"
---

## Context
Use this when a UI needs to keep reusable share links available without displaying every live URL by default. It fits owner/admin settings screens where the list should stay lightweight, but users still need a deliberate way to reveal and copy a specific link later.

## Patterns
- Keep the normal list response metadata-only; fetch the sensitive `{ token, url }` payload only for the specific card the owner reveals.
- Store reveal state locally per card (`revealed`, `isVisible`, inline error) so the URL stays close to the UI that requested it.
- After fetching the URL, render it in a dedicated block that starts blurred/hidden and pair it with explicit `Show/Hide` and `Copy` actions.
- Surface legacy or unavailable reveal failures inline on the affected card and tell the owner to recreate the link.
- Reset reveal state when leaving the settings surface so URLs do not stay visible across unrelated workflows.

## Examples
- `apps/web/src/App.tsx` — per-card reveal, blur/show, copy, revoke, and inline warning handling.
- `apps/web/src/api.ts` — targeted reveal API helper for one share link.
- `apps/web/src/App.test.tsx` — coverage for successful reveal/copy and legacy regeneration messaging.

## Anti-Patterns
- Returning every active share URL in the list payload.
- Keeping revealed URLs in long-lived global state when they are only used in one settings surface.
- Showing legacy reveal failures only as a generic page error with no recreate guidance.
- Making owners create a brand-new link every time they simply need to copy an existing reusable one.
