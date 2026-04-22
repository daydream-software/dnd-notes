---
name: "shell-json-payloads"
description: "Generate curl JSON bodies from a real serializer when shell scripts already depend on Node."
domain: "tooling"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Validate the script syntax and run a focused payload-generation check."
    when: "A shell script posts JSON to an API and manual quoting looks brittle."
---

## Context
Use this when a repo shell script needs to send JSON with `curl`, especially in smoke or bootstrap flows where correctness matters more than shaving a helper line. If the script already requires Node, let Node serialize the payload instead of manually escaping quotes in shell.

## Patterns
- Prefer a tiny helper that returns `JSON.stringify({...})` over inline hand-escaped JSON.
- Pass dynamic values as positional arguments to `node -e` so shell interpolation stays simple and explicit.
- Keep the helper close to other script JSON utilities when the script already uses Node for parsing.
- Validate both shell syntax and the emitted payload shape after changing the request body path.
- When possible, add a focused automated regression that executes the real payload builder and `JSON.parse`s the emitted body before relying on a full smoke run.

## Examples
- `scripts/k3d/smoke.sh` uses `build_tenant_create_payload()` to serialize the tenant create body for `/internal/tenants`.
- `apps/control-plane/test/k3d-smoke-payload.test.ts` shells into `build_tenant_create_payload()` and proves the output stays valid JSON even with embedded quotes and backslashes.
- A bootstrap script can use the same pattern for POST/PUT request bodies that include user-provided slugs, IDs, or image tags.

## Anti-Patterns
- Embedding long escaped JSON blobs directly in `curl -d '...'` strings when values are dynamic.
- Relying on `printf` escape semantics for correctness when a real serializer is already available in the script runtime.
- Adding a new dependency like `jq` just to build JSON when Node is already a required tool.
