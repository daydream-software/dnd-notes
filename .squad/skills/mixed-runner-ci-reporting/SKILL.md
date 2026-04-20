---
name: "mixed-runner-ci-reporting"
description: "Consolidate test results and coverage in a Node monorepo that mixes Vitest with Node's built-in test runner."
domain: "testing"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Verify JUnit/coverage files are produced locally before wiring workflow publishing."
    when: "You need to prove the reporting path works end-to-end."
---

## Context
Use this when a monorepo has multiple workspaces with different test runners and CI only surfaces one runner well, or stops before collecting the whole repo signal.

## Patterns
- Keep local `npm test` fail-fast if that is already the developer contract, but add a separate root `npm run test:ci` entrypoint for CI aggregation.
- Have every workspace emit JUnit XML into a shared folder such as `reports/test-results/`; JUnit is the easiest common format across Vitest and Node's built-in runner.
- Let the CI-specific root runner continue through all workspace suites, then fail at the end if any suite failed.
- Collect coverage per workspace under `reports/coverage/{workspace}/`, then merge the summaries into one markdown/json summary for the GitHub job summary and one combined `lcov.info` for downstream tools.
- Keep the workflow thin: call root scripts, publish the shared JUnit files once, upload the shared coverage folder once.

## Examples
- `package.json`: root `test:ci` invokes a small Node orchestrator instead of hard-coding long shell chains in workflow YAML.
- `apps/web/package.json`: Vitest writes `../../reports/test-results/web.junit.xml` and `../../reports/coverage/web/`.
- `apps/api/package.json`: Node test runner uses `--test-reporter=junit` while `c8` writes Istanbul-style coverage output.
- `.github/workflows/ci.yml`: publish `reports/test-results/**/*.xml` through a single check and append `reports/coverage/summary.md` to `$GITHUB_STEP_SUMMARY`.

## Anti-Patterns
- Making CI depend on runner-specific GitHub integrations that only work for one workspace.
- Reusing the local fail-fast `npm test` contract when CI needs a consolidated repo-wide answer.
- Generating coverage only in logs with no artifact or summary file.
- Hard-coding large mixed-runner commands directly in workflow YAML instead of root scripts.
