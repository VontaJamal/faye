# OpenClaw Second Install

This is the canonical path for turning a fresh OpenClaw machine into an always-on Faye machine.

## Goal

Reach first voice success in one flow:

1. Install Faye.
2. Set profile + key + wake word.
3. Pass the dashboard first-success checklist.
4. Hear voice output in under 10 minutes.

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

## 5. Dashboard 10-minute checklist

Open:

- `http://127.0.0.1:4587`

Complete all checklist items:

1. Services ready
2. API key ready (active key exists + `0600`)
3. Profile configured
4. Voice test passed

When checklist shows `4/4`, you are in first-success state.

## 6. Collect adoption KPI snapshot

```bash
node ./scripts/install-kpi.mjs --json
```

UX onboarding KPI (local only):

- `.faye/reports/ui-kpi.json`

## Failure recovery

1. Run `./scripts/preflight.sh`.
2. Run `./scripts/faye doctor`.
3. Attach latest `.faye/reports/install-attempt-*.json` and `.faye/reports/ui-kpi.json` when filing issues.
