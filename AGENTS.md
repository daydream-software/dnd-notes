# Repository Guidelines

This repository is a full-stack D&D note-taking application managed as an npm workspace. It uses a Squad-based AI team framework for collaborative development.

## Project Structure & Module Organization

The project is organized into an npm monorepo:

- **`apps/api`** — Express + TypeScript backend with Postgres persistence
- **`apps/web`** — React + Vite + Material UI frontend
- **`apps/control-plane`** — Tenant registry and provisioning service
- **`apps/operator-portal`** — Operator-facing React portal
- **`apps/customer-portal`** — Customer-facing React portal
- **`packages/portal-utils`** — Shared utilities consumed by both portals
- **`packages/postgres-migrations`** — Shared Postgres migration framework
- **`platform/keycloak-jwt`** — Shared Keycloak JWT module; relative imports **must** use `.js` extension

Local dev runs on **k3d** (Kubernetes in Docker) with Postgres.

## Build, Test, and Development Commands

All commands run from the repository root.

**Dev servers:**

```bash
npm run dev                    # api + web concurrently
npm run dev:control-plane
npm run dev:operator-portal
npm run dev:customer-portal
```

**Build & lint:**

```bash
npm run build
npm run lint
```

**Tests per workspace:**

```bash
npm run test:api               # Node.js native test runner
npm run test:web               # Vitest
npm run test:control-plane
npm run test:operator-portal
npm run test:customer-portal
npm run test:keycloak-jwt
npm run test:portal-utils
npm run test:ci                # all workspaces with JUnit + coverage
```

**Coverage thresholds** (enforced by `vitest` in `test:ci`):

- `apps/web` and `apps/customer-portal` fail `test:ci` if coverage drops below
  `lines: 50`, `branches: 40`, `functions: 50`, `statements: 50`.
- Thresholds are intentionally a floor, not a snapshot of current state. They
  should be ratcheted upward periodically (e.g. once per quarter, or after a
  coverage-focused sprint) — never lowered to make a failing PR green.
- Other workspaces use Node's native test runner without coverage gates.

**k3d cluster:**

```bash
npm run k3d:up                 # bootstrap cluster, build images, provision dev tenant
npm run k3d:down
npm run k3d:status
npm run k3d:smoke
npm run k3d:full-stack-smoke
```

## Coding Style & Naming Conventions

- **TypeScript strict mode** (`strict: true`) enforced in all workspaces
- **ESLint** with `typescript-eslint` across all workspaces (`npm run lint`)
- **`platform/keycloak-jwt`**: relative imports must end in `.js` (ESLint-enforced)
- Use `??` over `||` for nullish checks — `prefer-nullish-coalescing` is an error

## Commit & Pull Request Guidelines

**Commit signing is required** — never use `--no-gpg-sign`. If a passphrase prompt is needed, stage the work and provide the user the exact `git commit -S ...` command.

Conventional Commits are enforced locally via Husky + commitlint:

- Include issue reference in every commit: `feat(api): add route #123`
- Use closing language on the final commit: `fixes #123`

**Branch naming:** `{type}/{kebab-case-slug}-{issue-number}` where `{type}` matches the conventional-commit prefix (`feat`, `fix`, `chore`, `test`, `refactor`, `docs`). Examples: `test/web-loginpage-coverage-144`, `fix/clear-stale-tenant-display-name-248`, `chore/drop-deprecated-keycloak-admin-env-235`.

**PR format:**

- `Closes #{issue-number}`
- If the issue has a `squad:{member}` label: `Working as {member} ({role})`
- If flagged 🟡 needs-review: add `⚠️ This task was flagged as "needs review" — please have a squad member review before merging.`

## Agent Instructions (Squad Framework)

Before starting any issue:

1. Read `.squad/team.md` — roster, your capability profile, domain boundaries
2. Read `.squad/routing.md` — work routing rules
3. If the issue has a `squad:{member}` label, read `.squad/agents/{member}/charter.md` and work in their voice

**Capability check** (from `.squad/team.md` Coding Agent section):

- 🟢 Good fit → proceed autonomously
- 🟡 Needs review → proceed, but flag in PR description
- 🔴 Not suitable → comment on the issue explaining why, do NOT start work

**Planning persistence** (multi-phase tasks):

1. Create/update `plan.md` with problem, approach, decisions, status, and next steps
2. Mirror handoff context in `.squad/agents/{member}/history.md` (the member whose hat you're wearing) at start, direction changes, and pauses
3. Write impactful decisions to `.squad/decisions/inbox/{member}-{slug}.md`; the `scribe` agent merges them into `.squad/decisions.md` at session end
