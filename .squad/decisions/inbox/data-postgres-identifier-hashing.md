---
date: 2026-04-21
author: Data
type: Backend Safety
context: PR #72 follow-up review fixes
---

# Hash-suffix truncated Postgres identifiers

## Decision

When tenant-specific Postgres database or role identifiers exceed PostgreSQL's 63-character limit:

1. Do not rely on plain string slicing.
2. Keep a readable prefix, then append a short deterministic hash suffix.
3. Apply the same rule to both database names and runtime role names.
4. Never include raw `DATABASE_URL` input values in malformed-secret errors.

## Rationale

Plain truncation can collapse two long-but-distinct tenant subdomains onto the same database or role name, which is a correctness and isolation failure. Error messages that reflect malformed connection strings can also leak tenant credentials into logs or API responses. The hash-suffix pattern keeps identifiers stable and unique while the redacted error pattern preserves actionable failures without exposing secrets.

## Applies To

Control-plane provisioning and any future code that derives tenant-scoped PostgreSQL identifiers or reports malformed connection secrets.
