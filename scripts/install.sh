#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$ROOT_DIR/.faye/reports"
ATTEMPT_ID="install-$(date +%s)-$$"
REPORT_PATH="$REPORT_DIR/install-attempt-$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$.json"
STEPS_FILE="$(mktemp)"
trap 'rm -f "$STEPS_FILE"' EXIT

now_ms() {
  echo "$(( $(date +%s) * 1000 ))"
}

record_step() {
  local name="$1"
  local ok="$2"
  local code="$3"
  local message="$4"
  local duration_ms="$5"
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$ok" "$code" "$message" "$duration_ms" >> "$STEPS_FILE"
}

write_report() {
  local success="$1"
  local doctor_ok="$2"
  local services_ok="$3"

  mkdir -p "$REPORT_DIR"

  if ! command -v python3 >/dev/null 2>&1; then
    local first_step
    first_step="$(head -n 1 "$STEPS_FILE" || true)"
    local step_name="install"
    local step_ok="false"
    local step_code="E_REPORT_FALLBACK"
    local step_message="python3 missing; fallback report writer used"
    local step_duration="0"

    if [[ -n "$first_step" ]]; then
      step_name="$(printf '%s' "$first_step" | cut -f1)"
      step_ok="$(printf '%s' "$first_step" | cut -f2)"
      step_code="$(printf '%s' "$first_step" | cut -f3)"
      step_message="$(printf '%s' "$first_step" | cut -f4)"
      step_duration="$(printf '%s' "$first_step" | cut -f5)"
    fi

    cat > "$REPORT_PATH" <<EOF_FALLBACK
{
  "schemaVersion": 1,
  "attemptId": "$ATTEMPT_ID",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "install.sh",
  "success": $success,
  "durationMs": $step_duration,
  "platform": "$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)",
  "doctorOk": null,
  "servicesOk": null,
  "firstSpeakOk": null,
  "steps": [
    {
      "name": "$step_name",
      "ok": $step_ok,
      "code": "$step_code",
      "message": "$step_message",
      "durationMs": $step_duration
    }
  ],
  "notes": [
    "fallback=true"
  ]
}
EOF_FALLBACK
    return
  fi

  python3 - "$REPORT_PATH" "$STEPS_FILE" "$ATTEMPT_ID" "$success" "$doctor_ok" "$services_ok" <<'PY'
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone

report_path, steps_file, attempt_id, success, doctor_ok, services_ok = sys.argv[1:7]

def parse_bool(value: str):
    if value == "null":
        return None
    return value.lower() == "true"

steps = []
with open(steps_file, "r", encoding="utf-8") as fh:
    for raw in fh:
        raw = raw.rstrip("\n")
        if not raw:
            continue
        name, ok, code, message, duration_ms = raw.split("\t")
        step = {
            "name": name,
            "ok": ok.lower() == "true",
            "code": code,
            "message": message,
            "durationMs": int(duration_ms),
        }
        steps.append(step)

try:
    node_version = subprocess.check_output(["node", "-v"], text=True).strip()
except Exception:
    node_version = "unknown"

duration = sum(item.get("durationMs", 0) for item in steps)
report = {
    "schemaVersion": 1,
    "attemptId": attempt_id,
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": "install.sh",
    "success": parse_bool(success),
    "durationMs": duration,
    "platform": f"{platform.system().lower()}-{platform.machine()}",
    "nodeVersion": node_version,
    "doctorOk": parse_bool(doctor_ok),
    "servicesOk": parse_bool(services_ok),
    "firstSpeakOk": None,
    "steps": steps,
    "notes": [
        f"testMode={os.getenv('FAYE_INSTALL_TEST_MODE', '0')}",
        f"cwd={os.getcwd()}"
    ],
}

with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)
    fh.write("\n")
PY
}

printf "\nFaye World-Class Installer\n"
printf "===========================\n\n"

started_ms="$(now_ms)"
preflight_ms="$(now_ms)"
if "$SCRIPT_DIR/preflight.sh" --json >/dev/null; then
  preflight_done="$(now_ms)"
  record_step "preflight" true "OK" "preflight checks passed" "$((preflight_done - preflight_ms))"
else
  preflight_done="$(now_ms)"
  record_step "preflight" false "E_PREFLIGHT_FAILED" "run ./scripts/preflight.sh for details" "$((preflight_done - preflight_ms))"
  write_report false null null
  echo "Install failed: preflight checks failed."
  echo "Next step: run ./scripts/preflight.sh and resolve reported errors."
  echo "Install report: $REPORT_PATH"
  exit 1
fi

echo "Dependencies OK"

npm_install_cmd="install"
if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
  npm_install_cmd="ci"
fi

if [[ "${FAYE_INSTALL_SKIP_NPM:-0}" == "1" ]]; then
  record_step "npm-$npm_install_cmd" true "SKIPPED_TEST_MODE" "npm install step skipped by FAYE_INSTALL_SKIP_NPM=1" "0"
  record_step "build" true "SKIPPED_TEST_MODE" "build step skipped by FAYE_INSTALL_SKIP_NPM=1" "0"
else
  install_ms="$(now_ms)"
  if (cd "$ROOT_DIR" && npm "$npm_install_cmd"); then
    install_done="$(now_ms)"
    record_step "npm-$npm_install_cmd" true "OK" "npm $npm_install_cmd completed" "$((install_done - install_ms))"
  else
    install_done="$(now_ms)"
    record_step "npm-$npm_install_cmd" false "E_NPM_INSTALL_FAILED" "npm $npm_install_cmd failed" "$((install_done - install_ms))"
    write_report false null null
    echo "Install failed: npm $npm_install_cmd did not complete."
    echo "Install report: $REPORT_PATH"
    exit 1
  fi

  build_ms="$(now_ms)"
  if (cd "$ROOT_DIR" && npm run build); then
    build_done="$(now_ms)"
    record_step "build" true "OK" "npm run build completed" "$((build_done - build_ms))"
  else
    build_done="$(now_ms)"
    record_step "build" false "E_BUILD_FAILED" "npm run build failed" "$((build_done - build_ms))"
    write_report false null null
    echo "Install failed: build step failed."
    echo "Install report: $REPORT_PATH"
    exit 1
  fi
fi

services_ok=true
shims_ok=true

if [[ "${FAYE_INSTALL_TEST_MODE:-0}" == "1" ]]; then
  record_step "setup" true "SKIPPED_TEST_MODE" "setup skipped in test mode" 0
  record_step "services" true "SKIPPED_TEST_MODE" "service installers skipped in test mode" 0
else
  setup_ms="$(now_ms)"
  if [[ ! -f "$HOME/.openclaw/faye-runtime-config.json" && ! -f "$HOME/.openclaw/faye-voice-config.json" ]]; then
    echo "Running first-time setup..."
    if "$SCRIPT_DIR/faye" setup; then
      setup_done="$(now_ms)"
      record_step "setup" true "OK" "first-time setup complete" "$((setup_done - setup_ms))"
    else
      setup_done="$(now_ms)"
      record_step "setup" false "E_SETUP_FAILED" "faye setup failed" "$((setup_done - setup_ms))"
      write_report false null null
      echo "Install failed: setup did not complete."
      echo "Install report: $REPORT_PATH"
      exit 1
    fi
  else
    setup_done="$(now_ms)"
    record_step "setup" true "SKIPPED_EXISTING_CONFIG" "existing runtime config detected" "$((setup_done - setup_ms))"
  fi

  services_ms="$(now_ms)"
  if "$SCRIPT_DIR/install-listener.sh" && "$SCRIPT_DIR/install-dashboard.sh" && "$SCRIPT_DIR/install-telegram-bridge.sh"; then
    services_done="$(now_ms)"
    record_step "services" true "OK" "service installers completed" "$((services_done - services_ms))"
    services_ok=true
  else
    services_done="$(now_ms)"
    record_step "services" false "E_SERVICE_INSTALL_FAILED" "service installer failed" "$((services_done - services_ms))"
    services_ok=false
    write_report false null false
    echo "Install failed: service registration step failed."
    echo "Install report: $REPORT_PATH"
    exit 1
  fi
fi

shims_ms="$(now_ms)"
if "$SCRIPT_DIR/install-shims.sh"; then
  shims_done="$(now_ms)"
  record_step "shims" true "OK" "installed command shims to ~/.local/bin (or configured bin dir)" "$((shims_done - shims_ms))"
else
  shims_done="$(now_ms)"
  record_step "shims" false "E_SHIM_INSTALL_FAILED" "install-shims.sh failed; short commands unavailable" "$((shims_done - shims_ms))"
  shims_ok=false
fi

echo "\nRunning doctor checks..."
doctor_ms="$(now_ms)"
doctor_output=""
doctor_ok=false
if [[ "${FAYE_INSTALL_SKIP_DOCTOR:-0}" == "1" ]]; then
  doctor_done="$(now_ms)"
  record_step "doctor" true "SKIPPED_TEST_MODE" "doctor skipped by FAYE_INSTALL_SKIP_DOCTOR=1" "$((doctor_done - doctor_ms))"
  doctor_ok=true
else
  if doctor_output="$($SCRIPT_DIR/faye doctor 2>&1)"; then
    if printf '%s' "$doctor_output" | grep -q '"ok": true'; then
      doctor_ok=true
      doctor_done="$(now_ms)"
      record_step "doctor" true "OK" "doctor ok=true" "$((doctor_done - doctor_ms))"
    else
      doctor_done="$(now_ms)"
      record_step "doctor" false "E_DOCTOR_NOT_OK" "doctor returned ok=false" "$((doctor_done - doctor_ms))"
      write_report false false "$services_ok"
      echo "$doctor_output"
      echo "Install failed: doctor reported non-healthy status."
      echo "Install report: $REPORT_PATH"
      exit 1
    fi
  else
    doctor_done="$(now_ms)"
    record_step "doctor" false "E_DOCTOR_FAILED" "doctor command failed" "$((doctor_done - doctor_ms))"
    write_report false false "$services_ok"
    echo "$doctor_output"
    echo "Install failed: doctor command failed."
    echo "Install report: $REPORT_PATH"
    exit 1
  fi
fi

ended_ms="$(now_ms)"
record_step "summary" true "OK" "install complete in $((ended_ms - started_ms))ms" "0"

if [[ "$shims_ok" == false ]]; then
  write_report false "$doctor_ok" "$services_ok"
  echo "Install finished with errors: command shim installation failed."
  echo "Install report: $REPORT_PATH"
  exit 1
fi

write_report true "$doctor_ok" "$services_ok"

echo "\nInstall complete. Open: http://127.0.0.1:4587"
echo "Short commands:"
echo "  faye open"
echo "  faye status"
echo "  faye panic --confirm \"PANIC STOP\""
echo "  faye reset --confirm \"FACTORY RESET\""
echo "Install report: $REPORT_PATH"
