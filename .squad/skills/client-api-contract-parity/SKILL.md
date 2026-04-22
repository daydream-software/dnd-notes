---
name: "client-api-contract-parity"
description: "Keep frontend request types aligned with backend contracts without silently changing live call-site behavior"
domain: "testing, api-design, typescript"
confidence: "high"
source: "earned through PR #78 operator-portal contract-alignment review"
tools:
  - name: "view"
    description: "Inspect backend validation and frontend request typing side by side"
    when: "A reviewer spots a client/server payload mismatch"
  - name: "rg"
    description: "Find every request mock and call site that models the drifting field"
    when: "Optionality or nullability changes need regression coverage"
---

## Context
Use this when a frontend helper or request type drifts away from the real backend contract. The dangerous version is usually "client is stricter than server" because the UI still works on the happy path, but helper reuse, tests, and future callers all inherit the wrong shape.

## Patterns
1. Treat the backend validation schema or route contract as the source of truth for request optionality.
2. When widening a frontend request type, keep existing live behavior explicit at current call sites by typing the request object directly instead of relying on inference.
3. Update fetch mocks and fixture types to match the widened request shape, then coalesce omitted optional request fields into the persisted response shape if the backend stores `null`.
4. Re-run the focused lint/test/build lane that exercises the affected workspace so the type-only fix proves it did not disturb runtime behavior.

## Examples
- `apps/control-plane/src/app.ts` marks `initialAdminEmail` optional for `POST /internal/tenants`, so `apps/operator-portal/src/types.ts` should not require it.
- `apps/operator-portal/src/ProvisionTenantPanel.tsx` can keep sending the reviewed email field today by building a typed `CreateTenantRequest` object explicitly.
- `apps/operator-portal/src/OperatorPortal.actions.test.tsx` should accept `initialAdminEmail?: string` in create-request mocks and normalize missing values back to `null` on mocked tenant responses.

## Anti-Patterns
- Letting a frontend request interface become stricter than the backend contract because the current UI happens to fill every field.
- "Fixing" the type mismatch by changing runtime payload construction implicitly, without checking whether behavior actually changed.
- Updating production types but leaving test mocks on the old shape, which hides future omissions until runtime.
