#!/usr/bin/env bash

set -euo pipefail

image_tag="dnd-notes/copilot-yolo:local"
fingerprint_label="io.daydream.dnd-notes.copilot-yolo.fingerprint"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
dockerfile_path="$repo_root/.copilot_here/docker/Dockerfile"
build_context_dir=""
launch_cwd="${INIT_CWD:-$PWD}"

dry_run=false
force_rebuild=false
forward_args=()

usage() {
  cat <<'EOF'
Usage: scripts/copilot-yolo.sh [--dry-run] [--force-rebuild] [--] [copilot_here args...]

Builds the local custom image from .copilot_here/docker/Dockerfile when needed,
then launches copilot_here with --yolo, the SSH agent mount, and the --image override.

Options:
  --dry-run        Print the docker build and copilot_here commands without running them.
  --force-rebuild  Rebuild the custom image even if the fingerprint matches.
  --help           Show this help.

Examples:
  scripts/copilot-yolo.sh
  scripts/copilot-yolo.sh -- --help
  npm run copilot:yolo -- --dry-run
EOF
}

while (($#)); do
  case "$1" in
    --dry-run)
      dry_run=true
      ;;
    --force-rebuild)
      force_rebuild=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      forward_args=("$@")
      break
      ;;
    *)
      forward_args+=("$1")
      ;;
  esac
  shift
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

resolve_copilot_here() {
  if [[ "$(type -t copilot_here 2>/dev/null || true)" == "file" ]]; then
    command -v copilot_here
    return 0
  fi

  if [[ -x "$HOME/.local/bin/copilot_here" ]]; then
    printf '%s\n' "$HOME/.local/bin/copilot_here"
    return 0
  fi

  printf 'Missing required command: copilot_here\n' >&2
  printf 'Expected an executable on PATH or at %s\n' "$HOME/.local/bin/copilot_here" >&2
  exit 1
}

hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

cleanup() {
  if [[ -n "$build_context_dir" && -d "$build_context_dir" ]]; then
    rm -rf "$build_context_dir"
  fi
}

create_build_context() {
  build_context_dir="$(mktemp -d)"
  mkdir -p "$build_context_dir/.copilot_here/docker"
  mkdir -p "$build_context_dir/docker/shared"

  cp "$dockerfile_path" "$build_context_dir/.copilot_here/docker/Dockerfile"
  cp "$repo_root/docker/shared/entrypoint.sh" "$build_context_dir/docker/shared/entrypoint.sh"
  cp "$repo_root/docker/shared/entrypoint-airlock.sh" "$build_context_dir/docker/shared/entrypoint-airlock.sh"
  cp "$repo_root/docker/session-info.sh" "$build_context_dir/docker/session-info.sh"
}

trap cleanup EXIT

if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  printf 'Missing required hashing command: sha256sum or shasum\n' >&2
  exit 1
fi

if [[ ! -f "$dockerfile_path" ]]; then
  printf 'Dockerfile not found: %s\n' "$dockerfile_path" >&2
  exit 1
fi

if [[ ! -d "$launch_cwd" ]]; then
  printf 'Launch directory not found: %s\n' "$launch_cwd" >&2
  exit 1
fi

node_version="$(tr -d '[:space:]' < "$repo_root/.nvmrc")"
node_version="${node_version#v}"
if [[ -z "$node_version" ]]; then
  printf 'Unable to read Node version from %s\n' "$repo_root/.nvmrc" >&2
  exit 1
fi

fingerprint_inputs=(
  "$repo_root/.nvmrc"
  "$dockerfile_path"
  "$repo_root/docker/shared/entrypoint.sh"
  "$repo_root/docker/shared/entrypoint-airlock.sh"
  "$repo_root/docker/session-info.sh"
)

for input_path in "${fingerprint_inputs[@]}"; do
  if [[ ! -f "$input_path" ]]; then
    printf 'Build input not found: %s\n' "$input_path" >&2
    exit 1
  fi
done

desired_fingerprint="$({
  for input_path in "${fingerprint_inputs[@]}"; do
    printf '%s\n' "$input_path"
    hash_file "$input_path"
  done
} | hash_text)"

image_present=false
image_fingerprint=""
docker_available=true
if ! has_command docker; then
  if [[ "$dry_run" == true ]]; then
    docker_available=false
  else
    require_command docker
  fi
fi

if [[ "$docker_available" == true ]] && docker image inspect "$image_tag" >/dev/null 2>&1; then
  image_present=true
  image_fingerprint="$(docker image inspect --format "{{ index .Config.Labels \"$fingerprint_label\" }}" "$image_tag" 2>/dev/null || true)"
fi

needs_build=true
if [[ "$force_rebuild" == false && "$image_present" == true && "$image_fingerprint" == "$desired_fingerprint" ]]; then
  needs_build=false
fi

build_cmd=(
  docker build
  --pull
  --file '.copilot_here/docker/Dockerfile'
  --tag "$image_tag"
  --build-arg "NODE_VERSION=$node_version"
  --label "$fingerprint_label=$desired_fingerprint"
  .
)

copilot_here_bin="$(resolve_copilot_here)"

ssh_auth_sock="${SSH_AUTH_SOCK:-}"
if [[ -z "$ssh_auth_sock" ]]; then
  if [[ "$dry_run" == true ]]; then
    ssh_auth_sock='<unset SSH_AUTH_SOCK>'
  else
    printf 'SSH_AUTH_SOCK is not set. Start an SSH agent before launching copilot_here.\n' >&2
    exit 1
  fi
fi

launch_cmd=(
  "$copilot_here_bin"
  -pw
  --yolo
  --image "$image_tag"
  --skip-pull
  --mount-rw "$ssh_auth_sock:/ssh-agent"
  --agent Squad
  "${forward_args[@]}"
)

if [[ "$dry_run" == true ]]; then
  if [[ "$docker_available" == false ]]; then
    printf 'Docker is not installed; assuming image refresh is needed for this dry run.\n'
  fi
  if [[ "$needs_build" == true ]]; then
    printf 'Would build image: %s\n' "$image_tag"
    printf 'Build context: temporary directory containing only .copilot_here/docker/Dockerfile, docker/shared/entrypoint.sh, docker/shared/entrypoint-airlock.sh, and docker/session-info.sh\n'
    printf 'Launch cwd: %s\n' "$launch_cwd"
    printf 'Fingerprint: %s\n' "$desired_fingerprint"
    printf 'Build command:'
    printf ' %q' "${build_cmd[@]}"
    printf '\n'
  else
    printf 'Image is up to date: %s\n' "$image_tag"
    printf 'Launch cwd: %s\n' "$launch_cwd"
    printf 'Fingerprint: %s\n' "$desired_fingerprint"
  fi
  printf 'Launch command: SANDBOX_FLAGS=%q' '--env SSH_AUTH_SOCK=/ssh-agent'
  printf ' %q' "${launch_cmd[@]}"
  printf '\n'
  exit 0
fi

if [[ "$needs_build" == true ]]; then
  create_build_context
  printf 'Building image %s from %s\n' "$image_tag" "$dockerfile_path"
  (
    cd "$build_context_dir"
    "${build_cmd[@]}"
  )
else
  printf 'Using cached image %s\n' "$image_tag"
fi

cd "$launch_cwd"
SANDBOX_FLAGS="--env SSH_AUTH_SOCK=/ssh-agent" exec "${launch_cmd[@]}"