#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required=(
  ".github/workflows/seven-shadow-system.yml"
  ".github/workflows/ci-quality.yml"
  ".seven-shadow/policy.json"
  "governance/seven-shadow-system/README.md"
  "scripts/install.sh"
  "scripts/faye"
  "scripts/install-listener.sh"
  "scripts/install-dashboard.sh"
  "scripts/install-telegram-bridge.sh"
  "scripts/install-speaker.sh"
  "scripts/speak-remote.sh"
  "scripts/telegram-bridge-control.sh"
  "references/reliability-slo.md"
  "references/seven-shadow-system.md"
  "references/supported-voices.md"
  "references/openclaw-telegram-protocol.md"
)

for file in "${required[@]}"; do
  [[ -f "$ROOT_DIR/$file" ]] || { echo "Missing required file: $file"; exit 1; }
done

grep -q "3-step" "$ROOT_DIR/README.md" || { echo "README missing 3-step onboarding text"; exit 1; }
grep -q "Seven Shadow" "$ROOT_DIR/README.md" || { echo "README missing Seven Shadow doctrine"; exit 1; }
grep -q "Telegram bridge" "$ROOT_DIR/README.md" || { echo "README missing Telegram bridge section"; exit 1; }
grep -q "Seven Shadow System" "$ROOT_DIR/README.md" || { echo "README missing Seven Shadow System section"; exit 1; }

node - <<'NODE'
const fs = require("fs");
const policy = JSON.parse(fs.readFileSync(".seven-shadow/policy.json", "utf8"));
if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
  throw new Error("Seven Shadow policy must include at least one rule");
}
if (typeof policy.maxAiScore !== "number") {
  throw new Error("Seven Shadow policy must define maxAiScore");
}
NODE

echo "Docs contract checks passed."
