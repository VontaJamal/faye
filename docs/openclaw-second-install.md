# OpenClaw Second Install

This is the canonical path for turning a fresh OpenClaw machine into an always-on Faye machine.

## Goal

Reach first success in one flow:

1. Install Faye.
2. Confirm services are up.
3. Run first-success validation.

## 1. Bootstrap install

```bash
curl -fsSL https://raw.githubusercontent.com/VontaJamal/faye/main/scripts/bootstrap.sh | bash
```

## 2. Run preflight explicitly (optional but recommended)

```bash
./scripts/preflight.sh
```

## 3. Configure profile

```bash
./scripts/faye setup
```

For non-interactive automation:

```bash
./scripts/faye setup --non-interactive \
  --profile-name "Primary Voice" \
  --voice-id "<elevenlabs_voice_id>" \
  --voice-name "Primary" \
  --wake-word "Faye Arise" \
  --api-key "<elevenlabs_api_key>"
```

## 4. Validate first success

```bash
./scripts/faye first-success --json
```

Expected:

1. `"ok": true` in command output.
2. A report path under `.faye/reports/install-attempt-*.json`.

## 5. Collect adoption KPI snapshot

```bash
node ./scripts/install-kpi.mjs --json
```

## Failure recovery

1. Run `./scripts/preflight.sh`.
2. Run `./scripts/faye doctor`.
3. Attach latest `.faye/reports/install-attempt-*.json` when filing issues.
