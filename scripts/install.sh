#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

printf "\nFaye World-Class Installer\n"
printf "===========================\n\n"

for cmd in node npm python3 curl rec; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd"
    if [[ "$cmd" == "rec" ]]; then
      echo "Install with: brew install sox (macOS) or sudo apt install sox (Linux)"
    fi
    exit 1
  fi
done

echo "Dependencies OK"

(cd "$ROOT_DIR" && npm install)
(cd "$ROOT_DIR" && npm run build)

if [[ ! -f "$HOME/.openclaw/faye-runtime-config.json" && ! -f "$HOME/.openclaw/faye-voice-config.json" ]]; then
  echo "Running first-time setup..."
  "$SCRIPT_DIR/faye" setup
fi

"$SCRIPT_DIR/install-listener.sh"
"$SCRIPT_DIR/install-dashboard.sh"
"$SCRIPT_DIR/install-telegram-bridge.sh"

echo "\nRunning doctor checks..."
"$SCRIPT_DIR/faye" doctor

echo "\nInstall complete. Open: http://127.0.0.1:4587"
