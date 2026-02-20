# Faye

Faye is an always-on voice layer for OpenClaw.

You choose your wake word. Faye listens. Faye speaks back.

## Start Here (5-Minute Win)

This is the fastest path for a new person:

1. Install:
```bash
./scripts/install.sh
```
Expected output includes:
- `Dependencies OK`
- `Install complete. Open: http://127.0.0.1:4587`

2. Setup:
```bash
./scripts/faye setup
```
Expected output includes:
- `Configured profile ...`

3. Open dashboard:

[http://127.0.0.1:4587](http://127.0.0.1:4587)

4. Verify health:
```bash
./scripts/faye doctor
```
Expected: JSON with `"ok": true`.

5. Verify voice output:
```bash
./scripts/speak.sh "Faye test voice"
```
Expected: audible playback.

## 3-step Quick Start

1. `./scripts/install.sh`
2. `./scripts/faye setup`
3. Open [http://127.0.0.1:4587](http://127.0.0.1:4587)

## Public Alpha Kit

For onboarding other people quickly:

- One-page quickstart: `docs/public-alpha-kit.md`
- Troubleshooting: `references/troubleshooting.md`
- Media pack notes: `docs/media/README.md`

## Everyday Commands

- Install: `./scripts/install.sh`
- Setup/update: `./scripts/faye setup`
- Health check: `./scripts/faye doctor`
- List profiles: `./scripts/faye profile list`
- Speak test: `./scripts/speak.sh "Hello from Faye"`
- One-command demo: `npm run demo`

## Always-On Services

After install, Faye auto-starts when you log in:

- Listener: `./scripts/listener-control.sh status|restart`
- Dashboard/API: `./scripts/dashboard-control.sh status|restart`
- Telegram bridge: `./scripts/telegram-bridge-control.sh status|restart`

Quick status check:

```bash
./scripts/listener-control.sh status
./scripts/dashboard-control.sh status
./scripts/telegram-bridge-control.sh status
```

Expected output includes:
- `listener: running`
- `dashboard: running`
- `telegram-bridge: running` (if Telegram is configured)

## Telegram bridge (Optional)

Telegram bridge is optional.

If you use it, this is the loop:

1. Faye sends wake/session events to Telegram.
2. OpenClaw responds with `#faye_speak`.
3. Telegram bridge triggers local speech automatically.

Protocol reference: `references/openclaw-telegram-protocol.md`

## Onboarding Video / GIF

Media folder:

- `docs/media/faye-onboarding.gif`
- `docs/media/faye-setup-walkthrough.md`

Authoring notes: `docs/media/README.md`

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
