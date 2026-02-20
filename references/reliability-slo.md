# Reliability SLOs and Runbook (Alpha)

This document defines practical SLO targets and operational responses for Faye.

## Service SLO Targets

1. Listener Availability
- Target: 99.5% monthly user-session availability.
- Error budget: ~3h 39m per month.

2. Bridge Command Latency (`#faye_speak` to local playback start)
- Target: p95 <= 2.5s on healthy local network.
- Target: p99 <= 5.0s.

3. Wake-to-First-Reply Flow Success
- Target: >= 98% successful flow completion across 7-day rolling window.

## SLIs

1. Service status checks
- `listener-control.sh status`
- `dashboard-control.sh status`
- `telegram-bridge-control.sh status`

2. Event consistency
- `#faye_wake` emitted
- `#faye_voice` emitted
- `#faye_speak` received
- `#faye_spoken status=ok` returned

3. Error signals
- `listener-error.log`
- `telegram-bridge-error.log`
- API `E_*` error rates
- Bridge runtime telemetry from `/v1/health` -> `bridgeRuntime`

## Incident Response Levels

1. SEV-1 (core voice unusable)
- Listener and/or bridge down continuously.
- Action: restart all services and validate end-to-end with manual bridge command.

2. SEV-2 (degraded timing/reliability)
- Frequent delayed speech responses.
- Action: inspect bridge offset state and Telegram command ordering.

3. SEV-3 (non-blocking)
- Intermittent profile UI failures with CLI fallback available.

## Standard Recovery Steps

1. Restart services
```bash
./scripts/listener-control.sh restart
./scripts/dashboard-control.sh restart
./scripts/telegram-bridge-control.sh restart
```

2. Validate health
```bash
./scripts/faye doctor
curl -s http://127.0.0.1:4587/v1/health
```

3. Validate Telegram command path
- In Telegram send: `#faye_speak text=bridge smoke test`
- Expect: local playback and `#faye_spoken status=ok`

4. If bridge loops unexpectedly
- Inspect `~/.openclaw/faye-voice/telegram-bridge-offset.txt`
- Verify chat id/token in active profile config.

## Release Readiness Gate

Do not tag release unless all are true:
- `./scripts/seven-shadow-test.sh 2` passes
- `npm audit --audit-level=high` passes
- Manual bridge smoke test passes
- Canary smoke workflow (`.github/workflows/hourly-canary.yml`) is green
