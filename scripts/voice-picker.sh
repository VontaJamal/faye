#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$HOME/.openclaw/secrets/elevenlabs-api-key.txt"

read_secret_prompt() {
  read -r -s -p "ElevenLabs API key: " key
  echo ""
  echo "$key"
}

api_key=""
if [[ -f "$KEY_FILE" ]]; then
  api_key="$(tr -d '\n' < "$KEY_FILE")"
else
  api_key="$(read_secret_prompt)"
fi

[[ -n "$api_key" ]] || { echo "API key is required"; exit 1; }

voices_response=$(mktemp)
status=$(curl -sS -o "$voices_response" -w "%{http_code}" \
  -H "xi-api-key: $api_key" \
  "https://api.elevenlabs.io/v1/voices")

if [[ "$status" -ge 400 ]]; then
  echo "Failed to fetch voices (status $status)"
  cat "$voices_response"
  rm -f "$voices_response"
  exit 1
fi

echo "\nTop voice options:"
python3 - "$voices_response" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1]))
voices = payload.get("voices", [])
for i, voice in enumerate(voices[:25], start=1):
    labels = voice.get("labels", {})
    gender = labels.get("gender", "?")
    accent = labels.get("accent", "?")
    print(f"{i:2d}. {voice.get('name','unknown')} | {gender} | {accent} | id={voice.get('voice_id')}")
PY

read -r -p "Voice ID: " voice_id
read -r -p "Voice Name: " voice_name
read -r -p "Wake word [Faye Arise]: " wake_word
wake_word="${wake_word:-Faye Arise}"

"$SCRIPT_DIR/faye" setup \
  --api-key "$api_key" \
  --voice-id "$voice_id" \
  --voice-name "$voice_name" \
  --wake-word "$wake_word"

rm -f "$voices_response"
