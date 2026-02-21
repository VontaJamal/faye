#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${FAYE_REPO_URL:-https://github.com/VontaJamal/faye.git}"
BRANCH="${FAYE_BRANCH:-main}"
TARGET_DIR="${FAYE_INSTALL_DIR:-$HOME/.openclaw/faye-src}"

fail() {
  local code="$1"
  local message="$2"
  local next_step="$3"
  echo "Bootstrap failed [$code]: $message" >&2
  if [[ -n "$next_step" ]]; then
    echo "Next step: $next_step" >&2
  fi
  exit 1
}

to_upper() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]'
}

for cmd in git bash; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "E_BOOTSTRAP_DEP_$(to_upper "$cmd")_MISSING" "Missing dependency: $cmd" "Install $cmd and rerun bootstrap."
  fi
done

if [[ -e "$TARGET_DIR" && ! -d "$TARGET_DIR/.git" ]]; then
  fail "E_BOOTSTRAP_TARGET_NOT_GIT" "Target path exists but is not a git repository: $TARGET_DIR" "Move or delete that path, then run bootstrap again."
fi

if ! mkdir -p "$(dirname "$TARGET_DIR")"; then
  fail "E_BOOTSTRAP_TARGET_PARENT_CREATE_FAILED" "Could not create parent directory for $TARGET_DIR" "Check filesystem permissions for the install path."
fi

if [[ -d "$TARGET_DIR/.git" ]]; then
  echo "Updating Faye source in $TARGET_DIR"
  if ! git -C "$TARGET_DIR" fetch origin "$BRANCH"; then
    fail "E_BOOTSTRAP_GIT_FETCH_FAILED" "Failed to fetch branch '$BRANCH' from '$REPO_URL'." "Verify branch/repo values and network access."
  fi
  if ! git -C "$TARGET_DIR" checkout "$BRANCH"; then
    fail "E_BOOTSTRAP_GIT_CHECKOUT_FAILED" "Failed to checkout branch '$BRANCH'." "Verify branch exists in the target repo."
  fi
  if ! git -C "$TARGET_DIR" pull --ff-only origin "$BRANCH"; then
    fail "E_BOOTSTRAP_GIT_PULL_FAILED" "Failed to fast-forward branch '$BRANCH'." "Resolve local git state and rerun bootstrap."
  fi
else
  echo "Cloning Faye source into $TARGET_DIR"
  if ! git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"; then
    fail "E_BOOTSTRAP_GIT_CLONE_FAILED" "Failed to clone '$REPO_URL' branch '$BRANCH'." "Verify repository URL, branch, and network access."
  fi
fi

cd "$TARGET_DIR"
if ! ./scripts/install.sh; then
  fail "E_BOOTSTRAP_INSTALL_FAILED" "Install script failed." "Review install output for the generated install report path and fix the failing step."
fi

echo ""
echo "Bootstrap complete."
echo "Source directory: $TARGET_DIR"
echo "Dashboard: http://127.0.0.1:4587"
