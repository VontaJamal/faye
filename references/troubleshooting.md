# Faye Troubleshooting

## Listener Not Running

Check service status:

```bash
./scripts/listener-control.sh status
```

If stopped:

```bash
./scripts/listener-control.sh restart
```

## Dashboard/API Not Running

```bash
./scripts/dashboard-control.sh status
./scripts/dashboard-control.sh restart
```

Open [http://127.0.0.1:4587](http://127.0.0.1:4587).

## Wake Word Detected But No Follow-Up Behavior

1. Confirm listener is emitting events in dashboard `Live Events`.
2. Verify Telegram mode is configured only if OpenClaw flow depends on it.
3. Confirm wake events appear as `#faye_wake session=...` and `#faye_voice session=...` in Telegram.
4. Confirm bridge service is running:

```bash
./scripts/telegram-bridge-control.sh status
```

5. Verify OpenClaw replies with `#faye_speak ...` commands (see `references/openclaw-telegram-protocol.md`).
6. Verify active profile and wake word in dashboard match what you speak.

## No Audio Playback

Test direct output:

```bash
./scripts/speak.sh "Audio test"
```

If this fails, ensure one of `afplay`, `mpv`, or `ffplay` is installed and the correct output device is selected.

## API Key / Permission Errors

- Check file exists: `~/.openclaw/secrets/elevenlabs-api-key.txt`
- Check mode is `0600`
- Re-run setup: `./scripts/faye setup`

## Remote Speaker Issues

- Confirm `speaker_host` and `speaker_ssh_key` in `~/.openclaw/faye-voice-config.json`
- Test SSH directly:

```bash
ssh -i ~/.ssh/id_ed25519 user@host "echo ok"
```

- Then test remote speech:

```bash
./scripts/speak-remote.sh "Remote voice test"
```

## Run Full Gauntlet

Before publishing:

```bash
./scripts/seven-shadow-test.sh
```

This runs build/tests, accessibility baseline checks, and docs contract checks twice.

## Bridge Timing Diagnostics

If Telegram messages arrive but speech is delayed:

1. Restart bridge and listener:
```bash
./scripts/telegram-bridge-control.sh restart
./scripts/listener-control.sh restart
```
2. Send a manual command in Telegram:
```text
#faye_speak text=Quick bridge test
```
3. If this fails, check logs:
- `~/.openclaw/faye-voice/telegram-bridge.log`
- `~/.openclaw/faye-voice/telegram-bridge-error.log`
