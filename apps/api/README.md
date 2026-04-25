# Tenant API

The customer-facing tenant API service that serves campaigns, notes, and
share-link workflows for a single tenant. Each tenant runs its own pod with a
dedicated Postgres database created and bootstrapped by the
[control-plane](../control-plane/README.md).

## Database Migrations

Schema changes are applied through the migration runner in
`src/migrate.ts`, backed by [umzug](https://github.com/sequelize/umzug) and a
`schema_migrations` ledger table. Migration files live in
`apps/api/migrations/` and are applied:

- Automatically when `createNoteStore()` boots, before the API serves traffic,
  guarded by the advisory-lock pair `(931, 1)` so concurrent pods serialize
  cleanly.
- On demand via `npm run db:migrate` for one-off operational use.

### Adding a migration

1. Create `NNNN_short_name.sql` in `apps/api/migrations/` using the next
   sequential prefix.
2. Prefer idempotent forms: `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`.
3. Migrations are **roll-forward only**: never rename or drop existing
   tables/columns that running code still reads. Use the expand/contract
   pattern across at least two releases.
4. Each migration runs inside its own transaction with the advisory lock held;
   crashes leave the database either fully migrated or fully unchanged.

After migrations run, a verifier in `note-store-bootstrap.ts` confirms that the
expected tables, columns, and unique indexes are in place. The verifier never
issues DDL — if a check fails, the operator is asked to run `npm run db:migrate`.

### Running migrations manually

```bash
DATABASE_URL=postgres://... npm run db:migrate
```

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # tsc compile
npm test         # node --test
npm run lint
```
