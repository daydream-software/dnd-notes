---
name: "postgres-tenant-least-privilege"
description: "Move a provisioned Postgres tenant off shared credentials by bootstrapping schema with elevated credentials before issuing a tenant-scoped runtime secret."
domain: "backend"
confidence: "high"
source: "observed"
---

## Context
Use this when a control plane provisions tenant databases and the tenant app still
runs schema bootstrap or migrations automatically at startup. A least-privilege
runtime role is only safe if startup DDL no longer depends on that runtime
credential.

## Patterns
1. Audit who currently executes DDL before changing runtime privileges. If app
   startup still runs `CREATE TABLE`, `CREATE INDEX`, or `ALTER TABLE`, a
   runtime-only role will fail on first boot.
2. Split responsibilities explicitly: admin/bootstrap credentials create the
   database, seed schema/default privileges, and create the tenant runtime role;
   the tenant pod receives only its own runtime `DATABASE_URL`.
3. Grant the runtime role only what the app actually needs at steady state:
   CONNECT on the tenant database, USAGE on the schema, DML on tables, and the
   required sequence privileges/default privileges for future objects.
4. Keep secrets tenant-scoped. A shared runtime URL or shared cluster secret is
   the anti-pattern that breaks least privilege.
5. On deprovision or rotation, terminate active sessions first, then drop the
   old database/role and record an explicit audit event for credential
   lifecycle changes.

## Examples
- `apps/control-plane/src/provisioning.ts`
- `apps/control-plane/src/index.ts`
- `apps/api/src/note-store-bootstrap.ts`
- `platform/control-plane/base/secret.yaml`
- `RUNTIME.md`

## Anti-Patterns
- Injecting the admin Postgres URL into tenant pods.
- Switching to a minimal runtime role before schema bootstrap has moved out of
  tenant startup.
- Reusing one runtime secret across all tenants.
- Treating state-transition logs as a sufficient credential audit trail.
