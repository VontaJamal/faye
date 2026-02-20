# 7-Day Reliability Burn-In (Fail-Closed)

This burn-in is the alpha trust gate. If any daily gate fails, merges stay blocked until a same-day pass is posted in Issue #3.

## Burn-In Window

- Burn-in ops window: **February 21, 2026 to February 27, 2026 (UTC)**
- Tracker and source of truth: `https://github.com/VontaJamal/faye/issues/3`

## Daily Gate Runner

Run once per day:

```bash
./scripts/burn-in-day.sh
```

The runner executes and records:

1. `/v1/health` contract check (`doctor.ok`, `roundTrip`, `metrics`)
2. metrics baseline capture (`/v1/metrics`)
3. `npm run canary`
4. `./scripts/seven-shadow-test.sh 2`
5. `npm audit --audit-level=high`
6. round-trip probe event injection
7. metrics current capture (`/v1/metrics`)
8. `./scripts/slo-eval.sh`

SLO thresholds:

- round-trip error rate `<= 0.02`
- p95 wake-to-spoken latency `<= 2500ms`
- p99 wake-to-spoken latency `<= 5000ms`
- spoken success delta `> 0` during the run

Artifacts are written to `.faye/reports/`:

- report markdown
- burn-in summary JSON
- SLO summary JSON

## Daily Reporting to Issue #3

After each burn-in run, post/update via:

```bash
BURN_IN_SUMMARY_PATH=.faye/reports/burn-in-<timestamp>.json \
  node ./scripts/burn-in-issue-update.mjs
```

Required marker line in the Issue #3 comment:

- `Burn-in day passed: YYYY-MM-DD`
- or `Burn-in day failed: YYYY-MM-DD`

## PR Merge Enforcement During Burn-In

Workflow: `.github/workflows/burn-in-gate.yml`

Gate script: `./scripts/burn-in-gate-check.mjs`

It fails closed when:

1. no marker exists
2. latest marker is `failed`
3. latest `passed` marker date is stale (not today UTC)

## Automation

- Daily burn-in run: `.github/workflows/burn-in-7day.yml`
- PR gate: `.github/workflows/burn-in-gate.yml`
- Triage SLA enforcement: `.github/workflows/alpha-triage-daily.yml`

## Burn-In Exit Check

When burn-in is complete, run promotion readiness check:

```bash
node ./scripts/burn-in-exit-check.mjs
```

This verifies:

1. all burn-in dates in window have pass markers
2. no unresolved `sev-1` issues
3. round-trip success `>= 98%`
4. p95/p99 thresholds are still met
