#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node --input-type=module < /dev/null 2>/dev/null || {
  echo "Node.js is required but was not found in PATH" >&2
  exit 1
}

node "$SCRIPT_DIR/validate-keycloak-theme-sync.mjs"
