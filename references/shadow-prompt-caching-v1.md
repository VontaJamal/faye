# Shadow Prompt Caching v1 Contract

## Purpose
This contract standardizes prompt caching behavior across Shadow-theme repositories.

Faye is a voice/control-plane layer and does not issue OpenAI LLM requests directly. OpenClaw is the execution layer for prompt caching behavior.

## Scope
- OpenClaw-first rollout.
- OpenAI Responses API first.
- Default retention is in-memory.
- Optional 24-hour retention only by explicit opt-in.

## Contract Keys
Place these keys under `agents.defaults.promptCaching` in the runtime config:

- `enabled`: `boolean`
- `retentionDefault`: `"in_memory" | "24h"`
- `keyStrategy`: `"session_stable_v1"`
- `saltEnvVar`: `string` (environment variable name for HMAC salt)
- `forceResponsesStore`: `boolean`

Reference example:
- `/Users/vonta/Documents/Code Repos/faye/references/openclaw-prompt-caching-config.example.json`

## Key Strategy: session_stable_v1
The cache key material should be deterministic and hashed (HMAC) with the configured salt env var.

Recommended key material:
- provider id
- model family
- agent id
- workspace id hash
- tool schema hash
- system prompt revision
- stable session key

Security rule:
- Never send raw user id, raw session id, raw channel ids, or raw secrets in `prompt_cache_key`.

## Prefix Stability Rules
Keep cache-sensitive prefixes deterministic:
- fixed section ordering in system prompt
- deterministic tool schema ordering
- deterministic bootstrap content ordering

Keep volatile fields out of cache-sensitive prefixes:
- per-turn timestamps
- message ids
- reply ids
- sender ids
- per-turn nonce values

Faye audit record:
- `/Users/vonta/Documents/Code Repos/faye/docs/audits/2026-02-21-prompt-cache-prefix-stability.md`

## Telemetry Schema
Use normalized fields for cross-repo reporting:
- `cachedInputTokens`
- `inputTokens`
- `cacheHitRate`
- `effectiveInputCost`

## Commands
- Contract check:
  - `./scripts/prompt-cache-contract-check.sh`
- Prompt cache smoke test template:
  - `./scripts/prompt-cache-smoke.sh`
- Baseline collector:
  - `node ./scripts/prompt-cache-baseline.mjs`

## Downstream Integration Checklist
For repos with direct LLM calls:

1. Add contract gate in CI:
   - `./scripts/prompt-cache-contract-check.sh`
2. Add smoke check in release pipeline:
   - `./scripts/prompt-cache-smoke.sh`
3. Capture baseline report before and after rollout:
   - `node ./scripts/prompt-cache-baseline.mjs --runs 6`
4. Track normalized telemetry fields in reports/dashboards:
   - `cachedInputTokens`
   - `inputTokens`
   - `cacheHitRate`
   - `effectiveInputCost`

## Optional Dependent Config Validation
If a local OpenClaw runtime config exists, validate it directly:

```bash
./scripts/prompt-cache-contract-check.sh \
  --dependent-config "$HOME/.openclaw/openclaw-config.json" \
  --strict-dependent
```

## Rollout Order
1. OpenClaw dev opt-in.
2. Canary agents.
3. Default-on for OpenAI Responses paths.
4. Propagate contract and smoke checks into consumer repos.
