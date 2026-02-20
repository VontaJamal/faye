# Faye

Faye is an always-on voice layer for OpenClaw.

You choose your wake word, Faye listens for it, and Faye can speak back with ElevenLabs.

## 3-step Quick Start

1. Install everything:
```bash
./scripts/install.sh
```
2. Run setup:
```bash
./scripts/faye setup
```
3. Open the dashboard:

[http://127.0.0.1:4587](http://127.0.0.1:4587)

That is the full 3-step install path.

## What Faye Does

- Listens for your wake word
- Supports multiple saved voice profiles
- Lets you switch profiles in one click
- Speaks responses with ElevenLabs
- Runs as always-on user services after install

## Everyday Commands

- Install: `./scripts/install.sh`
- Setup/update: `./scripts/faye setup`
- Health check: `./scripts/faye doctor`
- List profiles: `./scripts/faye profile list`
- Speak test: `./scripts/speak.sh "Hello from Faye"`
- One-command demo: `npm run demo`

## Telegram bridge (Optional)

Telegram bridge is optional.

If you use it, this is the loop:

1. Faye sends wake/session events to Telegram.
2. OpenClaw responds with `#faye_speak`.
3. Telegram bridge triggers local speech automatically.

Protocol reference: `references/openclaw-telegram-protocol.md`

## Always-On Services

After install, Faye auto-starts when you log in:

- Listener: `./scripts/listener-control.sh status|restart`
- Dashboard/API: `./scripts/dashboard-control.sh status|restart`
- Telegram bridge: `./scripts/telegram-bridge-control.sh status|restart`

## Onboarding Video / GIF

Quick visual onboarding assets live here:

- GIF path: `docs/media/faye-onboarding.gif` (add your demo gif here)
- Video link: add your short setup walkthrough URL here

## Seven Shadow Standard

Faye uses a Seven Shadow quality standard:

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

Faye uses the open-source Seven Shadow System as its AI review guard.

- Repo: [VontaJamal/seven-shadow-system](https://github.com/VontaJamal/seven-shadow-system)
- Submodule path: `governance/seven-shadow-system`
- Policy: `.seven-shadow/policy.json`
- CI workflow: `.github/workflows/seven-shadow-system.yml`
- Guide: `references/seven-shadow-system.md`

Local smoke check:

```bash
npm run guard:seven-shadow -- --policy .seven-shadow/policy-smoke.json --event governance/seven-shadow-system/examples/pr_review_event.json --event-name pull_request_review
```

## For Maintainers (Optional)

If you are just using Faye, you can skip this.

Rinshari-UI is the design playbook used when contributors change UI behavior:

- `design/rinshari-ui/templates/design-preflight.md`
- `docs/site-soul-brief.md`
- `AGENTS.md`

## License

MIT
