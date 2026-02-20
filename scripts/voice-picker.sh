#!/bin/bash
# FayeVoice — Voice picker and config generator
# Browse ElevenLabs voices, audition them, save config
set -e

echo ""
echo "  FayeVoice — Voice Picker 🎙️"
echo "  ═══════════════════════════"
echo ""

# Get API key
read -p "  ElevenLabs API key: " API_KEY
if [ -z "$API_KEY" ]; then echo "  Need an API key"; exit 1; fi

# Save key
mkdir -p ~/.openclaw/secrets
echo "$API_KEY" > ~/.openclaw/secrets/elevenlabs-api-key.txt
echo "  ✅ API key saved"

# Fetch voices
echo ""
echo "  Fetching available voices..."
VOICES=$(curl -s "https://api.elevenlabs.io/v1/voices" -H "xi-api-key: $API_KEY")

echo ""
echo "  Female voices:"
echo "$VOICES" | python3 -c "
import sys,json
data = json.load(sys.stdin)
for i, v in enumerate(data['voices']):
    labels = v.get('labels', {})
    if labels.get('gender') == 'female':
        accent = labels.get('accent', '?')
        age = labels.get('age', '?')
        desc = labels.get('description', v.get('description', ''))
        print(f\"  {i+1:3d}. {v['name']:20s} | {accent:15s} | {age:12s} | {desc}\")
"

echo ""
read -p "  Enter voice number to audition (or 'q' to pick manually): " CHOICE

if [ "$CHOICE" != "q" ]; then
    # Get voice info
    VOICE_INFO=$(echo "$VOICES" | python3 -c "
import sys,json
data = json.load(sys.stdin)
v = data['voices'][int('$CHOICE')-1]
print(f\"{v['voice_id']}|{v['name']}\")
")
    VOICE_ID=$(echo "$VOICE_INFO" | cut -d'|' -f1)
    VOICE_NAME=$(echo "$VOICE_INFO" | cut -d'|' -f2)
    
    echo "  Generating audition for $VOICE_NAME..."
    AUDITION="/tmp/faye-audition.mp3"
    curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID" \
        -H "xi-api-key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"Hey there. This is what I sound like. Pretty nice, right? Let me know if I'm the one.\", \"model_id\": \"eleven_multilingual_v2\", \"voice_settings\": {\"stability\": 0.4, \"similarity_boost\": 0.8, \"style\": 0.7}}" \
        --output "$AUDITION"
    
    if command -v afplay &>/dev/null; then afplay "$AUDITION"
    elif command -v mpv &>/dev/null; then mpv --no-video "$AUDITION" 2>/dev/null
    fi
    rm -f "$AUDITION"
    
    read -p "  Use $VOICE_NAME? (y/n): " CONFIRM
    if [ "$CONFIRM" != "y" ]; then
        echo "  Run again to pick a different voice"
        exit 0
    fi
else
    read -p "  Enter voice ID: " VOICE_ID
    read -p "  Enter voice name: " VOICE_NAME
fi

# Wake word
echo ""
read -p "  Wake word (default: Faye Arise): " WAKE_WORD
WAKE_WORD="${WAKE_WORD:-Faye Arise}"

# Telegram config
echo ""
read -p "  Telegram bot token (optional, press Enter to skip): " BOT_TOKEN
if [ -n "$BOT_TOKEN" ]; then
    echo "$BOT_TOKEN" > ~/.openclaw/secrets/telegram-bot-token.txt
fi
read -p "  Telegram chat ID (optional): " CHAT_ID

# Generate config
CONFIG="$HOME/.openclaw/faye-voice-config.json"
python3 -c "
import json
config = {
    'elevenlabs_api_key_path': '~/.openclaw/secrets/elevenlabs-api-key.txt',
    'voice_id': '$VOICE_ID',
    'voice_name': '$VOICE_NAME',
    'model': 'eleven_multilingual_v2',
    'stability': 0.4,
    'similarity_boost': 0.8,
    'style': 0.7,
    'wake_word': '$WAKE_WORD',
    'wake_word_variants': ['${WAKE_WORD,,}'],
    'speaker_host': '',
    'speaker_ssh_key': '~/.ssh/id_ed25519',
    'silence_threshold': '0.5%',
    'telegram_bot_token_path': '~/.openclaw/secrets/telegram-bot-token.txt' if '$BOT_TOKEN' else '',
    'telegram_chat_id': '$CHAT_ID'
}
with open('$CONFIG', 'w') as f:
    json.dump(config, f, indent=2)
print(f'  ✅ Config saved to $CONFIG')
"

echo ""
echo "  FayeVoice configured! Next: run install-listener.sh"
echo ""
