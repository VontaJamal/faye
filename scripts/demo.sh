#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_CONFIG="${FAYE_RUNTIME_CONFIG:-$HOME/.openclaw/faye-runtime-config.json}"

setup_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --voice-id|--voice-name|--wake-word|--profile-name|--api-key|--telegram-bot-token|--telegram-chat-id|--event-transport)
      [[ $# -ge 2 ]] || { echo "Missing value for $1"; exit 1; }
      setup_args+=("$1" "$2")
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--voice-id ... --voice-name ... --wake-word ... --api-key ...]"
      exit 1
      ;;
  esac
done

echo "Starting Faye demo..."
"$SCRIPT_DIR/install.sh"

if [[ ! -f "$RUNTIME_CONFIG" || "${#setup_args[@]}" -gt 0 ]]; then
  echo "Running setup for demo profile..."
  (cd "$ROOT_DIR" && ./scripts/faye setup "${setup_args[@]}")
fi

echo "Running health check..."
(cd "$ROOT_DIR" && ./scripts/faye doctor)

echo "Playing demo voice line..."
(cd "$ROOT_DIR" && ./scripts/speak.sh "Faye demo complete. Systems online.")

echo ""
echo "Demo ready. Open http://127.0.0.1:4587"
