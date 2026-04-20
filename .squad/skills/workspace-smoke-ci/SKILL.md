---
name: "workspace-smoke-ci"
description: "Use root workspace scripts to make monorepo CI reliable, and keep narrow smoke lanes only while the broader suite is genuinely unstable."
domain: "testing"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Verify workspace selectors and smoke commands locally before wiring CI."
    when: "A monorepo workflow exists but may be calling the wrong workspace or an overly broad test target."
---

## Context
Apply this when a monorepo has real tests, but CI either points at the wrong workspace or lacks a durable path through lint, test, and build. Start with the narrowest trustworthy lane when needed, then retire that fallback once the broader suite is healthy again.

## Patterns
- Put durable workspace entrypoints in the repo root `package.json` instead of hard-coding `npm run ... --workspace ...` strings in multiple workflows.
- Use explicit workspace paths like `apps/web` when the repo is configured that way; shorthand names can fail even when package names look obvious.
- For a root full-suite `npm test`, prefer chaining explicit workspace test entrypoints when the failure contract must stay unambiguous across mixed test runners.
- Keep two lanes only when needed: a full suite entrypoint for normal validation and a smaller smoke entrypoint for temporary CI confidence while the broader suite is still unstable.
- Have workflows call the root scripts, not ad hoc commands, so local and CI execution stay aligned.

## Examples
- `package.json`: `test:web` wraps `npm run test --workspace apps/web --`
- `package.json`: `test` wraps `npm run test:web && npm run test:api && npm run test:control-plane`
- `.github/workflows/web-test.yml`: `npm run lint:web`, `npm run test:web`, `npm run build:web`
- `.github/workflows/ci.yml`: `npm run lint`, `npm test`, `npm run build`

## Anti-Patterns
- Using guessed workspace selectors like `--workspace web` in a repo that actually defines `apps/web`
- Relying on root `npm run test --workspaces` aggregation when you need a deterministic non-zero exit as soon as any workspace suite fails
- Making the first CI gate depend on the slowest, broadest integration file when a smaller regression slice would prove the tooling path
- Keeping a focused-only fallback after the full suite is stable again
- Duplicating raw workspace commands in every workflow instead of centralizing them in root scripts
