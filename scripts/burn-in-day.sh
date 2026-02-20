#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$ROOT_DIR/.faye/reports"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_PATH="$REPORT_DIR/burn-in-$STAMP.md"

mkdir -p "$REPORT_DIR"

run_check() {
  local title="$1"
  local cmd="$2"

  {
    echo "## $title"
    echo ""
    echo "- command: \`$cmd\`"
    echo ""
  } >>"$REPORT_PATH"

  set +e
  local output
  output="$(bash -lc "$cmd" 2>&1)"
  local code=$?
  set -e

  {
    echo "- exit_code: $code"
    echo ""
    echo '```'
    echo "$output"
    echo '```'
    echo ""
  } >>"$REPORT_PATH"

  if [[ "$code" -ne 0 ]]; then
    echo "Failed: $title"
    echo "Report written: $REPORT_PATH"
    exit "$code"
  fi
}

{
  echo "# Burn-In Daily Report"
  echo ""
  echo "- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- host: $(hostname)"
  echo "- user: ${USER:-unknown}"
  echo ""
} >"$REPORT_PATH"

run_check "Canary" "cd '$ROOT_DIR' && npm run canary"
run_check "Seven Shadow Double Pass" "cd '$ROOT_DIR' && ./scripts/seven-shadow-test.sh 2"
run_check "NPM Audit High" "cd '$ROOT_DIR' && npm audit --audit-level=high"

echo "Burn-in day passed."
echo "Report written: $REPORT_PATH"
