# PR preview screenshots

Orphan catch-all branch hosting visual artifacts (screenshots, GIFs, diagrams) referenced from PR descriptions via `raw.githubusercontent.com` URLs.

## Convention

- One subdirectory per PR: `pr-<number>/`
- Inside each subdir: numbered PNGs (e.g. `01-operator-login.png`, `02-customer-login.png`) or any descriptive filename
- Reference from the PR body using direct raw URLs:

  ```markdown
  ![alt](https://raw.githubusercontent.com/daydream-software/dnd-notes/previews/pr-NNN/filename.png)
  ```

## Lifecycle

- This branch is **permanent**. Never delete it.
- Subdirectories accumulate over time. Old PR previews can be archived/pruned during periodic housekeeping if needed, but coordinate with the PR's reviewers — PR descriptions reference these images for historical context.
- This branch is an **orphan** (no shared history with `main`). It is not merged anywhere and contains no source code.

## Why a single branch instead of one per PR

Per-PR orphan branches risk accidental deletion during post-merge cleanup, which silently invalidates PR-body image links once GitHub's Camo image proxy cache evicts. A single permanent branch is exempt from per-PR branch-pruning scripts.
