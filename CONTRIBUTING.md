# Contributing

## Setup

Follow the quick start in `README.md`. Run `npm install` to install dependencies and provision git hooks via Husky automatically.

## Branch naming

```text
{type}/{kebab-case-slug}-{issue-number}
```

Where `{type}` matches the conventional-commit prefix (`feat`, `fix`, `chore`, `test`, `refactor`, `docs`).

Examples: `feat/k3d-json-state-86`, `fix/clear-stale-tenant-display-name-248`, `chore/drop-deprecated-keycloak-admin-env-235`.

## Commit format

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) and include the issue number.

```text
feat(api): add session export endpoint #42
fix(web): correct note timestamp display #91
chore: update dependency versions #55
```

Commits must be signed. SSH signing is configured in this repo — ensure your Git client is set up with a valid signing key before committing.

## Pull requests

Include `Closes #{issue-number}` in the PR description so the issue closes automatically on merge.

## Pre-commit hook

The repo runs a pre-commit check that blocks patterns that look like hardcoded local paths (e.g. `/home/`) or secret-like strings. If it blocks a legitimate commit, review your diff carefully to confirm nothing sensitive is staged. If the block is a false positive, inspect the hook output and adjust the flagged content.

## Code style

- TypeScript strict mode is required across all workspaces
- Run `npm run lint` before pushing; CI enforces the same lint rules
- No `any` casts without a comment explaining why
