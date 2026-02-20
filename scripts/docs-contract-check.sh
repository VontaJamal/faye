#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required=(
  "scripts/install.sh"
  "scripts/faye"
  "scripts/install-listener.sh"
  "scripts/install-dashboard.sh"
  "scripts/install-telegram-bridge.sh"
  "scripts/install-speaker.sh"
  "scripts/speak-remote.sh"
  "scripts/telegram-bridge-control.sh"
  "references/supported-voices.md"
  "references/openclaw-telegram-protocol.md"
)

for file in "${required[@]}"; do
  [[ -f "$ROOT_DIR/$file" ]] || { echo "Missing required file: $file"; exit 1; }
done

grep -q "3-step" "$ROOT_DIR/README.md" || { echo "README missing 3-step onboarding text"; exit 1; }
grep -q "Seven Shadow" "$ROOT_DIR/README.md" || { echo "README missing Seven Shadow doctrine"; exit 1; }
grep -q "Telegram bridge" "$ROOT_DIR/README.md" || { echo "README missing Telegram bridge section"; exit 1; }

echo "Docs contract checks passed."
