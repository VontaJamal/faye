# Faye Agent Quickstart

Use this when another OpenClaw agent needs deterministic setup and recovery commands.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/VontaJamal/faye/main/scripts/bootstrap.sh | bash
```

## First 10-minute path

```bash
faye open
faye status
faye setup
faye first-success --json
```

Expected first-success signal:

- command output includes `"ok": true`
- install report exists under `.faye/reports/install-attempt-*.json`

## Fast operations

```bash
faye open
faye status
faye-open
faye-status
```

## Panic and reset safety

Panic Stop keeps dashboard online:

```bash
faye panic --confirm "PANIC STOP"
```

Factory Reset archives and wipes local state:

```bash
faye reset --confirm "FACTORY RESET"
```

Equivalent one-word aliases:

```bash
faye-panic --confirm "PANIC STOP"
faye-reset --confirm "FACTORY RESET"
```

## Machine-readable contract

See `agent-contract.json` for command aliases, API routes, and recovery guarantees.

## Prompt cache contract checks

Faye delegates prompt caching to OpenClaw runtimes. Validate contract artifacts before release:

```bash
./scripts/prompt-cache-contract-check.sh
```

Optional dependent runtime check:

```bash
./scripts/prompt-cache-contract-check.sh \
  --dependent-config "$HOME/.openclaw/openclaw-config.json" \
  --strict-dependent
```
