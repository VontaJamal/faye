# Threat Model (V1)

This model covers local-first Faye on macOS/Linux.

## Trust Boundaries

1. Local host boundary:
- API listens on `127.0.0.1` only.
- Dashboard talks to local API only.

2. Secret boundary:
- API key and Telegram token stored in local secret files.

3. External service boundary:
- ElevenLabs API calls.
- Telegram Bot API calls (optional).

## Primary Threats and Mitigations

1. Accidental secret exposure:
- Mitigation: secret files use `0600`.
- Mitigation: setup uses hidden terminal prompts for keys.

2. Local command abuse from non-loopback callers:
- Mitigation: loopback-only middleware on `/v1/*`.
- Mitigation: deny forwarded headers for local routes.

3. Telegram replay/duplicate command behavior:
- Mitigation: idempotency key store for processed commands.
- Mitigation: offset persistence and runtime telemetry state.

4. Injection via wake-word/bridge parsing:
- Mitigation: strict parsing and schema validation with Zod.
- Mitigation: constrained command formats and encoded path params.

5. Service crash loops:
- Mitigation: launchd/systemd restart policies.
- Mitigation: backoff strategy and bridge runtime state reporting.

## Residual Risk

1. Compromised local user session can read local files.
2. Third-party service compromise is outside Faye control.
3. Misconfigured remote speaker SSH remains operator risk.

## Next Hardening Targets

1. Add signed release artifacts.
2. Add optional encrypted key storage integrations.
3. Expand automated security regression tests.
