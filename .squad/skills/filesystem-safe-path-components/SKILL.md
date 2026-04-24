---
name: "filesystem-safe-path-components"
description: "Derive readable backup artifact path segments without colliding on case-insensitive filesystems."
domain: "tooling"
confidence: "high"
source: "earned"
---

## Context
Use this when a repo writes tenant- or user-controlled identifiers into filesystem paths and the artifacts may live on macOS or other case-insensitive / Unicode-normalizing filesystems.

## Patterns
- Normalize the input first (for example `value.normalize('NFKC')`) before applying readability-focused sanitization.
- Keep the sanitized segment readable for already-safe lowercase ASCII IDs.
- Append a deterministic short hash of the **raw** identifier whenever normalization, sanitization, or case-folding changes the value.
- Reject empty, `.`, or `..` path segments after sanitization.
- Add regressions for both “punctuation collapses to same sanitized value” and “IDs differ only by case” scenarios.

## Examples
- `apps/control-plane/src/tenant-backup-runner.ts` keeps `tenant-a` unchanged but turns `Tenant-A` into `Tenant-A-<hash>` so backup directories stay distinct on macOS defaults.
- The same helper already hashes IDs like `tenant/a` and `tenant?a` because both sanitize to `tenant-a`.

## Anti-Patterns
- Assuming regex sanitization alone prevents collisions.
- Hashing only the normalized value, which can still collide for distinct raw IDs that normalize the same way.
- Always hashing every path component when operator readability for already-safe IDs matters.
