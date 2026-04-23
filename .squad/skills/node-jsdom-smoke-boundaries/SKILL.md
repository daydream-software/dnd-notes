---
name: "node-jsdom-smoke-boundaries"
description: "Keep root Node script projects narrow when a smoke harness needs JSDOM and a browser workspace helper."
domain: "tooling"
confidence: "high"
source: "earned"
---

## Context
Use this when a repo-level Node script needs to fake a browser with JSDOM and reuse a TSX helper from a frontend workspace, but the root script tsconfig is intentionally Node-only.

## Patterns
- Keep the root scripts tsconfig Node-scoped unless multiple scripts truly need browser compiler settings.
- Add direct typings for packages imported by the root script itself, even if npm hoists the runtime dependency from a workspace.
- Replace DOM-only global types in the script with local structural types when the harness only needs a narrow surface.
- Load cross-workspace TSX helpers with runtime `import()` when static imports would force the root compiler to adopt another workspace's JSX/module rules.
- Validate both the root script typecheck and the frontend helper's targeted tests after the change.

## Examples
- `scripts/k3d/operator-portal-smoke.ts` keeps the root `tsconfig.json` Node-only, uses local `RequestLike`/animation callback types, and runtime-imports `../../apps/operator-portal/src/live-smoke.tsx`.
- `package.json` adds root `@types/jsdom` because the smoke script directly imports `jsdom`.

## Anti-Patterns
- Adding DOM libs/JSX to every root script just to satisfy one JSDOM harness.
- Static-importing a frontend TSX helper into a NodeNext root script project with a different `rootDir` and extension policy.
- Relying on hoisted workspace deps without declaring the root script's own type dependency.
