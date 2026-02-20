# Faye

Faye is a local-first voice layer for OpenClaw.

You choose your wake word, and Faye listens, routes events, and speaks back with ElevenLabs.

## 3-step setup

1. Run install:
```bash
./scripts/install.sh
```
2. Complete setup prompts (wake word, voice, API key).
3. Open the dashboard: [http://127.0.0.1:4587](http://127.0.0.1:4587)

## Everyday commands

- Setup/update: `./scripts/faye setup`
- Health check: `./scripts/faye doctor`
- List profiles: `./scripts/faye profile list`
- Speak test: `./scripts/speak.sh "Hello from Faye"`

## Always-on behavior

After install, Faye runs as user services and starts automatically on login:

- Listener: `./scripts/listener-control.sh status|restart`
- Dashboard/API: `./scripts/dashboard-control.sh status|restart`
- Telegram bridge: `./scripts/telegram-bridge-control.sh status|restart`

## Telegram bridge

Telegram bridge is optional, but it enables smooth OpenClaw round-trips:

1. Faye sends wake/session events.
2. OpenClaw responds with `#faye_speak`.
3. Faye bridge plays spoken output automatically.

Protocol: `references/openclaw-telegram-protocol.md`

## Seven Shadow doctrine

Faye uses a Seven Shadow release bar across:

1. Security
2. Accessibility
3. Testing
4. Execution
5. Scales
6. Value
7. Aesthetics

Run the gauntlet:
```bash
./scripts/seven-shadow-test.sh
```

## Seven Shadow System

Faye uses the open-source Seven Shadow System as its shareable AI review guard.

- Repo: [VontaJamal/seven-shadow-system](https://github.com/VontaJamal/seven-shadow-system)
- Submodule: `governance/seven-shadow-system`
- Policy: `.seven-shadow/policy.json`
- Workflow: `.github/workflows/seven-shadow-system.yml`
- Guide: `references/seven-shadow-system.md`

Local smoke run:
```bash
npm run guard:seven-shadow -- --policy .seven-shadow/policy-smoke.json --event governance/seven-shadow-system/examples/pr_review_event.json --event-name pull_request_review
```

## Rinshari integration

Design doctrine source: `design/rinshari-ui`

Before major UI changes, use:
- `design/rinshari-ui/templates/design-preflight.md`
- `docs/site-soul-brief.md`
- `AGENTS.md`

## License

MIT
