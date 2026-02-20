#!/usr/bin/env bash
set -euo pipefail

CONFIG="${FAYE_VOICE_CONFIG:-$HOME/.openclaw/faye-voice-config.json}"
[[ -f "$CONFIG" ]] || { echo "Missing config: $CONFIG"; exit 1; }

TEXT="${1:-}"
[[ -n "$TEXT" ]] || TEXT="$(cat)"

SPEAKER_HOST=$(python3 - "$CONFIG" <<'PY'
import json
import sys
cfg = json.load(open(sys.argv[1]))
print((cfg.get("speaker_host") or "").strip())
PY
)
SPEAKER_KEY=$(python3 - "$CONFIG" <<'PY'
import json
import sys
cfg = json.load(open(sys.argv[1]))
print((cfg.get("speaker_ssh_key") or "~/.ssh/id_ed25519").strip())
PY
)

[[ -n "$SPEAKER_HOST" ]] || { echo "speaker_host is empty in config"; exit 1; }
SPEAKER_KEY="${SPEAKER_KEY/#\~/$HOME}"

escaped=$(printf '%q' "$TEXT")
ssh -i "$SPEAKER_KEY" -o BatchMode=yes -o ConnectTimeout=8 "$SPEAKER_HOST" "bash -lc '$HOME/.openclaw/faye-voice/speak.sh ${escaped}'"
