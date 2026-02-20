# Faye

Faye is an always-on voice layer for OpenClaw.

You choose your wake word. Faye listens. Faye speaks back.

## Public Alpha Live

Latest prerelease: `https://github.com/VontaJamal/faye/releases/tag/v1.2.0-alpha.2`

1. Install in one command:
```bash
curl -fsSL https://raw.githubusercontent.com/VontaJamal/faye/main/scripts/bootstrap.sh | bash
```
2. Follow quickstart: `docs/public-alpha-kit.md`
3. Report bugs in the alpha feedback issue: `https://github.com/VontaJamal/faye/issues/1`
4. Join tester cohort thread: `https://github.com/VontaJamal/faye/issues/2`

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

## Install In One Command

If you want more install options: `docs/distribution.md`

## 3-step Quick Start

1. `./scripts/install.sh`
2. `./scripts/faye setup`
3. Open [http://127.0.0.1:4587](http://127.0.0.1:4587)

## Public Alpha Kit

For onboarding other people quickly:

- One-page quickstart: `docs/public-alpha-kit.md`
- Troubleshooting: `references/troubleshooting.md`
- Media pack notes: `docs/media/README.md`

## Trust and Safety

- Security policy: `SECURITY.md`
- Privacy overview: `docs/privacy.md`
- Threat model: `docs/threat-model.md`
- Reliability targets: `references/reliability-slo.md`

## Everyday Commands

- Install: `./scripts/install.sh`
- Setup/update: `./scripts/faye setup`
- Health check: `./scripts/faye doctor`
- Metrics (JSON): `curl -s http://127.0.0.1:4587/v1/metrics`
- Metrics (Prom): `curl -s http://127.0.0.1:4587/v1/metrics?format=prom`
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

Reboot/login proof runbook: `docs/always-on-proof.md`

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

Doctrine: `references/seven-shadow-doctrine.md`

Run the gauntlet:

```bash
./scripts/seven-shadow-test.sh
```

Scheduled reliability smoke:

```bash
npm run canary
```

7-day burn-in runbook: `docs/burn-in.md`
Burn-in tracker issue: `https://github.com/VontaJamal/faye/issues/3`
Fail-closed PR gate during burn-in: `.github/workflows/burn-in-gate.yml`
Daily SLO check script: `./scripts/slo-eval.sh`

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

## Contributing

- Start here: `CONTRIBUTING.md`
- Roadmap: `docs/roadmap.md`
- Open issue templates: `.github/ISSUE_TEMPLATE`
- Triage playbook: `docs/triage.md`

## For Maintainers (Optional)

If you are just using Faye, you can skip this.

Rinshari-UI is the design playbook for maintainers who change UI behavior:

- Repo: [VontaJamal/rinshari-ui](https://github.com/VontaJamal/rinshari-ui)
- `design/rinshari-ui/templates/design-preflight.md`
- `docs/site-soul-brief.md`
- `AGENTS.md`

## License

MIT
