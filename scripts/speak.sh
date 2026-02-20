#!/usr/bin/env bash
set -euo pipefail

CONFIG="${FAYE_VOICE_CONFIG:-$HOME/.openclaw/faye-voice-config.json}"
[[ -f "$CONFIG" ]] || { echo "Error: Config not found at $CONFIG" >&2; exit 1; }

TEXT="${1:-}"
if [[ -z "$TEXT" ]]; then
  TEXT="$(cat)"
fi
[[ -n "$TEXT" ]] || { echo "Error: text is required" >&2; exit 1; }

read_cfg() {
  local key="$1"
  python3 - "$CONFIG" "$key" <<'PY'
import json
import sys
cfg = json.load(open(sys.argv[1]))
print(cfg.get(sys.argv[2], ""))
PY
}

API_KEY_PATH="$(read_cfg elevenlabs_api_key_path)"
VOICE_ID="$(read_cfg voice_id)"
MODEL="$(read_cfg model)"
STABILITY="$(read_cfg stability)"
SIMILARITY="$(read_cfg similarity_boost)"
STYLE="$(read_cfg style)"

[[ -n "$MODEL" ]] || MODEL="eleven_multilingual_v2"
[[ -n "$STABILITY" ]] || STABILITY="0.4"
[[ -n "$SIMILARITY" ]] || SIMILARITY="0.8"
[[ -n "$STYLE" ]] || STYLE="0.7"

API_KEY_PATH="${API_KEY_PATH/#\~/$HOME}"
[[ -f "$API_KEY_PATH" ]] || { echo "Error: API key file not found at $API_KEY_PATH" >&2; exit 1; }
API_KEY="$(tr -d '\n' < "$API_KEY_PATH")"
[[ -n "$API_KEY" ]] || { echo "Error: API key is empty" >&2; exit 1; }
[[ -n "$VOICE_ID" ]] || { echo "Error: voice_id is missing in config" >&2; exit 1; }

OUTFILE="/tmp/faye-voice-$$.mp3"
PAYLOAD=$(python3 - "$TEXT" "$MODEL" "$STABILITY" "$SIMILARITY" "$STYLE" <<'PY'
import json
import sys
text, model, stability, similarity, style = sys.argv[1:6]
print(json.dumps({
  "text": text,
  "model_id": model,
  "voice_settings": {
    "stability": float(stability),
    "similarity_boost": float(similarity),
    "style": float(style),
  },
}))
PY
)

resp_file="$(mktemp)"
status=$(curl -sS -o "$resp_file" -w "%{http_code}" \
  --retry 2 --retry-all-errors --max-time 30 \
  -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" \
  -H "xi-api-key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
  echo "Error: ElevenLabs TTS failed (status ${status})" >&2
  cat "$resp_file" >&2
  rm -f "$resp_file"
  exit 1
fi

mv "$resp_file" "$OUTFILE"

if command -v afplay >/dev/null 2>&1; then
  afplay "$OUTFILE"
elif command -v mpv >/dev/null 2>&1; then
  mpv --no-video --really-quiet "$OUTFILE" >/dev/null 2>&1
elif command -v ffplay >/dev/null 2>&1; then
  ffplay -nodisp -autoexit -loglevel quiet "$OUTFILE" >/dev/null 2>&1
else
  echo "Error: no supported audio player found (afplay, mpv, ffplay)" >&2
  rm -f "$OUTFILE"
  exit 1
fi

rm -f "$OUTFILE"
