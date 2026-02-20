# 7-Day Reliability Burn-In

This burn-in is required for alpha hardening.

## Daily Gate

Run once per day for 7 days:

```bash
./scripts/burn-in-day.sh
```

This runs:

1. `npm run canary`
2. `./scripts/seven-shadow-test.sh 2`
3. `npm audit --audit-level=high`

A report is written to `.faye/reports/burn-in-<timestamp>.md`.

## Merge Rule During Burn-In

Before merging any fix to `main`:

1. `npm run canary` must pass.
2. `./scripts/seven-shadow-test.sh 2` must pass twice consecutively.

## Automation

GitHub workflow:

- `.github/workflows/burn-in-7day.yml`

This runs daily and can also be triggered manually.
