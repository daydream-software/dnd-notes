---
name: "shell-json-state-readers"
description: "Read JSON state files directly from Node in Bash helpers instead of routing raw JSON back through shell argv."
domain: "tooling"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Validate the real helper and run the focused shell-backed regression."
    when: "A Bash script already requires Node and needs a few fields from a JSON state file."
---

## Context
Use this when a contributor-facing shell helper reads a repo-managed JSON state file and the data can contain embedded quotes or backslashes. If the script already depends on Node, let Node open the file directly instead of stuffing the raw JSON into a Bash variable and passing it back into `JSON.parse(process.argv[1])`.

## Patterns
- Parse `STATE_FILE` directly in `node -e` calls, or fan out all needed fields from one Node process.
- Keep Bash responsible for control flow and Node responsible for JSON parsing.
- Return empty strings for missing fields, but fail the helper for unreadable or invalid JSON when the state is required.
- Add a regression with a real JSON fixture that includes `\\\"` sequences so shell quoting bugs cannot hide.
- Prefer the smallest safe refactor on review follow-ups: change the parsing path first, then add coverage.

## Examples
- `scripts/k3d/status.sh` reads `clusterName`, `tenantNamespace`, and related fields by parsing `${STATE_FILE}` directly in Node instead of passing the entire JSON blob through shell quoting.
- `apps/control-plane/test/k3d-persistent-lane.test.ts` writes a state file whose `tokenSnippets` include escaped quotes and proves `read_state` still loads the targeted fields.

## Anti-Patterns
- Capturing a whole JSON document into a shell variable and reparsing it via `process.argv[1]`.
- Depending on Bash double-quote expansion to preserve embedded JSON escapes.
- Adding a new parser dependency when Node is already a hard prerequisite for the script.
