# Always-On Proof (No Terminal Flow)

Goal: prove Faye runs after reboot/login without opening a terminal.

## Step 1: Install services

```bash
./scripts/install.sh
```

## Step 2: Reboot and log in

1. Reboot your machine.
2. Log back into your normal user account.
3. Do not open Terminal yet.

## Step 3: Validate behavior

1. Open browser to `http://127.0.0.1:4587`.
2. Confirm dashboard loads.
3. Confirm status shows listener/dashboard running.
4. Say wake word and verify event appears.
5. Send a Telegram `#faye_speak` command (if Telegram is enabled) and verify local speech.

## Step 4: Capture proof report

Run:

```bash
./scripts/always-on-proof.sh
```

This writes a timestamped report to `.faye/reports/`.

## Pass Criteria

1. Dashboard reachable without manual start command.
2. Listener status reports running.
3. Bridge status reports running when Telegram is configured.
4. Wake and speak flows both work after reboot/login.
