---
name: "tenant-postgres-least-privilege"
description: "Introduce per-tenant Postgres runtime credentials without forcing silent credential rotation for already-live tenants."
domain: "backend"
confidence: "high"
source: "earned"
---

## Context

Use this when a control plane provisions tenant-scoped Postgres databases and you need to move new tenants onto least-privilege runtime users while keeping live-tenant migration semantics out of the same slice.

## Pattern

1. Treat the runtime Postgres URL as a connection template, not a shared credential. For new tenants, generate a deterministic role name plus a randomized password, then build the tenant `DATABASE_URL` from that role/password and the template host/SSL settings.
2. Bootstrap the tenant schema from the control plane before the app pod starts. Grant the runtime role only the DML and schema-usage privileges the app actually needs.
3. In the app startup path, detect when a Postgres runtime user lacks schema-creation rights and verify the expected tables instead of trying to run DDL anyway.
4. Preserve any existing tenant runtime secret during ordinary reprovisioning so upgrades do not silently rotate credentials. If the tenant is already provisioned but the runtime secret is missing, fail loudly and require an explicit operator migration/reset.
5. On deprovision, terminate tenant sessions, drop the tenant database, and drop the deterministic runtime role.

## Examples

- `apps/control-plane/src/provisioning.ts`
- `apps/control-plane/src/tenant-database-bootstrap.ts`
- `apps/api/src/note-store-bootstrap.ts`
- `apps/control-plane/test/provisioning.test.ts`
- `apps/api/test/note-store-bootstrap.test.ts`

## Anti-Patterns

- Reusing one shared runtime Postgres user across multiple tenants.
- Letting the tenant app create tables/indexes at startup when the goal is least privilege.
- Silently rotating credentials for already-live tenants during a routine image rollout.
