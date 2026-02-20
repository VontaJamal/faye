# OpenClaw <-> Faye Telegram Protocol

This protocol is used to reduce delayed/missed response timing between wake detection and spoken replies.

## Events sent by Faye listener

1. Wake detected
- `#faye_wake session=<session-id> wake_word=<wake-word>`

2. User follow-up message
- `#faye_voice session=<session-id> text=<transcribed-text>`

## Commands accepted by Faye Telegram bridge

1. Speak response (recommended)
- `#faye_speak session=<session-id> text=<assistant-response>`

2. Speak response (simple)
- `#faye_speak <assistant-response>`

3. Activate profile
- `#faye_profile_activate id=<profile-id>`

4. Liveness check
- `#faye_ping`

## Acknowledgements sent by Faye bridge

- Success: `#faye_spoken status=ok [session=<session-id>]`
- Failure: `#faye_spoken status=error [session=<session-id>]`
- Ping response: `#faye_pong status=online`

## Timing guidance

- OpenClaw should emit `#faye_speak` immediately after processing `#faye_voice`.
- Keep one active session per conversation thread for deterministic playback.
- Faye runs a local watchdog for each session:
  - waits for `#faye_speak` after wake/message,
  - auto-retries one `#faye_voice` send if timeout occurs,
  - emits `session_timeout` event if response still does not arrive.
