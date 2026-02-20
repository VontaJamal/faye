---
name: faye-voice
description: "Install and operate Faye voice for OpenClaw: always-on wake-word listener, ElevenLabs speech output, local dashboard/API profile manager, and service controls for macOS/Linux. Use when setting up voice sessions, managing wake-word profiles, hardening listener reliability, or troubleshooting voice flow between terminal and Telegram/OpenClaw."
---

# Faye Voice Skill

Faye gives an OpenClaw agent an always-on voice interface with custom wake words and profile switching.

## Capabilities

1. Always-on wake-word listener service
2. ElevenLabs TTS playback via local or remote speaker scripts
3. Local dashboard for profile management and one-click activation
4. Local API + SSE event stream for live status and wake/session events
5. Optional Telegram bridge service for OpenClaw command return path (`#faye_speak`)

## Setup

### 1. Install

```bash
./scripts/install.sh
```

### 2. Configure / Update

```bash
./scripts/faye setup
```

### 3. Open Dashboard

```bash
open http://127.0.0.1:4587
```

## Operations

### Profile Management

```bash
./scripts/faye profile list
./scripts/faye profile activate --id <profile-id>
./scripts/faye profile create --name "Desk" --voice-id "..." --voice-name "..." --wake-word "Faye Arise"
```

### Voice Playback

```bash
./scripts/speak.sh "Testing voice output"
./scripts/speak-remote.sh "Remote playback test"
```

### Health and Service Control

```bash
./scripts/faye doctor
./scripts/listener-control.sh status
./scripts/dashboard-control.sh status
./scripts/telegram-bridge-control.sh status
```

## Config Contracts

- Runtime config: `~/.openclaw/faye-runtime-config.json`
- Active legacy config: `~/.openclaw/faye-voice-config.json`
- ElevenLabs key: `~/.openclaw/secrets/elevenlabs-api-key.txt`
- Local event token: `~/.openclaw/secrets/faye-local-event-token.txt`

## API Contracts (Local only)

- `GET /v1/health`
- `GET /v1/profiles`
- `POST /v1/profiles`
- `PATCH /v1/profiles/:id`
- `DELETE /v1/profiles/:id`
- `POST /v1/profiles/:id/activate`
- `POST /v1/speak`
- `POST /v1/speak/test`
- `GET /v1/events`
- `POST /v1/listener/restart`
- `POST /v1/bridge/restart`

## Files

- `scripts/install.sh`
- `scripts/faye`
- `scripts/install-listener.sh`
- `scripts/install-dashboard.sh`
- `scripts/install-telegram-bridge.sh`
- `scripts/telegram-bridge-control.sh`
- `scripts/listener.sh`
- `scripts/speak.sh`
- `scripts/speak-remote.sh`
- `scripts/install-speaker.sh`
- `scripts/voice-picker.sh`
- `scripts/seven-shadow-test.sh`
- `.github/workflows/ci-quality.yml`
- `.github/workflows/seven-shadow-system.yml`
- `references/supported-voices.md`
- `references/troubleshooting.md`

- `references/openclaw-telegram-protocol.md`
- `references/reliability-slo.md`
- `references/seven-shadow-system.md`
- `governance/seven-shadow-system`
