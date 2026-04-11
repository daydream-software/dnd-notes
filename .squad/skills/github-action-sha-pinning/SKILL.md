---
name: "github-action-sha-pinning"
description: "Pin GitHub Actions workflow dependencies to immutable commit SHAs without losing the readable major-version intent."
domain: "ci"
confidence: "high"
source: "earned"
tools:
  - name: "rg"
    description: "Find floating action refs and mirrored workflow templates quickly."
    when: "Before editing workflows that may have template copies."
  - name: "bash"
    description: "Resolve upstream tag SHAs and apply exact string replacements."
    when: "When pinning existing action refs to published commits."
---

## Context
Use this when repository or organization policy requires GitHub Actions to be pinned to immutable commits instead of floating tags.

## Patterns
- Resolve the commit behind the currently referenced major tag (for example `actions/checkout@v4`).
- Replace only the `uses:` reference so workflow behavior stays the same.
- Keep mirrored in-repo workflow templates in sync with active workflow copies.
- Add a short inline comment like `# v4` or `# v7` so future updates stay readable.

## Examples
- `uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4`
- `uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7`

## Anti-Patterns
- Leaving active workflows on floating tags when org policy blocks them.
- Updating only `.github/workflows/` while forgetting mirrored template copies.
- Changing action majors while pinning; preserve the currently intended version unless the task explicitly asks for an upgrade.
