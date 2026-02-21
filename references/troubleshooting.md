# Faye Troubleshooting

Use this page when setup or voice flow is not working.

## Quick Recovery (Try This First)

```bash
./scripts/preflight.sh
./scripts/listener-control.sh restart
./scripts/dashboard-control.sh restart
./scripts/telegram-bridge-control.sh restart
./scripts/faye doctor
./scripts/faye first-success --json
```

If `doctor` returns `"ok": true`, try your wake flow again.
If `first-success` returns `"ok": false`, attach the generated `.faye/reports/install-attempt-*.json` report when filing an issue.
If dashboard checklist is below `4/4`, use the failing checklist item as your next fix target.

## Dashboard Checklist Recovery

Open:

- `http://127.0.0.1:4587`

Fix by checklist item:

1. Services ready
   - Restart listener/dashboard/bridge controls.
2. API key ready
   - Ensure `~/.openclaw/secrets/elevenlabs-api-key.txt` exists and is `0600`.
3. Profile configured
   - Re-run `./scripts/faye setup` and confirm voice + wake word values.
4. Voice test passed
   - Use dashboard `Test Voice` and confirm audible output.

## Install Fails

Problem:
- `install.sh` exits early with missing dependency message.

Fix:
1. Install the missing dependency.
2. Re-run `./scripts/install.sh`.

Common dependency:
- `rec` from SoX
- macOS: `brew install sox`
- Linux: `sudo apt install sox`

## Setup Fails

Problem:
- setup returns validation or profile errors.

Fix:
1. Re-run setup:
```bash
./scripts/faye setup
```
2. Ensure voice ID and voice name are set.
3. Ensure ElevenLabs API key is valid.

## Dashboard Won't Open

Problem:
- `http://127.0.0.1:4587` is unreachable.

Fix:

```bash
./scripts/dashboard-control.sh status
./scripts/dashboard-control.sh restart
```

Expected status:
- `dashboard: running`

## Wake Word Detected But No Follow-up

Problem:
- wake event is detected but speech loop does not continue.

Fix checklist:

1. Confirm listener service:
```bash
./scripts/listener-control.sh status
```
2. Confirm bridge service (if using Telegram):
```bash
./scripts/telegram-bridge-control.sh status
```
3. Confirm dashboard live events are updating.
4. Confirm active profile wake word matches what you say.
5. Open the Conversation Session panel and inspect:
   - turn progress,
   - session status,
   - end reason (`idle_timeout`, `explicit_user_stop`, `agent_timeout`, `max_turns_reached`, `external_stop`).

If the session is stuck, end it manually from dashboard or API:

```bash
curl -s -X POST http://127.0.0.1:4587/v1/conversation/<session_id>/end \
  -H "Content-Type: application/json" \
  -d '{"reason":"manual_recovery"}'
```

Then trigger wake word again.

## Telegram Bridge Delays or Misses

Problem:
- messages appear in Telegram, speech triggers late or not at all.

Fix:

1. Restart bridge:
```bash
./scripts/telegram-bridge-control.sh restart
```
2. Send manual test command in Telegram:
```text
#faye_speak text=Bridge test
```
3. Check logs:
- `~/.openclaw/faye-voice/telegram-bridge.log`
- `~/.openclaw/faye-voice/telegram-bridge-error.log`
4. Open dashboard status panel and inspect bridge runtime:
- state
- consecutive errors
- backoff
- last command status

For action commands, expected safety behavior:

1. Low-risk actions (`health_summary`, `voice_test`) execute directly.
2. Impactful actions (`listener_restart`, `bridge_restart`) require `confirm=yes`.
3. If confirm is missing, bridge returns:
   - `#faye_action_result ... status=needs_confirm reason=confirm_required`

## No Audio Playback

Problem:
- commands run but no sound.

Fix:

1. Run:
```bash
./scripts/speak.sh "Audio test"
```
2. Ensure one player exists: `afplay`, `mpv`, or `ffplay`.
3. Verify system audio output device.

## API Key / Permission Problems

Problem:
- key missing, unauthorized, or read failure.

Fix:

1. Check key file exists:
- `~/.openclaw/secrets/elevenlabs-api-key.txt`
2. Check permission mode is `0600`.
3. Re-run setup.

## Remote Speaker Issues

Problem:
- remote speech path fails.

Fix:

1. Test SSH:
```bash
ssh -i ~/.ssh/id_ed25519 user@host "echo ok"
```
2. Test remote speech:
```bash
./scripts/speak-remote.sh "Remote voice test"
```

## Release/Share Readiness Check

Before sharing to new users:

```bash
./scripts/seven-shadow-test.sh 2
npm run soak:conversation -- --sessions=20 --turns=4 --json
```

Expected:
- `All Seven Shadow runs passed (2/2).`
- conversation soak report shows `"pass": true`.

## Attach These Reports In Bug Issues

1. Latest `.faye/reports/install-attempt-*.json`
2. `.faye/reports/ui-kpi.json`
3. Latest `.faye/reports/conversation-soak-*.json` for loop reliability/action issues
