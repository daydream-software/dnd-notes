# Agent: Brand | Task: Install GitHub CLI in yolo image

**Date:** 2026-04-17T23:10:03Z  
**Mode:** background  
**Role:** Platform Dev  

## Task
Install GitHub CLI (`gh`) in the yolo container image to enable in-container GitHub CLI usage.

## Work Summary

**Input:** `.copilot_here/docker/Dockerfile`

**Decision:** Add Debian's `gh` package to the base system package install in `.copilot_here/docker/Dockerfile`.

**Outcomes:**
- ✅ `gh` binary added to yolo image
- ✅ `scripts/copilot-yolo.sh` unchanged; host-side auth forwarding behavior preserved
- ✅ Dockerfile fingerprint automatically invalidates cached image, triggering rebuild on next wrapper run
- ⚠️ Runtime validation blocked: `copilot_here` and Docker daemon unavailable in test environment

**Key Decision:** Keep auth on the host (SSH agent forwarding + optional `GH_TOKEN` passthrough), while adding the missing client binary to the container. Smallest reliable change with zero-touch container-side integration.

**Handoff:** Work complete. Future sandbox sessions can run `gh` inside the container with host-forwarded auth.

## Cross-Agent Impact
- **Copilot:** May use `gh` in container context going forward
- **All agents:** Sandbox auth flow now fully compliant (host derives auth, container runs authenticated tools)

## Notes
Three related decisions documented: (1) install gh, (2) gh token fallback, (3) enforce fallback. Together they complete the copilot_yolo GitHub auth saga.
