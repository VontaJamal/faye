# Prompt Cache Prefix Stability Audit (2026-02-21)

## Scope
Audit the Faye-to-OpenClaw integration assumptions for prompt cache prefix stability.

Faye does not build OpenAI request payloads directly. This audit enforces the contract language and integration assumptions Faye publishes for OpenClaw consumers.

## Files Reviewed
- `/Users/vonta/Documents/Code Repos/faye/references/shadow-prompt-caching-v1.md`
- `/Users/vonta/Documents/Code Repos/faye/references/openclaw-prompt-caching-config.example.json`
- `/Users/vonta/Documents/Code Repos/faye/docs/openclaw-second-install.md`
- `/Users/vonta/Documents/Code Repos/faye/references/openclaw-telegram-protocol.md`

## Keep Decisions
- Keep OpenClaw as the prompt-cache execution layer.
- Keep stable-prefix doctrine explicit in repo-level contract docs.
- Keep in-memory retention as default and require explicit 24-hour opt-in.
- Keep telemetry schema normalized for cross-repo observability (`cachedInputTokens`, `inputTokens`, `cacheHitRate`, `effectiveInputCost`).

## Change Decisions
- Add machine-readable config example for `agents.defaults.promptCaching` contract keys.
- Add contract gate script (`scripts/prompt-cache-contract-check.sh`) and bind it to Seven Shadow gauntlet.
- Add reusable smoke test template (`scripts/prompt-cache-smoke.sh`) for repos with direct LLM calls.
- Add baseline measurement utility (`scripts/prompt-cache-baseline.mjs`) for before/after cost and latency comparisons.

## Volatile Metadata Policy
Volatile fields must remain out of cache-sensitive prefixes:
- `message_id`
- `reply_to_id`
- `sender_id`
- per-turn nonce
- per-turn timestamp

These fields may exist in user-role contextual metadata but not in deterministic prompt-prefix segments used for caching.

## Result
Pass.

Faye now carries explicit, testable prompt cache contract artifacts and release gates while preserving its control-plane role.
