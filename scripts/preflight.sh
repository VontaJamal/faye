#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

json_output=false
for arg in "$@"; do
  case "$arg" in
    --json)
      json_output=true
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--json]" >&2
      exit 2
      ;;
  esac
done

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

to_upper() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]'
}

trim() {
  printf '%s' "$1" | sed 's/^ *//; s/ *$//'
}

expand_home() {
  local maybe_path="$1"
  if [[ "$maybe_path" == "~" ]]; then
    printf '%s\n' "$HOME"
    return
  fi
  if [[ "$maybe_path" == ~/* ]]; then
    printf '%s\n' "$HOME/${maybe_path#~/}"
    return
  fi
  printf '%s\n' "$maybe_path"
}

required_commands=(node npm python3 curl rec)
if [[ -n "${FAYE_PREFLIGHT_REQUIRED_COMMANDS:-}" ]]; then
  required_commands=()
  IFS=',' read -r -a parsed_required <<< "$FAYE_PREFLIGHT_REQUIRED_COMMANDS"
  for item in "${parsed_required[@]}"; do
    item="$(trim "$item")"
    [[ -n "$item" ]] && required_commands+=("$item")
  done
fi

writable_paths=(
  "$HOME/.openclaw"
  "$HOME/.openclaw/secrets"
  "$HOME/.openclaw/faye-voice"
  "$ROOT_DIR/.faye/reports"
)
if [[ -n "${FAYE_PREFLIGHT_WRITABLE_PATHS:-}" ]]; then
  writable_paths=()
  IFS=',' read -r -a parsed_paths <<< "$FAYE_PREFLIGHT_WRITABLE_PATHS"
  for item in "${parsed_paths[@]}"; do
    item="$(trim "$item")"
    [[ -n "$item" ]] && writable_paths+=("$item")
  done
fi

microphone_command="${FAYE_PREFLIGHT_MIC_COMMAND:-rec}"

dependency_pairs=()
writable_pairs=()
errors=()

for cmd in "${required_commands[@]}"; do
  if command -v "$cmd" >/dev/null 2>&1; then
    dependency_pairs+=("$cmd=true")
  else
    dependency_pairs+=("$cmd=false")
    errors+=("E_PREFLIGHT_DEP_$(to_upper "$cmd")_MISSING")
  fi
done

for raw_path in "${writable_paths[@]}"; do
  resolved_path="$(expand_home "$raw_path")"
  if mkdir -p "$resolved_path" >/dev/null 2>&1; then
    probe_file="$resolved_path/.faye-write-probe-$$-$(date +%s)"
    if (umask 077 && printf 'ok\n' > "$probe_file") >/dev/null 2>&1; then
      rm -f "$probe_file" >/dev/null 2>&1 || true
      writable_pairs+=("$resolved_path=true")
    else
      writable_pairs+=("$resolved_path=false")
      errors+=("E_PREFLIGHT_PATH_NOT_WRITABLE:${resolved_path}")
    fi
  else
    writable_pairs+=("$resolved_path=false")
    errors+=("E_PREFLIGHT_PATH_NOT_WRITABLE:${resolved_path}")
  fi
done

microphone_available=false
if command -v "$microphone_command" >/dev/null 2>&1; then
  microphone_available=true
else
  errors+=("E_PREFLIGHT_MIC_TOOLING_UNAVAILABLE")
fi

ok=true
if [[ "${#errors[@]}" -gt 0 ]]; then
  ok=false
fi

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$json_output" == true ]]; then
  printf '{\n'
  printf '  "ok": %s,\n' "$ok"
  printf '  "timestamp": "%s",\n' "$(json_escape "$timestamp")"

  printf '  "requiredCommands": {\n'
  for i in "${!dependency_pairs[@]}"; do
    kv="${dependency_pairs[$i]}"
    key="${kv%%=*}"
    value="${kv#*=}"
    if [[ "$i" -gt 0 ]]; then
      printf ',\n'
    fi
    printf '    "%s": %s' "$(json_escape "$key")" "$value"
  done
  printf '\n  },\n'

  printf '  "writablePaths": {\n'
  for i in "${!writable_pairs[@]}"; do
    kv="${writable_pairs[$i]}"
    key="${kv%%=*}"
    value="${kv#*=}"
    if [[ "$i" -gt 0 ]]; then
      printf ',\n'
    fi
    printf '    "%s": %s' "$(json_escape "$key")" "$value"
  done
  printf '\n  },\n'

  printf '  "microphone": {"command": "%s", "available": %s},\n' "$(json_escape "$microphone_command")" "$microphone_available"

  printf '  "errorCodes": ['
  for i in "${!errors[@]}"; do
    if [[ "$i" -gt 0 ]]; then
      printf ', '
    fi
    printf '"%s"' "$(json_escape "${errors[$i]}")"
  done
  printf ']\n'
  printf '}\n'
else
  echo "Preflight status: $([[ "$ok" == true ]] && echo PASS || echo FAIL)"
  echo "Timestamp: $timestamp"

  echo ""
  echo "Dependencies:"
  for kv in "${dependency_pairs[@]}"; do
    key="${kv%%=*}"
    value="${kv#*=}"
    echo "- $key: $value"
  done

  echo ""
  echo "Writable paths:"
  for kv in "${writable_pairs[@]}"; do
    key="${kv%%=*}"
    value="${kv#*=}"
    echo "- $key: $value"
  done

  echo ""
  echo "Microphone tooling:"
  echo "- command=$microphone_command available=$microphone_available"

  if [[ "${#errors[@]}" -gt 0 ]]; then
    echo ""
    echo "Error codes:"
    for code in "${errors[@]}"; do
      echo "- $code"
    done
  fi
fi

if [[ "$ok" != true ]]; then
  exit 1
fi
