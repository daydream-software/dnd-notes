# Session: Install GitHub CLI in yolo image

**Date:** 2026-04-17T23:10:03Z

## What Happened

Brand (Platform Dev) installed `gh` binary in the yolo container image by adding Debian's `gh` package to `.copilot_here/docker/Dockerfile`.

## Decisions Made

1. **Install GitHub CLI in yolo image:** Add `gh` to base system packages; leave `scripts/copilot-yolo.sh` unchanged.
2. **GH token fallback (best-effort):** When host `GH_TOKEN` unavailable, attempt `gh auth token` lookup; fail gracefully if missing.
3. **Enforce GH auth fallback:** Fail fast with `gh auth login` guidance if token derivation fails; do not continue silently.

## Outcomes

- ✅ yolo image includes `gh` binary
- ✅ Host-side auth forwarding preserved (SSH agent + optional `GH_TOKEN`)
- ✅ Dockerfile change auto-invalidates image cache, triggers rebuild on next run
- All three related decisions merged to team decisions log

## Next

Sandbox auth flow complete. Agents can now use `gh` in container context.
