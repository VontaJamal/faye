#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${FAYE_REPO_URL:-https://github.com/VontaJamal/faye.git}"
BRANCH="${FAYE_BRANCH:-main}"
TARGET_DIR="${FAYE_INSTALL_DIR:-$HOME/.openclaw/faye-src}"

for cmd in git bash; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd"
    exit 1
  fi
done

if [[ -e "$TARGET_DIR" && ! -d "$TARGET_DIR/.git" ]]; then
  echo "Target path exists but is not a git repository: $TARGET_DIR"
  echo "Move or delete that path, then run bootstrap again."
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"

if [[ -d "$TARGET_DIR/.git" ]]; then
  echo "Updating Faye source in $TARGET_DIR"
  git -C "$TARGET_DIR" fetch origin "$BRANCH" --depth 1
  git -C "$TARGET_DIR" checkout "$BRANCH"
  git -C "$TARGET_DIR" pull --ff-only origin "$BRANCH"
else
  echo "Cloning Faye source into $TARGET_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"
./scripts/install.sh

echo ""
echo "Bootstrap complete."
echo "Source directory: $TARGET_DIR"
echo "Dashboard: http://127.0.0.1:4587"
