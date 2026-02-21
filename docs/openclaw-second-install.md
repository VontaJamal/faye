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

- `faye open` (or `faye-open`)
- fallback: `http://127.0.0.1:4587`

Complete all checklist items:

1. Services ready
2. API key ready (active key exists + `0600`)
3. Profile configured
4. Voice test passed

When checklist shows `4/4`, you are in first-success state.

## 6. Conversational light loop (post-activation)

Open:

- `http://127.0.0.1:4587`

Use the **Conversation Session** panel to verify:

1. active session state,
2. turn progress (`8` base turns, auto-extend by `4`, hard cap `16`),
3. retained turn history for current context window (`15` minutes),
4. emergency session end control.

API checks:

```bash
curl -s http://127.0.0.1:4587/v1/health | jq '.conversation'
curl -s http://127.0.0.1:4587/v1/conversation/active | jq '.session'
curl -s http://127.0.0.1:4587/v1/conversation/<session_id> | jq '.session'
curl -s "http://127.0.0.1:4587/v1/conversation/<session_id>/context?limit=8&includePending=true" | jq '.context'
curl -s -X POST http://127.0.0.1:4587/v1/conversation/<session_id>/end -H 'Content-Type: application/json' -d '{"reason":"external_stop"}'
```

## 7. Collect adoption KPI snapshot

```bash
node ./scripts/install-kpi.mjs --json
```

UX onboarding KPI (local only):

- `.faye/reports/ui-kpi.json`

## 8. Prompt cache readiness (OpenClaw-first)

Faye does not send OpenAI LLM requests directly. Prompt cache behavior is enforced in OpenClaw runtimes that Faye integrates with.

Run contract checks in this repo:

```bash
./scripts/prompt-cache-contract-check.sh
```

If you have an OpenClaw runtime config available locally, validate the dependent contract too:

```bash
./scripts/prompt-cache-contract-check.sh \
  --dependent-config "$HOME/.openclaw/openclaw-config.json" \
  --strict-dependent
```

For repos that call LLM endpoints directly, run the reusable smoke test:

```bash
./scripts/prompt-cache-smoke.sh
```

Baseline collector (before/after rollout):

```bash
node ./scripts/prompt-cache-baseline.mjs --runs 6
```

## Panic and reset recovery

Use these no-risk controls when onboarding gets stuck:

1. Panic Stop (keeps dashboard up):

```bash
faye panic --confirm "PANIC STOP"
```

2. Factory Reset (full clean start, archive first):

```bash
faye reset --confirm "FACTORY RESET"
```

Dashboard equivalent: **Recovery & Panic** panel.

## Failure recovery

1. Run `./scripts/preflight.sh`.
2. Run `faye status`.
3. Run `./scripts/faye doctor`.
4. Attach latest `.faye/reports/install-attempt-*.json` and `.faye/reports/ui-kpi.json` when filing issues.
