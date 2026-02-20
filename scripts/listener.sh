#!/bin/bash
# FayeVoice — Always-on wake word listener
# Monitors mic, detects wake word, sends to Telegram
# Zero API calls when room is quiet
set -e
export PATH=/opt/homebrew/bin:/usr/local/bin:/bin:/usr/bin:$PATH

CONFIG="${FAYE_VOICE_CONFIG:-$HOME/.openclaw/faye-voice-config.json}"

if [ ! -f "$CONFIG" ]; then
    echo "Error: Config not found at $CONFIG" >&2
    exit 1
fi

# Load config
API_KEY=$(python3 -c "
import json,os
c = json.load(open('$CONFIG'))
p = os.path.expanduser(c['elevenlabs_api_key_path'])
print(open(p).read().strip())
")
BOT_TOKEN=$(python3 -c "
import json,os
c = json.load(open('$CONFIG'))
p = os.path.expanduser(c.get('telegram_bot_token_path',''))
print(open(p).read().strip()) if p else print('')
" 2>/dev/null || echo "")
CHAT_ID=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('telegram_chat_id',''))")
WAKE_WORD=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('wake_word','Faye Arise'))")
VARIANTS=$(python3 -c "
import json
c = json.load(open('$CONFIG'))
v = c.get('wake_word_variants', [c.get('wake_word','faye arise').lower()])
print('|'.join(v))
")
THRESHOLD=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('silence_threshold','0.5%'))")

TMPDIR="/tmp/faye-listener"
mkdir -p "$TMPDIR"

echo ""
echo "  ═══════════════════════════════════════"
echo "  FayeVoice - Always Listening 🎙️"
echo "  Wake word: \"$WAKE_WORD\""
echo "  ═══════════════════════════════════════"
echo ""
echo "  Listening... (silent until you speak)"
echo ""

while true; do
    CLIP="$TMPDIR/wake-check.wav"
    
    # Record only when sound detected above threshold
    rec -q "$CLIP" rate 16k channels 1 \
        silence 1 0.2 $THRESHOLD \
        1 1.0 $THRESHOLD \
        trim 0 5 \
        2>/dev/null
    
    # Skip empty/tiny clips
    if [ ! -s "$CLIP" ]; then continue; fi
    SIZE=$(stat -f%z "$CLIP" 2>/dev/null || stat -c%s "$CLIP" 2>/dev/null || echo 0)
    if [ "$SIZE" -lt 10000 ]; then rm -f "$CLIP"; continue; fi
    
    # Transcribe
    TRANSCRIPT=$(curl -s -X POST "https://api.elevenlabs.io/v1/speech-to-text" \
        -H "xi-api-key: $API_KEY" \
        -F "file=@$CLIP" \
        -F "model_id=scribe_v1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('text',''))" 2>/dev/null)
    rm -f "$CLIP"
    
    LOWER=$(echo "$TRANSCRIPT" | python3 -c "import sys; print(sys.stdin.read().strip().lower())" 2>/dev/null)
    echo "  [heard: $LOWER]"
    
    # Check wake word variants
    PATTERN=$(echo "$VARIANTS" | sed 's/|/.{0,5}|/g; s/$/.{0,5}/')
    if echo "$LOWER" | grep -qiE "$VARIANTS"; then
        echo "  ✨ Wake word detected!"
        
        # Send to Telegram
        if [ -n "$BOT_TOKEN" ] && [ -n "$CHAT_ID" ]; then
            curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
                -d "chat_id=${CHAT_ID}" \
                -d "text=${WAKE_WORD}" > /dev/null 2>&1
        fi
        
        # Listen for follow-up message
        echo "  🎙️ Listening for your message..."
        MSG_CLIP="$TMPDIR/message.wav"
        rec -q "$MSG_CLIP" rate 16k channels 1 \
            silence 1 0.3 $THRESHOLD \
            1 2.0 $THRESHOLD \
            trim 0 30 \
            2>/dev/null
        
        if [ -s "$MSG_CLIP" ]; then
            MSG_SIZE=$(stat -f%z "$MSG_CLIP" 2>/dev/null || stat -c%s "$MSG_CLIP" 2>/dev/null || echo 0)
            if [ "$MSG_SIZE" -gt 10000 ]; then
                MSG_TEXT=$(curl -s -X POST "https://api.elevenlabs.io/v1/speech-to-text" \
                    -H "xi-api-key: $API_KEY" \
                    -F "file=@$MSG_CLIP" \
                    -F "model_id=scribe_v1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('text',''))" 2>/dev/null)
                
                if [ -n "$MSG_TEXT" ]; then
                    echo "  You: $MSG_TEXT"
                    if [ -n "$BOT_TOKEN" ] && [ -n "$CHAT_ID" ]; then
                        curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
                            -d "chat_id=${CHAT_ID}" \
                            -d "text=🎙️ ${MSG_TEXT}" > /dev/null 2>&1
                    fi
                fi
            fi
            rm -f "$MSG_CLIP"
        fi
        
        echo "  🔁 Listening again..."
        echo ""
    fi
done
