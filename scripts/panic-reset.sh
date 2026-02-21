#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:-}"
shift || true

CONFIRMATION=""
REASON=""
JSON_MODE=0

usage() {
  cat <<'EOF'
Usage:
  panic-reset.sh panic-stop --confirm "PANIC STOP" [--reason "..."] [--json]
  panic-reset.sh factory-reset --confirm "FACTORY RESET" [--reason "..."] [--json]
EOF
}

normalize_confirm() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -s ' ' | sed 's/^ //; s/ $//'
}

error_and_exit() {
  local code="$1"
  local message="$2"
  if [[ "$JSON_MODE" == "1" ]]; then
    node -e 'const [code, message] = process.argv.slice(1); console.log(JSON.stringify({ ok: false, error: code, message }, null, 2));' "$code" "$message"
  else
    echo "$message" >&2
  fi
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm)
      CONFIRMATION="${2:-}"
      shift 2
      ;;
    --reason)
      REASON="${2:-}"
      shift 2
      ;;
    --json)
      JSON_MODE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      error_and_exit "E_PANIC_RESET_ARG" "Unknown argument: $1"
      ;;
  esac
done

if [[ "$MODE" != "panic-stop" && "$MODE" != "factory-reset" ]]; then
  usage
  error_and_exit "E_PANIC_RESET_MODE" "Mode must be panic-stop or factory-reset."
fi

EXPECTED_CONFIRMATION="PANIC STOP"
if [[ "$MODE" == "factory-reset" ]]; then
  EXPECTED_CONFIRMATION="FACTORY RESET"
fi

if [[ "$(normalize_confirm "$CONFIRMATION")" != "$EXPECTED_CONFIRMATION" ]]; then
  if [[ "$MODE" == "panic-stop" ]]; then
    error_and_exit "E_PANIC_CONFIRMATION_REQUIRED" "Type exactly \"$EXPECTED_CONFIRMATION\" to continue."
  fi
  error_and_exit "E_FACTORY_RESET_CONFIRMATION_REQUIRED" "Type exactly \"$EXPECTED_CONFIRMATION\" to continue."
fi

if [[ -z "$REASON" ]]; then
  if [[ "$MODE" == "panic-stop" ]]; then
    REASON="cli_panic_stop"
  else
    REASON="cli_factory_reset"
  fi
fi

OPENCLAW_DIR="${FAYE_OPENCLAW_DIR:-$HOME/.openclaw}"
SECRETS_DIR="${FAYE_SECRETS_DIR:-$OPENCLAW_DIR/secrets}"
STATE_DIR="${FAYE_STATE_DIR:-$OPENCLAW_DIR/faye-voice}"
RUNTIME_CONFIG_PATH="${FAYE_RUNTIME_CONFIG:-$OPENCLAW_DIR/faye-runtime-config.json}"
LEGACY_CONFIG_PATH="${FAYE_VOICE_CONFIG:-$OPENCLAW_DIR/faye-voice-config.json}"
REPORTS_DIR="${FAYE_REPORTS_DIR:-$ROOT_DIR/.faye/reports}"

LISTENER_CONTROL_SCRIPT="${FAYE_LISTENER_CONTROL_SCRIPT:-$SCRIPT_DIR/listener-control.sh}"
BRIDGE_CONTROL_SCRIPT="${FAYE_BRIDGE_CONTROL_SCRIPT:-$SCRIPT_DIR/telegram-bridge-control.sh}"
DASHBOARD_CONTROL_SCRIPT="${FAYE_DASHBOARD_CONTROL_SCRIPT:-$SCRIPT_DIR/dashboard-control.sh}"

REQUESTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARCHIVE_PATH=""
ENDED_SESSION_ID=""
STOP_REQUEST_WRITTEN=0
OK=1
DASHBOARD_KEPT_RUNNING=1

SERVICES_FILE="$(mktemp)"
WIPED_FILE="$(mktemp)"
CLEARED_FILE="$(mktemp)"
ARCHIVED_FILE="$(mktemp)"
ERRORS_FILE="$(mktemp)"
NOTES_FILE="$(mktemp)"

cleanup() {
  rm -f "$SERVICES_FILE" "$WIPED_FILE" "$CLEARED_FILE" "$ARCHIVED_FILE" "$ERRORS_FILE" "$NOTES_FILE"
}
trap cleanup EXIT

record_error() {
  local error="$1"
  printf '%s\n' "$error" >> "$ERRORS_FILE"
  OK=0
}

record_service_stop() {
  local service_name="$1"
  local script_path="$2"
  local stdout_file stderr_file code stdout stderr
  stdout_file="$(mktemp)"
  stderr_file="$(mktemp)"

  if [[ ! -x "$script_path" ]]; then
    code=127
    stdout=""
    stderr="missing executable: $script_path"
  else
    if bash "$script_path" stop >"$stdout_file" 2>"$stderr_file"; then
      code=0
    else
      code=$?
    fi
    stdout="$(tr '\n' ' ' < "$stdout_file" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
    stderr="$(tr '\n' ' ' < "$stderr_file" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
  fi

  rm -f "$stdout_file" "$stderr_file"
  printf '%s\t%s\t%s\t%s\n' "$service_name" "$code" "$stdout" "$stderr" >> "$SERVICES_FILE"

  if [[ "$code" -ne 0 ]]; then
    record_error "${service_name}_stop_failed"
  fi
}

clear_runtime_file() {
  local file_path="$1"
  rm -f "$file_path" || true
  printf '%s\n' "$file_path" >> "$CLEARED_FILE"
}

archive_if_exists() {
  local source="$1"
  local dest="$2"
  if [[ ! -e "$source" ]]; then
    return
  fi
  mkdir -p "$(dirname "$dest")"
  cp -R "$source" "$dest"
  printf '%s\n' "$source" >> "$ARCHIVED_FILE"
}

wipe_path() {
  local target="$1"
  rm -rf "$target" || true
  printf '%s\n' "$target" >> "$WIPED_FILE"
}

end_active_session() {
  if ! command -v curl >/dev/null 2>&1; then
    printf '%s\n' "curl_missing_skip_session_end" >> "$NOTES_FILE"
    return
  fi

  local active_json session_id
  active_json="$(curl -fsS http://127.0.0.1:4587/v1/conversation/active 2>/dev/null || true)"
  if [[ -z "$active_json" ]]; then
    return
  fi

  session_id="$(printf '%s' "$active_json" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>{try{const parsed=JSON.parse(data);const id=parsed?.session?.sessionId;process.stdout.write(typeof id==="string"?id:"");}catch{}});')"
  if [[ -z "$session_id" ]]; then
    return
  fi

  if curl -fsS -X POST "http://127.0.0.1:4587/v1/conversation/${session_id}/end" -H 'Content-Type: application/json' -d "{\"reason\":\"$REASON\"}" >/dev/null 2>&1; then
    ENDED_SESSION_ID="$session_id"
    STOP_REQUEST_WRITTEN=1
  else
    record_error "active_session_end_failed"
  fi
}

run_panic_stop() {
  DASHBOARD_KEPT_RUNNING=1
  end_active_session
  record_service_stop "listener" "$LISTENER_CONTROL_SCRIPT"
  record_service_stop "bridge" "$BRIDGE_CONTROL_SCRIPT"

  clear_runtime_file "$STATE_DIR/conversation-stop-request.json"
  clear_runtime_file "$STATE_DIR/telegram-bridge-runtime.json"
  clear_runtime_file "$STATE_DIR/telegram-bridge-offset.txt"
  clear_runtime_file "$STATE_DIR/telegram-bridge-processed-keys.json"
}

run_factory_reset() {
  DASHBOARD_KEPT_RUNNING=0
  end_active_session

  ARCHIVE_PATH="$OPENCLAW_DIR/faye-archives/factory-reset-$STAMP-$$"
  mkdir -p "$ARCHIVE_PATH"
  archive_if_exists "$RUNTIME_CONFIG_PATH" "$ARCHIVE_PATH/$(basename "$RUNTIME_CONFIG_PATH")"
  archive_if_exists "$LEGACY_CONFIG_PATH" "$ARCHIVE_PATH/$(basename "$LEGACY_CONFIG_PATH")"
  archive_if_exists "$SECRETS_DIR" "$ARCHIVE_PATH/secrets"
  archive_if_exists "$STATE_DIR" "$ARCHIVE_PATH/faye-voice"
  archive_if_exists "$REPORTS_DIR" "$ARCHIVE_PATH/reports"

  wipe_path "$RUNTIME_CONFIG_PATH"
  wipe_path "$LEGACY_CONFIG_PATH"
  wipe_path "$SECRETS_DIR"
  wipe_path "$STATE_DIR"
  wipe_path "$REPORTS_DIR"

  record_service_stop "listener" "$LISTENER_CONTROL_SCRIPT"
  record_service_stop "bridge" "$BRIDGE_CONTROL_SCRIPT"
  record_service_stop "dashboard" "$DASHBOARD_CONTROL_SCRIPT"
}

if [[ "$MODE" == "panic-stop" ]]; then
  run_panic_stop
else
  run_factory_reset
fi

COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$JSON_MODE" == "1" ]]; then
  node - "$MODE" "$REQUESTED_AT" "$COMPLETED_AT" "$ARCHIVE_PATH" "$DASHBOARD_KEPT_RUNNING" "$ENDED_SESSION_ID" "$STOP_REQUEST_WRITTEN" "$OK" "$SERVICES_FILE" "$WIPED_FILE" "$CLEARED_FILE" "$ARCHIVED_FILE" "$ERRORS_FILE" "$NOTES_FILE" <<'NODE'
const fs = require("node:fs");

const [
  mode,
  requestedAt,
  completedAt,
  archivePath,
  dashboardKeptRunning,
  endedSessionId,
  stopRequestWritten,
  ok,
  servicesFile,
  wipedFile,
  clearedFile,
  archivedFile,
  errorsFile,
  notesFile
] = process.argv.slice(2);

function readLines(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const services = readLines(servicesFile).map((line) => {
  const [name, codeRaw, stdout, stderr] = line.split("\t");
  return {
    name,
    code: Number(codeRaw),
    stdout: stdout ?? "",
    stderr: stderr ?? ""
  };
});

const payload = {
  ok: ok === "1",
  result: {
    schemaVersion: 1,
    action: mode,
    requestedAt,
    completedAt,
    confirmationMatched: true,
    endedSessionId: endedSessionId || null,
    stopRequestWritten: stopRequestWritten === "1",
    dashboardKeptRunning: dashboardKeptRunning === "1",
    archivePath: archivePath || null,
    clearedRuntimeFiles: readLines(clearedFile),
    wipedPaths: readLines(wipedFile),
    stoppedServices: Object.fromEntries(services.map((entry) => [entry.name, { code: entry.code, stdout: entry.stdout, stderr: entry.stderr }])),
    notes: [
      ...readLines(notesFile),
      ...readLines(archivedFile).map((item) => `archived:${item}`)
    ],
    errors: readLines(errorsFile)
  }
};

console.log(JSON.stringify(payload, null, 2));
NODE
else
  if [[ "$MODE" == "panic-stop" ]]; then
    echo "Panic stop complete."
    echo "Dashboard stays up at http://127.0.0.1:4587"
  else
    echo "Factory reset complete."
    if [[ -n "$ARCHIVE_PATH" ]]; then
      echo "Archive: $ARCHIVE_PATH"
    fi
  fi
fi

if [[ "$OK" -eq 1 ]]; then
  exit 0
fi
exit 1
