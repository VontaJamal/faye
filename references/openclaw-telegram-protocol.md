# OpenClaw <-> Faye Telegram Protocol

This protocol is used to reduce delayed/missed response timing between wake detection and spoken replies.

## Events sent by Faye listener

1. Wake detected
- `#faye_wake session=<session-id> wake_word=<wake-word>`

2. User follow-up message
- `#faye_voice session=<session-id> turn=<turn-number> text=<transcribed-text>`

## Commands accepted by Faye Telegram bridge

1. Speak response (recommended)
- `#faye_speak session=<session-id> text=<assistant-response>`

2. Speak response (simple)
- `#faye_speak <assistant-response>`

3. Activate profile
- `#faye_profile_activate id=<profile-id>`

4. Liveness check
- `#faye_ping`

5. Action command (safe mode)
- `#faye_action name=<health_summary|voice_test|listener_restart|bridge_restart> [session=<session-id>] [confirm=yes]`

## Acknowledgements sent by Faye bridge

- Success: `#faye_spoken status=ok [session=<session-id>]`
- Failure: `#faye_spoken status=error [session=<session-id>]`
- Ping response: `#faye_pong status=online`
- Action response: `#faye_action_result name=<action> status=ok|error|needs_confirm reason=<code> [session=<session-id>]`

## Timing guidance

- OpenClaw should emit `#faye_speak` immediately after processing `#faye_voice`.
- Keep one active session per conversation thread for deterministic playback.
- Faye listener uses a bounded loop by default:
  - starts at 8 turns,
  - auto-extends by 4 when user keeps talking,
  - hard-caps at 16 turns.
- Faye runs a local watchdog for each session:
  - waits for `#faye_speak` after wake/message,
  - auto-retries one `#faye_voice` send if timeout occurs,
  - emits `session_timeout` event if response still does not arrive.
- Impactful actions (`listener_restart`, `bridge_restart`) require `confirm=yes`; otherwise response is `status=needs_confirm`.
