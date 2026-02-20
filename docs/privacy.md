# Privacy (Local-First)

Faye is designed to run locally by default.

## What Stays Local

1. Runtime config and profile metadata in `~/.openclaw`.
2. Local dashboard/API traffic on `127.0.0.1`.
3. Listener and bridge runtime logs on your machine.

## What Can Leave Your Machine

1. Text sent to ElevenLabs when you request speech generation.
2. Telegram messages if Telegram bridge is enabled.

If Telegram is not configured, Telegram is not used.

## What Faye Does Not Do in V1

1. No cloud account system.
2. No hosted multi-tenant dashboard.
3. No default internet-exposed control API.

## User Controls

1. Disable Telegram integration by leaving token/chat fields empty.
2. Delete local profiles and secret files at any time.
3. Run `./scripts/faye doctor` to confirm local-only health.
