# Faye

Faye is a local-first, always-on voice layer for OpenClaw agents.

It listens for your custom wake word, sends wake/session events, and speaks responses aloud through ElevenLabs TTS.

## 3-Step Quick Start

This is the canonical 3-step onboarding flow.

1. `./scripts/install.sh`
2. Complete setup prompts (voice, wake word, API key)
3. Open [http://127.0.0.1:4587](http://127.0.0.1:4587)

That is the full install path.

## What You Get

- Always-on listener service (LaunchAgent on macOS, user systemd on Linux)
- Local dashboard for saved profiles and one-click activation
- Local API bound to `127.0.0.1` only
- Optional Telegram transport + always-on Telegram bridge for OpenClaw continuity
- Compatibility scripts for speaker install and remote playback

## Commands

- `./scripts/install.sh` — one-shot install/build/setup/services
- `./scripts/faye setup` — guided setup/update
- `./scripts/faye profile list|create|update|activate|delete`
- `./scripts/faye doctor` — dependency/config/service checks
- `./scripts/speak.sh "text"` — local TTS playback
- `./scripts/speak-remote.sh "text"` — remote speaker playback via SSH
- `./scripts/telegram-bridge-control.sh status|restart` — OpenClaw command return bridge

## Always-On Services

- Listener: `./scripts/listener-control.sh status|restart`
- Dashboard/API: `./scripts/dashboard-control.sh status|restart`
- Telegram bridge: `./scripts/telegram-bridge-control.sh status|restart`

After installation, all three services auto-start on login and restart on failure.

## Telegram Bridge

The Telegram bridge closes the timing loop between wake events and spoken responses:

1. Listener sends `#faye_wake` / `#faye_voice` events to Telegram.
2. OpenClaw responds with `#faye_speak ...`.
3. Bridge consumes `#faye_speak` in real time and triggers local speech automatically.

Protocol reference:
- `references/openclaw-telegram-protocol.md`

## Dashboard Capabilities

- Save and manage a collection of voice profiles
- One-click profile activation and listener reload
- One-click wake-word/profile updates through setup form
- Live event stream (`wake_detected`, `message_transcribed`, errors)
- Health panel for dependencies and service state

## Security and Reliability Baselines

- Secret files are written with `0600` permissions
- Listener/API are local-first with explicit local-only controls
- ElevenLabs/Telegram requests use timeout + retry behavior
- Structured logs with secret redaction
- Wake-word matching avoids regex injection patterns

## Seven Shadow Doctrine

This repository enforces a repeatable Seven Shadow gauntlet for releases:

1. Security
2. Accessibility
3. Testing
4. Execution
5. Scales
6. Value
7. Aesthetics

Run it with:

```bash
./scripts/seven-shadow-test.sh
```

Release gate: critical matrix must pass twice consecutively.

## Rinshari-UI Integration

Faye now consumes Rinshari doctrine via `design/rinshari-ui`.

Before UI changes, follow:
- `design/rinshari-ui/templates/design-preflight.md`
- `docs/site-soul-brief.md`
- `AGENTS.md` managed preflight block

## License

MIT
