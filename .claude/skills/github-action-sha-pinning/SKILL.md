---
name: github-action-sha-pinning
description: "Use when adding or modifying a GitHub Actions workflow. Pin every action to its immutable commit SHA while keeping the readable major-version tag as a trailing comment."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when repository or organization policy requires GitHub Actions to be pinned to immutable commits instead of floating tags.

## Patterns

- Resolve the commit behind the currently referenced major tag (for example `actions/checkout@v4`).
- Replace only the `uses:` reference so workflow behavior stays the same.
- Keep mirrored in-repo workflow templates in sync with active workflow copies.
- For Squad-managed workflow syncs, use `.squad/templates/workflows/` as the source of truth for the active `.github/workflows/` copy instead of hand-editing drifted duplicates.
- If an upgrade adds brand-new workflows, audit whether they actually fit the repo before pinning them; delete clearly inapplicable release/docs/branch-specific automation rather than preserving dead weight.
- Add a short inline comment like `# v4` or `# v7` so future updates stay readable.
- When the change is driven by a GitHub runtime deprecation, fetch the upstream `action.yml` for each pinned action in the workflow and verify `runs.using` before and after the bump so you can prove the deprecated runtime is actually gone.
- Keep the inline comment matched to the exact upstream release tag you resolved, not just the major version, when the task is a surgical deprecation or supply-chain update.

## Examples

- `uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4`
- `uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7`
- `uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`
- `cp .squad/templates/workflows/squad-triage.yml .github/workflows/squad-triage.yml` when a synced active workflow was overwritten with floating tags during upgrade

## Anti-Patterns

- Leaving active workflows on floating tags when org policy blocks them.
- Updating only `.github/workflows/` while forgetting mirrored template copies.
- Blindly keeping upgrade-added workflows that target missing branches, missing directories, or the wrong project type.
- Changing action majors while pinning; preserve the currently intended version unless the task explicitly asks for an upgrade.
- Assuming a newer tag fixes a Node runtime warning without checking `action.yml`; some actions stay on older runtimes longer than expected.
