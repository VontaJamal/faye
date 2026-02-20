# Seven Shadow System

Faye integrates Seven Shadow System as a reusable submodule so governance logic can be shared across repositories.

## Canonical Source

- Repo: `https://github.com/VontaJamal/seven-shadow-system`
- Submodule path in Faye: `governance/seven-shadow-system`

## Faye Integration Contract

- Policy file: `.seven-shadow/policy.json`
- Smoke policy file: `.seven-shadow/policy-smoke.json` (for local/CI fixture checks)
- Workflow: `.github/workflows/seven-shadow-system.yml`
- Local command:

```bash
npm run guard:seven-shadow -- --event governance/seven-shadow-system/examples/pr_review_event.json --event-name pull_request_review
```

## Why This Split Exists

1. Faye stays focused on voice/wake-word runtime and dashboard UX.
2. Seven Shadow System stays composable for any repository.
3. Community can fork/extend governance doctrine without coupling to Faye internals.

## Consumer Repositories

To auto-wire this into another repository:

```bash
governance/seven-shadow-system/scripts/wire-submodule.sh /absolute/path/to/target-repo
```

Or run directly from a local clone of Seven Shadow System:

```bash
/absolute/path/to/seven-shadow-system/scripts/wire-submodule.sh /absolute/path/to/target-repo
```
