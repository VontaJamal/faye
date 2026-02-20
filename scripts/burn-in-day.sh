#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$ROOT_DIR/.faye/reports"
STAMP="$(date +%Y%m%d-%H%M%S)"
UTC_DAY="$(date -u +%Y-%m-%d)"
REPORT_PATH="$REPORT_DIR/burn-in-$STAMP.md"
SUMMARY_PATH="$REPORT_DIR/burn-in-$STAMP.json"
HEALTH_PATH="$REPORT_DIR/burn-in-health-$STAMP.json"
BASELINE_METRICS_PATH="$REPORT_DIR/burn-in-metrics-baseline-$STAMP.json"
CURRENT_METRICS_PATH="$REPORT_DIR/burn-in-metrics-current-$STAMP.json"
SLO_EVAL_PATH="$REPORT_DIR/burn-in-slo-$STAMP.json"

FAYE_HEALTH_URL="${FAYE_HEALTH_URL:-http://127.0.0.1:4587/v1/health}"
FAYE_METRICS_URL="${FAYE_METRICS_URL:-http://127.0.0.1:4587/v1/metrics}"
FAYE_LOCAL_EVENT_URL="${FAYE_LOCAL_EVENT_URL:-http://127.0.0.1:4587/v1/internal/listener-event}"
FAYE_LOCAL_EVENT_TOKEN_PATH="${FAYE_LOCAL_EVENT_TOKEN_PATH:-$HOME/.openclaw/secrets/faye-local-event-token.txt}"

mkdir -p "$REPORT_DIR"

LAST_CHECK_CODE=0

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
  LAST_CHECK_CODE="$code"
  set -e

  {
    echo "- exit_code: $code"
    echo ""
    echo '```'
    echo "$output"
    echo '```'
    echo ""
  } >>"$REPORT_PATH"

  return 0
}

{
  echo "# Burn-In Daily Report"
  echo ""
  echo "- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- utc_day: $UTC_DAY"
  echo "- host: $(hostname)"
  echo "- user: ${USER:-unknown}"
  echo "- health_url: $FAYE_HEALTH_URL"
  echo "- metrics_url: $FAYE_METRICS_URL"
  echo ""
} >"$REPORT_PATH"

OVERALL_CODE=0

run_check "Health Contract Check" "curl -sS --fail --max-time 10 '$FAYE_HEALTH_URL' > '$HEALTH_PATH' && node -e \"const fs=require('fs'); const payload=JSON.parse(fs.readFileSync('$HEALTH_PATH','utf8')); if (typeof payload?.doctor?.ok !== 'boolean') throw new Error('doctor.ok missing'); if (!payload?.roundTrip || typeof payload.roundTrip !== 'object') throw new Error('roundTrip missing'); if (!payload?.metrics || typeof payload.metrics !== 'object') throw new Error('metrics missing'); console.log('health contract ok');\""
HEALTH_CODE="$LAST_CHECK_CODE"
if [[ "$HEALTH_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

run_check "Capture Metrics Baseline" "curl -sS --fail --max-time 10 '$FAYE_METRICS_URL' > '$BASELINE_METRICS_PATH'"
BASELINE_CODE="$LAST_CHECK_CODE"
if [[ "$BASELINE_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

run_check "Canary" "cd '$ROOT_DIR' && npm run canary"
CANARY_CODE="$LAST_CHECK_CODE"
if [[ "$CANARY_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

run_check "Seven Shadow Double Pass" "cd '$ROOT_DIR' && ./scripts/seven-shadow-test.sh 2"
GAUNTLET_CODE="$LAST_CHECK_CODE"
if [[ "$GAUNTLET_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

run_check "NPM Audit High" "cd '$ROOT_DIR' && npm audit --audit-level=high"
AUDIT_CODE="$LAST_CHECK_CODE"
if [[ "$AUDIT_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

run_check "Round-Trip Metrics Probe" "TOKEN=\$(cat '$FAYE_LOCAL_EVENT_TOKEN_PATH' 2>/dev/null | tr -d '[:space:]') && [[ -n \"\$TOKEN\" ]] && SESSION_ID=\"burnin-\$(date +%s)-$$\" && curl -sS --fail --max-time 10 -X POST '$FAYE_LOCAL_EVENT_URL' -H \"Content-Type: application/json\" -H \"x-faye-local-token: \$TOKEN\" -d \"{\\\"type\\\":\\\"wake_detected\\\",\\\"payload\\\":{\\\"session_id\\\":\\\"\$SESSION_ID\\\"}}\" >/dev/null && sleep 0.1 && curl -sS --fail --max-time 10 -X POST '$FAYE_LOCAL_EVENT_URL' -H \"Content-Type: application/json\" -H \"x-faye-local-token: \$TOKEN\" -d \"{\\\"type\\\":\\\"bridge_spoken\\\",\\\"payload\\\":{\\\"session_id\\\":\\\"\$SESSION_ID\\\",\\\"status\\\":\\\"ok\\\"}}\" >/dev/null && echo \"Injected probe session \$SESSION_ID\""
PROBE_CODE="$LAST_CHECK_CODE"
if [[ "$PROBE_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

run_check "Capture Metrics Current" "curl -sS --fail --max-time 10 '$FAYE_METRICS_URL' > '$CURRENT_METRICS_PATH'"
CURRENT_CODE="$LAST_CHECK_CODE"
if [[ "$CURRENT_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

run_check "SLO Evaluation" "cd '$ROOT_DIR' && FAYE_METRICS_JSON_PATH='$CURRENT_METRICS_PATH' FAYE_METRICS_BASELINE_PATH='$BASELINE_METRICS_PATH' FAYE_SLO_EVAL_OUT='$SLO_EVAL_PATH' ./scripts/slo-eval.sh"
SLO_CODE="$LAST_CHECK_CODE"
if [[ "$SLO_CODE" -ne 0 ]]; then OVERALL_CODE=1; fi

node - "$SUMMARY_PATH" "$UTC_DAY" "$OVERALL_CODE" "$HEALTH_CODE" "$BASELINE_CODE" "$CANARY_CODE" "$GAUNTLET_CODE" "$AUDIT_CODE" "$PROBE_CODE" "$CURRENT_CODE" "$SLO_CODE" "$REPORT_PATH" "$SLO_EVAL_PATH" <<'NODE'
const fs = require("node:fs");

const [
  summaryPath,
  utcDay,
  overallCodeRaw,
  healthCodeRaw,
  baselineCodeRaw,
  canaryCodeRaw,
  gauntletCodeRaw,
  auditCodeRaw,
  probeCodeRaw,
  currentCodeRaw,
  sloCodeRaw,
  reportPath,
  sloPath
] = process.argv.slice(2);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
};

const step = (code) => {
  const c = toNumber(code);
  return {
    exitCode: c,
    result: c === 0 ? "pass" : "fail"
  };
};

const summary = {
  date: utcDay,
  pass: toNumber(overallCodeRaw) === 0,
  status: toNumber(overallCodeRaw) === 0 ? "pass" : "fail",
  checks: {
    health: step(healthCodeRaw),
    metricsBaseline: step(baselineCodeRaw),
    canary: step(canaryCodeRaw),
    sevenShadowDoublePass: step(gauntletCodeRaw),
    auditHigh: step(auditCodeRaw),
    metricsProbe: step(probeCodeRaw),
    metricsCurrent: step(currentCodeRaw),
    sloEval: step(sloCodeRaw)
  },
  artifacts: {
    reportPath,
    sloPath
  },
  generatedAt: new Date().toISOString()
};

fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
NODE

echo "$REPORT_PATH" >"$REPORT_DIR/burn-in-latest-report.txt"
echo "$SUMMARY_PATH" >"$REPORT_DIR/burn-in-latest-summary.txt"
echo "$SLO_EVAL_PATH" >"$REPORT_DIR/burn-in-latest-slo.txt"

if [[ "$OVERALL_CODE" -eq 0 ]]; then
  echo "Burn-in day passed: $UTC_DAY"
else
  echo "Burn-in day failed: $UTC_DAY"
fi

echo "Report written: $REPORT_PATH"
echo "Summary written: $SUMMARY_PATH"
echo "SLO summary: $SLO_EVAL_PATH"

exit "$OVERALL_CODE"
