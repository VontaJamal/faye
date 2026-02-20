# Faye Public Alpha Kit

This page is for first-time users.

Goal: get a new person from zero to first successful voice session quickly.

## Before You Start

You need:

- macOS or Linux
- `node`, `npm`, `python3`, `curl`, `rec` (SoX)

If `rec` is missing:

- macOS: `brew install sox`
- Linux: `sudo apt install sox`

## 5-Minute Setup

One-liner option:

```bash
curl -fsSL https://raw.githubusercontent.com/VontaJamal/faye/main/scripts/bootstrap.sh | bash
```

Manual path:

1. Install:
```bash
./scripts/install.sh
```
Success signal:
- `Dependencies OK`
- `Install complete. Open: http://127.0.0.1:4587`

2. Setup profile:
```bash
./scripts/faye setup
```
Success signal:
- `Configured profile ...`

3. Open dashboard:

[http://127.0.0.1:4587](http://127.0.0.1:4587)

4. Verify system health:
```bash
./scripts/faye doctor
```
Success signal:
- JSON shows `"ok": true`

5. Verify speech output:
```bash
./scripts/speak.sh "Faye alpha test"
```
Success signal:
- You hear audio playback.

## Always-On Check

Run:

```bash
./scripts/listener-control.sh status
./scripts/dashboard-control.sh status
./scripts/telegram-bridge-control.sh status
```

Expected:
- `listener: running`
- `dashboard: running`
- `telegram-bridge: running` (if Telegram was configured)

## First Wake Session Test

1. Say your wake word.
2. Speak a short message after wake detection.
3. Confirm live events in dashboard update.
4. If using Telegram bridge, confirm `#faye_speak` commands result in speech output.

## If Something Fails

Use:

- `references/troubleshooting.md`

Most common fixes:

1. Restart listener and bridge.
2. Re-run `./scripts/faye setup`.
3. Confirm API key file exists and permissions are `0600`.

## Share With New Users

For public testing, share these three links/paths:

1. `README.md`
2. `docs/public-alpha-kit.md`
3. `references/troubleshooting.md`

Feedback and tester threads:

1. `https://github.com/VontaJamal/faye/issues/1`
2. `https://github.com/VontaJamal/faye/issues/2`
