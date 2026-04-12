---
name: "create-update-validation-split"
description: "Do not reuse defaulted create schemas for update routes when omitted fields must not overwrite stored data"
domain: "api-design, validation, zod"
confidence: "high"
source: "earned through PR #35 review on quick note capture"
tools:
  - name: "view"
    description: "Inspect the validation schema and the POST/PUT handlers that consume it"
    when: "A PR introduces Zod defaults or optional request fields"
---

## Context
A schema that is safe for create requests can become destructive when reused for update requests. Once Zod defaults are applied, omitted fields stop meaning "unchanged" and start meaning "overwrite with this default".

## Patterns
1. Use separate schemas for create and update when create needs defaults but update must preserve stored values.
2. If you keep one schema, apply defaults in the POST handler after validation instead of in the shared schema.
3. Review every route that spreads `validation.data` directly into persistence inputs; defaults propagate farther than they look.
4. Add at least one regression test where a PUT omits the newly defaulted fields so you can prove whether the API preserves or overwrites existing data.

## Examples
- Bad: `body.default('')` added for quick-create, then `PUT /notes/:id` spreads `validation.data` into `updateNote()` and wipes an existing body when `body` is omitted.
- Good: `POST /notes` fills `body ?? ''` and `status ?? 'draft'`, while `PUT /notes/:id` only writes fields the client explicitly sent.

## Anti-Patterns
- Reusing a single "payload" schema for both create and update just because the fields overlap.
- Treating passing tests on the happy create flow as proof that update semantics stayed intact.
