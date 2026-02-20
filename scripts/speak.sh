#!/bin/bash
# FayeVoice — Local TTS playback
# Usage: speak.sh "text to say"
# Run on the machine connected to speakers

set -e
CONFIG="${FAYE_VOICE_CONFIG:-$HOME/.openclaw/faye-voice-config.json}"

if [ ! -f "$CONFIG" ]; then
    echo "Error: Config not found at $CONFIG. Run install first." >&2
    exit 1
fi

API_KEY=$(python3 -c "
import json,os
c = json.load(open('$CONFIG'))
p = os.path.expanduser(c['elevenlabs_api_key_path'])
print(open(p).read().strip())
")
VOICE_ID=$(python3 -c "import json; print(json.load(open('$CONFIG'))['voice_id'])")
MODEL=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('model','eleven_multilingual_v2'))")
STABILITY=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('stability',0.4))")
SIMILARITY=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('similarity_boost',0.8))")
STYLE=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('style',0.7))")

TEXT="${1:-$(cat)}"
OUTFILE="/tmp/faye-voice-$$.mp3"

curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID" \
    -H "xi-api-key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
        \"text\": $(python3 -c "import json; print(json.dumps('$TEXT'))"),
        \"model_id\": \"$MODEL\",
        \"voice_settings\": {
            \"stability\": $STABILITY,
            \"similarity_boost\": $SIMILARITY,
            \"style\": $STYLE
        }
    }" --output "$OUTFILE"

# Play through default audio output
if command -v afplay &>/dev/null; then
    afplay "$OUTFILE"
elif command -v mpv &>/dev/null; then
    mpv --no-video "$OUTFILE" 2>/dev/null
elif command -v aplay &>/dev/null; then
    ffmpeg -i "$OUTFILE" -f wav - 2>/dev/null | aplay -q
else
    echo "Error: No audio player found (need afplay, mpv, or aplay)" >&2
    exit 1
fi

rm -f "$OUTFILE"
