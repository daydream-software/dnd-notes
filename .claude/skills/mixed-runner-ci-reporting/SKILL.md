---
name: mixed-runner-ci-reporting
description: "Use when consolidating test results and coverage in a monorepo that mixes Vitest with Node's built-in test runner."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a monorepo has multiple workspaces with different test runners and CI only surfaces one runner well, or stops before collecting the whole repo signal.

## Patterns

- Keep local `npm test` fail-fast if that is already the developer contract, but add a separate root `npm run test:ci` entrypoint for CI aggregation.
- Have every workspace emit JUnit XML into a shared folder such as `reports/test-results/`; JUnit is the easiest common format across Vitest and Node's built-in runner.
- Let the CI-specific root runner continue through all workspace suites, then fail at the end if any suite failed.
- Collect coverage per workspace under `reports/coverage/{workspace}/`, then merge the summaries into one markdown/json summary for the GitHub job summary and one combined `lcov.info` for downstream tools.
- Keep the workflow thin: call root scripts, publish the shared JUnit files once, upload the shared coverage folder once.
- When CI also publishes a secondary `Test Results` check from the shared JUnit output, treat red `validate` + red `Test Results` as one likely underlying suite failure until the annotations prove otherwise. Diagnose from the JUnit-backed annotations first, then decide whether the issue is a real product regression or a brittle/flaky test.

## Examples

- `package.json`: root `test:ci` invokes a small Node orchestrator instead of hard-coding long shell chains in workflow YAML.
- `apps/web/package.json`: Vitest writes `../../reports/test-results/web.junit.xml` and `../../reports/coverage/web/`.
- `apps/api/package.json`: Node test runner uses `--test-reporter=junit` while `c8` writes Istanbul-style coverage output.
- `.github/workflows/ci.yml`: publish `reports/test-results/**/*.xml` through a single check and append `reports/coverage/summary.md` to `$GITHUB_STEP_SUMMARY`.
- `.github/workflows/ci.yml`: run tests with `continue-on-error`, publish JUnit as `Test Results`, and only then fail the main `validate` job. In that setup, PR triage should inspect the annotation payload because it names the real failing test even when GitHub shows two red checks.

## Anti-Patterns

- Making CI depend on runner-specific GitHub integrations that only work for one workspace.
- Reusing the local fail-fast `npm test` contract when CI needs a consolidated repo-wide answer.
- Generating coverage only in logs with no artifact or summary file.
- Hard-coding large mixed-runner commands directly in workflow YAML instead of root scripts.
