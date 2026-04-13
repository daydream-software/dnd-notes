---
name: "configurable-worktrees"
description: "Keep Squad worktree location rules aligned with .squad/config.json"
domain: "tooling"
confidence: "high"
source: "team-decision"
---

## Context

When a repo wants worktrees inside a project-local folder such as `.worktrees/`, the configuration alone is not enough. The authoritative governance, lifecycle docs, and workflow examples must all describe the same path-resolution rule.

## Pattern

1. Put worktree settings in `.squad/config.json`.
2. Treat `workTreesFolder` as the preferred worktree location override.
3. Resolve relative `workTreesFolder` values from the repo root / team root.
4. If `workTreesFolder` is absent, fall back to the legacy sibling path `../{repo-name}-{issue-number}`.
5. Update create, reuse, and cleanup examples together so manual commands match coordinator behavior.

## Example

```json
{
  "version": 1,
  "worktrees": true,
  "workTreesFolder": ".worktrees"
}
```

Issue `42` then resolves to `.worktrees/42`. Without `workTreesFolder`, the same issue falls back to `../{repo-name}-42`.
