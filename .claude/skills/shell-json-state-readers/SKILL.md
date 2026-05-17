---
name: shell-json-state-readers
description: "Use when reading JSON state in a Bash helper — call Node directly instead of routing raw JSON back through shell argv."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a contributor-facing shell helper reads a repo-managed JSON state file and the data can contain embedded quotes or backslashes. If the script already depends on Node, let Node open the file directly instead of stuffing the raw JSON into a Bash variable and passing it back into `JSON.parse(process.argv[1])`.

## Patterns

- Parse `STATE_FILE` directly in `node -e` calls, or fan out all needed fields from one Node process.
- When a Bash helper needs several fields, have one Node invocation emit a NUL-delimited payload plus a success sentinel, then assign shell variables only after validating the full payload arrived.
- Keep Bash responsible for control flow and Node responsible for JSON parsing.
- Return empty strings for missing fields, but fail the helper for unreadable or invalid JSON when the state is required.
- Add a regression with a real JSON fixture that includes `\\\"` sequences so shell quoting bugs cannot hide.
- Prefer the smallest safe refactor on review follow-ups: change the parsing path first, then add coverage.

## Examples

- `scripts/k3d/status.sh` reads `clusterName`, `tenantNamespace`, and related fields by parsing `${STATE_FILE}` directly in Node instead of passing the entire JSON blob through shell quoting.
- `scripts/k3d/status.sh` stages all exported `state_*` values behind a `__K3D_STATE_PARSE_OK__` sentinel so partial parser output cannot leak stale state into the shell.
- `apps/control-plane/test/k3d-persistent-lane.test.ts` writes a state file whose `tokenSnippets` include escaped quotes and proves `read_state` still loads the targeted fields.

## Anti-Patterns

- Capturing a whole JSON document into a shell variable and reparsing it via `process.argv[1]`.
- Depending on Bash double-quote expansion to preserve embedded JSON escapes.
- Adding a new parser dependency when Node is already a hard prerequisite for the script.
