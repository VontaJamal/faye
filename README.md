# Faye 🎙️

**Have your own OpenClaw bot arise and speak to you. One click.**

> Named after Glenda Faye McPhail.

---

Say a word into the air. Your AI talks back through your speaker. That's it.

## What It Does

- 🗣️ **Your AI speaks** — ElevenLabs TTS through any connected speaker
- 🎙️ **Always listening** — Wake word detection catches your trigger phrase
- 🔇 **Zero cost when quiet** — Only uses API credits when you actually speak
- 🔁 **Two-way voice sessions** — You talk, your AI responds. Out loud. In your room.

## Quick Start

```bash
# Install the skill
openclaw skills install faye

# Pick your voice
./scripts/voice-picker.sh

# Start the listener
./scripts/install-listener.sh
```

Say your wake word. Hear your AI respond. That's it.

## How It Works

1. **Listener** monitors your mic (zero API calls in silence)
2. **Sound detected** → transcribes with ElevenLabs STT
3. **Wake word matched** → sends to your OpenClaw bot via Telegram
4. **Bot responds** → generates voice with ElevenLabs TTS → plays through your speaker

## Requirements

- macOS or Linux
- [OpenClaw](https://github.com/openclaw/openclaw) agent
- [ElevenLabs](https://elevenlabs.io) API key ($5/mo starter plan works)
- `sox` and `ffmpeg` (`brew install sox ffmpeg`)
- Any Bluetooth or wired speaker

## Configuration

Run `voice-picker.sh` to interactively:
- Choose from 100+ ElevenLabs voices
- Set your custom wake word
- Configure Telegram integration
- Test your mic and speakers

Config saves to `~/.openclaw/faye-voice-config.json`.

## The Story

Faye started as a personal project — an AI agent named after my late aunt, Glenda Faye McPhail. She needed a voice. What started with a JBL speaker became something that could change how every human talks to AI.

So we open-sourced it. One genius idea, given to the world.

---

*"Say the word. She speaks."*

## License

MIT

## Creator

[@VontaJamal](https://github.com/VontaJamal)
