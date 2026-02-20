#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$ROOT_DIR/.faye/reports"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_PATH="$REPORT_DIR/always-on-proof-$STAMP.md"

mkdir -p "$REPORT_DIR"

status_cmd() {
  local label="$1"
  shift

  local printable_cmd
  printable_cmd="$(printf '%q ' "$@")"
  printable_cmd="${printable_cmd% }"
  set +e
  local output
  output="$("$@" 2>&1)"
  local code=$?
  set -e

  {
    echo "## $label"
    echo ""
    echo "- exit_code: $code"
    echo "- command: \`$printable_cmd\`"
    echo ""
    echo '```'
    echo "$output"
    echo '```'
    echo ""
  } >>"$REPORT_PATH"
}

{
  echo "# Always-On Proof Report"
  echo ""
  echo "- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- host: $(hostname)"
  echo "- user: ${USER:-unknown}"
  echo ""
} >"$REPORT_PATH"

status_cmd "Listener Service" "$ROOT_DIR/scripts/listener-control.sh" status
status_cmd "Dashboard Service" "$ROOT_DIR/scripts/dashboard-control.sh" status
status_cmd "Telegram Bridge Service" "$ROOT_DIR/scripts/telegram-bridge-control.sh" status
status_cmd "Local Health" curl -sS --max-time 10 http://127.0.0.1:4587/v1/health

echo "Report written: $REPORT_PATH"
