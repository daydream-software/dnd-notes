# Brand — PR #77 Bash compatibility

## Decision

Contributor-facing repo scripts may keep Bash-specific safety features, but any Bash 4.4+ only shell options must be gated with an explicit `BASH_VERSINFO` check instead of being enabled unconditionally.

## Why

`scripts/k3d/smoke.sh` is part of the normal local platform loop and should still start in older-but-common environments, especially macOS's stock `/usr/bin/bash` 3.2. An explicit version guard preserves stricter behavior on newer Bash versions without turning the script into a hard failure on machines that have not upgraded Bash.
