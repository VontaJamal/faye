#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METRICS_URL="${FAYE_METRICS_URL:-http://127.0.0.1:4587/v1/metrics}"
METRICS_JSON_PATH="${FAYE_METRICS_JSON_PATH:-}"
METRICS_BASELINE_PATH="${FAYE_METRICS_BASELINE_PATH:-}"
SLO_ERROR_RATE_MAX="${SLO_ERROR_RATE_MAX:-0.02}"
SLO_P95_MAX_MS="${SLO_P95_MAX_MS:-2500}"
SLO_P99_MAX_MS="${SLO_P99_MAX_MS:-5000}"
SLO_EVAL_OUT="${FAYE_SLO_EVAL_OUT:-}"

tmp_current="$(mktemp)"
cleanup() {
  rm -f "$tmp_current"
}
trap cleanup EXIT

if [[ -n "$METRICS_JSON_PATH" ]]; then
  [[ -f "$METRICS_JSON_PATH" ]] || { echo "Metrics JSON file not found: $METRICS_JSON_PATH"; exit 1; }
  cp "$METRICS_JSON_PATH" "$tmp_current"
else
  curl -sS --max-time 10 "$METRICS_URL" >"$tmp_current"
fi

if [[ -n "$METRICS_BASELINE_PATH" && ! -f "$METRICS_BASELINE_PATH" ]]; then
  echo "Baseline metrics file not found: $METRICS_BASELINE_PATH"
  exit 1
fi

node - "$tmp_current" "$METRICS_BASELINE_PATH" "$SLO_ERROR_RATE_MAX" "$SLO_P95_MAX_MS" "$SLO_P99_MAX_MS" "$SLO_EVAL_OUT" <<'NODE'
const fs = require("node:fs");

const [
  currentPath,
  baselinePath,
  maxErrorRateRaw,
  maxP95Raw,
  maxP99Raw,
  outPath
] = process.argv.slice(2);

function fail(message, details = {}) {
  console.error(`SLO_EVAL_FAIL: ${message}`);
  if (Object.keys(details).length > 0) {
    console.error(JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

function parseJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Unable to parse JSON at ${path}`, { message: error instanceof Error ? error.message : String(error) });
  }
}

function num(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const maxErrorRate = Number(maxErrorRateRaw);
const maxP95Ms = Number(maxP95Raw);
const maxP99Ms = Number(maxP99Raw);

if (!Number.isFinite(maxErrorRate) || !Number.isFinite(maxP95Ms) || !Number.isFinite(maxP99Ms)) {
  fail("Invalid SLO threshold inputs", { maxErrorRateRaw, maxP95Raw, maxP99Raw });
}

const current = parseJson(currentPath);
const baseline = baselinePath ? parseJson(baselinePath) : null;

const currentSpokenOk = num(current?.roundTrip?.bridgeSpokenOk, 0);
const currentP95 = num(current?.latency?.p95Ms, null);
const currentP99 = num(current?.latency?.p99Ms, null);
const currentErrorRate = num(current?.errorRate?.value, null);

const baselineSpokenOk = baseline ? num(baseline?.roundTrip?.bridgeSpokenOk, 0) : 0;
const spokenOkDelta = currentSpokenOk - baselineSpokenOk;

if (spokenOkDelta <= 0) {
  fail("spoken success count did not increase for this run", {
    currentSpokenOk,
    baselineSpokenOk,
    spokenOkDelta
  });
}

if (currentErrorRate === null) {
  fail("round-trip error rate is missing", { currentErrorRate });
}

if (currentErrorRate > maxErrorRate) {
  fail("round-trip error rate exceeds threshold", {
    currentErrorRate,
    maxErrorRate
  });
}

if (currentP95 === null) {
  fail("p95 latency is missing", { currentP95 });
}
if (currentP95 > maxP95Ms) {
  fail("p95 latency exceeds threshold", {
    currentP95,
    maxP95Ms
  });
}

if (currentP99 === null) {
  fail("p99 latency is missing", { currentP99 });
}
if (currentP99 > maxP99Ms) {
  fail("p99 latency exceeds threshold", {
    currentP99,
    maxP99Ms
  });
}

const summary = {
  evaluatedAt: new Date().toISOString(),
  thresholds: {
    maxErrorRate,
    maxP95Ms,
    maxP99Ms
  },
  values: {
    currentSpokenOk,
    baselineSpokenOk,
    spokenOkDelta,
    currentErrorRate,
    currentP95,
    currentP99
  },
  result: "pass"
};

if (outPath) {
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

console.log("SLO_EVAL_PASS");
console.log(JSON.stringify(summary, null, 2));
NODE
