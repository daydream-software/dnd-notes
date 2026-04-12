---
name: "client-starter-templates"
description: "Ship optional built-in starter templates in the frontend by reusing existing create flows."
domain: "frontend"
confidence: "high"
source: "earned"
tools:
  - name: "view"
    description: "Inspect the existing note and campaign create flows before threading template state through them."
    when: "You need starter templates without introducing a new backend contract."
---

## Context
Use this when product needs lighter-weight templates, starter packs, or scaffolds but the current API already supports creating the underlying records. This keeps the UX moving without blocking on a larger backend template system before the shape is proven.

## Patterns
- Keep template state local to the create flow where it is used.
- Make blank the default so templates stay optional and easy to ignore.
- Reuse existing create endpoints to seed starter records after the parent object is created.
- Keep template UI out of unrelated management surfaces when scope needs to stay narrow.
- Seed normal editable records, not locked structures, so the starter never becomes rigid.

## Examples
- `apps/web/src/templates.ts` centralizes built-in note templates and campaign starter packs as plain-text scaffolds.
- `apps/web/src/App.tsx` applies note templates only during create-note mode and seeds campaign starter notes only after `createCampaign()` succeeds.
- `apps/web/src/App.test.tsx` covers both template paths with integration tests instead of a separate template-only harness.

## Anti-Patterns
- Adding a template picker to edit flows where it can overwrite existing work unexpectedly.
- Blocking the feature on a new backend template API when existing create endpoints already cover the needed records.
- Making starter templates mandatory or hard to remove after creation.
