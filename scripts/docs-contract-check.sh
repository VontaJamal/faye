#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required=(
  ".github/workflows/seven-shadow-system.yml"
  ".github/workflows/ci-quality.yml"
  ".github/workflows/hourly-canary.yml"
  ".github/workflows/burn-in-7day.yml"
  ".github/workflows/burn-in-gate.yml"
  ".github/workflows/alpha-triage-daily.yml"
  ".github/workflows/issue-triage.yml"
  ".seven-shadow/policy.json"
  ".seven-shadow/policy-smoke.json"
  "governance/seven-shadow-system/README.md"
  "scripts/install.sh"
  "scripts/bootstrap.sh"
  "scripts/canary-smoke.sh"
  "scripts/security-check.sh"
  "scripts/always-on-proof.sh"
  "scripts/burn-in-day.sh"
  "scripts/slo-eval.sh"
  "scripts/burn-in-gate-check.mjs"
  "scripts/burn-in-issue-update.mjs"
  "scripts/triage-sla-check.mjs"
  "scripts/burn-in-exit-check.mjs"
  "scripts/faye"
  "scripts/install-listener.sh"
  "scripts/install-dashboard.sh"
  "scripts/install-telegram-bridge.sh"
  "scripts/install-speaker.sh"
  "scripts/speak-remote.sh"
  "scripts/telegram-bridge-control.sh"
  "references/reliability-slo.md"
  "docs/distribution.md"
  "docs/always-on-proof.md"
  "docs/burn-in.md"
  "docs/privacy.md"
  "docs/threat-model.md"
  "docs/roadmap.md"
  "docs/triage.md"
  "docs/releases/v1.2.0-alpha.1.md"
  "SECURITY.md"
  "CONTRIBUTING.md"
  ".github/ISSUE_TEMPLATE/bug-report.md"
  ".github/ISSUE_TEMPLATE/feature-request.md"
  ".github/ISSUE_TEMPLATE/config.yml"
  "references/seven-shadow-system.md"
  "references/seven-shadow-doctrine.md"
  "references/supported-voices.md"
  "references/openclaw-telegram-protocol.md"
)

for file in "${required[@]}"; do
  [[ -f "$ROOT_DIR/$file" ]] || { echo "Missing required file: $file"; exit 1; }
done

grep -q "3-step" "$ROOT_DIR/README.md" || { echo "README missing 3-step onboarding text"; exit 1; }
grep -q "Install In One Command" "$ROOT_DIR/README.md" || { echo "README missing one-command install section"; exit 1; }
grep -q "Trust and Safety" "$ROOT_DIR/README.md" || { echo "README missing trust and safety section"; exit 1; }
grep -q "Seven Shadow" "$ROOT_DIR/README.md" || { echo "README missing Seven Shadow doctrine"; exit 1; }
grep -q "Telegram bridge" "$ROOT_DIR/README.md" || { echo "README missing Telegram bridge section"; exit 1; }
grep -q "Seven Shadow System" "$ROOT_DIR/README.md" || { echo "README missing Seven Shadow System section"; exit 1; }
grep -q "Contributing" "$ROOT_DIR/README.md" || { echo "README missing contributing section"; exit 1; }

node - <<'NODE'
const fs = require("fs");
const policy = JSON.parse(fs.readFileSync(".seven-shadow/policy.json", "utf8"));
const smoke = JSON.parse(fs.readFileSync(".seven-shadow/policy-smoke.json", "utf8"));
if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
  throw new Error("Seven Shadow policy must include at least one rule");
}
if (typeof policy.maxAiScore !== "number") {
  throw new Error("Seven Shadow policy must define maxAiScore");
}
if (typeof smoke.minHumanApprovals !== "number" || smoke.minHumanApprovals !== 0) {
  throw new Error("Seven Shadow smoke policy must set minHumanApprovals to 0");
}
NODE

echo "Docs contract checks passed."
