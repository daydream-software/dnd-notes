---
name: "workspace-smoke-ci"
description: "Use root workspace scripts plus a focused smoke lane to make monorepo CI reliable without overcommitting to slow suites."
domain: "testing"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Verify workspace selectors and smoke commands locally before wiring CI."
    when: "A monorepo workflow exists but may be calling the wrong workspace or an overly broad test target."
---

## Context
Apply this when a monorepo has real tests, but CI either points at the wrong workspace or tries to run a slow suite that is not the right first gate. The goal is to make the path to reliable coverage obvious and reusable.

## Patterns
- Put durable workspace entrypoints in the repo root `package.json` instead of hard-coding `npm run ... --workspace ...` strings in multiple workflows.
- Use explicit workspace paths like `apps/web` when the repo is configured that way; shorthand names can fail even when package names look obvious.
- Keep two lanes when needed: a full suite entrypoint for local investigation and a smaller smoke entrypoint for fast CI confidence.
- Have workflows call the root scripts, not ad hoc commands, so local and CI execution stay aligned.

## Examples
- `package.json`: `test:web` wraps `npm run test --workspace apps/web --`
- `package.json`: `test:web:focused` targets stable smoke files such as `CampaignSearch.test.tsx`
- `.github/workflows/web-test.yml`: `npm run lint:web`, `npm run test:web:focused`, `npm run build:web`

## Anti-Patterns
- Using guessed workspace selectors like `--workspace web` in a repo that actually defines `apps/web`
- Making the first CI gate depend on the slowest, broadest integration file when a smaller regression slice would prove the tooling path
- Duplicating raw workspace commands in every workflow instead of centralizing them in root scripts
