---
name: faye-voice
description: "Give your OpenClaw agent a real voice. Two-way voice interaction: agent speaks through any speaker via ElevenLabs TTS, and listens for a custom wake word via always-on mic detection. Use when: (1) setting up voice output for an agent, (2) configuring wake word detection, (3) enabling voice mode/sessions, (4) agent needs to speak responses aloud through speakers. Requires: ElevenLabs API key, macOS/Linux with sox installed, SSH access to target machine with speakers."
---

# FayeVoice — Give Your Agent a Voice

Voice interaction layer for OpenClaw agents. Your agent speaks through speakers and listens for a wake word.

## Capabilities

1. **Voice Output** — Agent generates speech via ElevenLabs TTS and plays through any connected speaker
2. **Wake Word Detection** — Always-on listener catches a custom phrase and activates voice mode
3. **Voice Sessions** — Trigger phrase activates two-way voice mode; agent responds via speaker, captures decisions in text after

## Setup

### 1. Install Dependencies (target machine with speakers)

```bash
# macOS
brew install sox ffmpeg

# Linux  
sudo apt install sox ffmpeg
```

### 2. Configure ElevenLabs

Store API key:
```bash
mkdir -p ~/.openclaw/secrets
echo "YOUR_API_KEY" > ~/.openclaw/secrets/elevenlabs-api-key.txt
```

### 3. Choose a Voice

Run `scripts/voice-picker.sh` to browse and audition ElevenLabs voices. Saves selection to `~/.openclaw/faye-voice-config.json`.

### 4. Install Wake Word Listener

Run `scripts/install-listener.sh` to:
- Copy listener script to target machine
- Configure wake word phrase
- Set up LaunchAgent (macOS) or systemd service (Linux) for auto-start
- Test mic input

### 5. Install Speaker Script

Run `scripts/install-speaker.sh` to:
- Copy speak script to target machine
- Test audio output through connected speaker
- Save SSH connection details for remote playback

## Usage

### Agent Speaks (from SKILL.md context)

When the agent needs to speak aloud:

1. Generate audio: POST to ElevenLabs TTS API with configured voice
2. Transfer to speaker machine: SCP the MP3 file
3. Play: `afplay` (macOS) or `aplay`/`mpv` (Linux)

Use `scripts/speak.sh "text to say"` on the target machine, or `scripts/speak-remote.sh "text"` from the agent's host.

### Wake Word Detection

The listener runs as a background service:
- Silently monitors mic input (zero API calls when quiet)
- When sound exceeds threshold, transcribes via ElevenLabs STT
- If wake word matches, sends activation message to configured Telegram/channel
- Then records follow-up message and sends transcription

### Voice Mode Protocol

1. User says wake word → listener sends activation to chat
2. Agent sees activation → responds with voice through speaker
3. Conversation continues: user texts, agent responds with text + voice
4. Agent captures key decisions/action items in text when session ends

## Configuration

`~/.openclaw/faye-voice-config.json`:
```json
{
  "elevenlabs_api_key_path": "~/.openclaw/secrets/elevenlabs-api-key.txt",
  "voice_id": "tVAXY8ApYcHIFjTH8kL0",
  "voice_name": "Rubi",
  "model": "eleven_multilingual_v2",
  "stability": 0.4,
  "similarity_boost": 0.8,
  "style": 0.7,
  "wake_word": "Faye Arise",
  "wake_word_variants": ["faye arise", "fate arise", "bay arise", "fay arise"],
  "speaker_host": "user@192.168.1.165",
  "speaker_ssh_key": "~/.ssh/id_ed25519",
  "silence_threshold": "0.5%",
  "telegram_bot_token_path": "~/.openclaw/secrets/telegram-bot-token.txt",
  "telegram_chat_id": ""
}
```

## File Reference

- `scripts/speak.sh` — Local TTS playback (run on speaker machine)
- `scripts/speak-remote.sh` — Remote TTS playback (run from agent host, SSH to speaker)
- `scripts/listener.sh` — Always-on wake word listener
- `scripts/install-listener.sh` — One-click listener setup
- `scripts/install-speaker.sh` — One-click speaker setup  
- `scripts/voice-picker.sh` — Browse and audition ElevenLabs voices
- `references/supported-voices.md` — Voice catalog and recommendations
- `references/troubleshooting.md` — Common issues (mic permissions, SSH, audio routing)
