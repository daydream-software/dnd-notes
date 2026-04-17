---
name: "copilot-sandbox-auth-forwarding"
description: "Forward host GitHub auth into copilot_here wrappers without breaking SSH-based git and commit flows."
domain: "tooling, authentication, developer-experience"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Inspect wrapper scripts and validate dry-run output for optional env passthrough."
    when: "A repo wraps copilot_here or docker-run style sandbox launchers."
---

## Context
Use this when a project wraps `copilot_here` (or a similar sandbox launcher) and needs GitHub auth to work inside the container without regressing normal SSH-based git usage. The safest pattern is to keep socket forwarding for SSH/signing separate from token forwarding for `gh` or HTTPS git operations.

## Patterns
- Keep the SSH agent flow explicit: mount the host socket into the container and set `SSH_AUTH_SOCK` inside the sandbox to the mounted path.
- Use `SANDBOX_FLAGS` for extra container env wiring so the wrapper stays compatible with `copilot_here`.
- If the sandbox is expected to run GitHub CLI commands, install `gh` in the image itself; token forwarding only handles auth, not binary availability.
- Forward `GH_TOKEN` by name (`--env GH_TOKEN`) instead of embedding the token value in the command line.
- Only append the token passthrough when `GH_TOKEN` is already set, so default behavior does not change for developers who rely only on `gh`'s stored auth or SSH remotes.
- Make dry-run/help output reflect the optional passthrough, but never print the token value itself.

## Examples
- `.copilot_here/docker/Dockerfile`: keep `gh` in the base apt package install so yolo sessions can run `gh` directly.
- `scripts/copilot-yolo.sh`: `SANDBOX_FLAGS="--env SSH_AUTH_SOCK=/ssh-agent --env GH_TOKEN"` when `GH_TOKEN` is present.
- SSH mount remains separate: `--mount-rw "$SSH_AUTH_SOCK:/ssh-agent"`.

## Anti-Patterns
- Assuming a host-side `gh auth token` fallback means the sandbox image already contains the `gh` binary.
- Hardcoding `GH_TOKEN=<actual token>` into a wrapper script, log line, or dry-run output.
- Replacing SSH agent forwarding with token auth for commit/signing workflows.
- Forcing `GH_TOKEN` into the sandbox even when it is unset on the host.
- Hiding auth behavior changes from dry-run/help output when the wrapper is meant to be a developer-facing entrypoint.
