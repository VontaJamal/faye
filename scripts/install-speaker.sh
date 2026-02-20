#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.openclaw/faye-voice"

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/speak.sh" "$INSTALL_DIR/speak.sh"
chmod +x "$INSTALL_DIR/speak.sh"

if command -v afplay >/dev/null 2>&1; then
  afplay /System/Library/Sounds/Ping.aiff >/dev/null 2>&1 || true
elif command -v ffplay >/dev/null 2>&1; then
  ffplay -nodisp -autoexit -loglevel quiet /System/Library/Sounds/Ping.aiff >/dev/null 2>&1 || true
fi

echo "Speaker script installed to $INSTALL_DIR/speak.sh"
echo "Run './scripts/speak.sh "'"'Hello from Faye'"'"' to verify output."
