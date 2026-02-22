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

## OpenClaw Second Install

Use the canonical OpenClaw -> Faye onboarding path:

- `docs/openclaw-second-install.md`

## 3-step Quick Start

1. `./scripts/install.sh`
2. `./scripts/faye setup`
3. Open [http://127.0.0.1:4587](http://127.0.0.1:4587)

## Open Dashboard (short commands)

Install now sets up command shims in `~/.local/bin` so new users can run Faye from anywhere:

```bash
faye open
faye status
```

One-word aliases also work:

```bash
faye-open
faye-status
```

If your shell cannot find `faye`, run:

```bash
./scripts/install-shims.sh
```

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

- Open dashboard: `faye open` or `faye-open`
- System status: `faye status` or `faye-status`
- Panic stop: `faye panic --confirm "PANIC STOP"` or `faye-panic --confirm "PANIC STOP"`
- Factory reset: `faye reset --confirm "FACTORY RESET"` or `faye-reset --confirm "FACTORY RESET"`
- Preflight checks: `./scripts/preflight.sh`
- Install: `./scripts/install.sh`
- Setup/update: `./scripts/faye setup`
- Health check: `./scripts/faye doctor`
- First-success report: `./scripts/faye first-success --json`
- Metrics (JSON): `curl -s http://127.0.0.1:4587/v1/metrics`
- Metrics (Prom): `curl -s http://127.0.0.1:4587/v1/metrics?format=prom`
- Install KPI summary: `node ./scripts/install-kpi.mjs --json`
- List profiles: `./scripts/faye profile list`
- Speak test: `./scripts/speak.sh "Hello from Faye"`
- One-command demo: `npm run demo`

## Panic Stop vs Factory Reset

Use these when debugging or when onboarding gets stuck:

1. `Panic Stop`:
- Stops listener + bridge.
- Keeps dashboard online so you can recover quickly.
- Clears volatile runtime files only.
- Run:
```bash
faye panic --confirm "PANIC STOP"
```

2. `Factory Reset`:
- Archives diagnostics first.
- Wipes config/secrets/runtime/reports for a clean start.
- Stops listener + bridge + dashboard.
- Run:
```bash
faye reset --confirm "FACTORY RESET"
```

Dashboard includes the same controls in the **Recovery & Panic** panel.

## No-risk recovery for new users

If anything feels broken, you are safe to panic-stop or factory-reset and try again.

Recommended reset loop:

1. `faye panic --confirm "PANIC STOP"`
2. If still broken: `faye reset --confirm "FACTORY RESET"`
3. Re-run install/setup:
```bash
./scripts/install.sh
faye setup
faye open
```

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

## Protected by the [Seven Shadows](https://github.com/VontaJamal/seven-shadow-system)

Every PR is guarded by the Seven Shadow System — AI review detection, human sign-off enforcement, and a quality doctrine across seven domains: Security, Accessibility, Testing, Execution, Scales, Value, and Aesthetics.

- Submodule: `governance/seven-shadow-system`
- Policy: `.seven-shadow/policy.json`
- CI: `.github/workflows/seven-shadow-system.yml`
- Doctrine: `references/seven-shadow-doctrine.md`

```bash
# Run the gauntlet
./scripts/seven-shadow-test.sh

# Smoke check
npm run guard:seven-shadow -- --policy .seven-shadow/policy-smoke.json --event governance/seven-shadow-system/examples/pr_review_event.json --event-name pull_request_review
```

Burn-in: `docs/burn-in.md` · SLO check: `./scripts/slo-eval.sh` · Canary: `npm run canary`

## Contributing

- Start here: `CONTRIBUTING.md`
- Roadmap: `docs/roadmap.md`
- Open issue templates: `.github/ISSUE_TEMPLATE`
- Triage playbook: `docs/triage.md`

## For Maintainers (Optional)

If you are just using Faye, you can skip this.

Rinshari-Eye is the design playbook for maintainers who change UI behavior:

- Repo: [VontaJamal/rinshari-eye](https://github.com/VontaJamal/rinshari-eye)
- `design/rinshari-eye/templates/design-preflight.md`
- `docs/site-soul-brief.md`
- `AGENTS.md`

## License

MIT

---

[Explore the Vault →](https://github.com/VontaJamal/shadow-vault)

Part of [Sovereign](https://github.com/VontaJamal) — The Shadow Dominion. 🏴‍☠️
