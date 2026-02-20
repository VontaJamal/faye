#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1] Build"
(cd "$ROOT_DIR" && npm run build)

echo "[2] Security smoke checks"
(cd "$ROOT_DIR" && ./scripts/security-check.sh)

echo "[3] Reliability smoke tests"
(cd "$ROOT_DIR" && node --test dist/app/test/api.integration.test.js dist/app/test/telegramBridge.e2e.test.js)

echo "[4] Accessibility + docs contracts"
(cd "$ROOT_DIR" && ./scripts/accessibility-check.sh)
(cd "$ROOT_DIR" && ./scripts/docs-contract-check.sh)

echo "[5] Seven Shadow System smoke policy"
(cd "$ROOT_DIR" && npm run guard:seven-shadow -- --policy .seven-shadow/policy-smoke.json --event governance/seven-shadow-system/examples/pr_review_event.json --event-name pull_request_review --report .seven-shadow/reports/canary-report.json)

echo "Canary smoke checks passed."
