# Alpha Triage Playbook

Use this during public alpha.

## Operational Control Points

1. Issue #1: alpha feedback hub (`https://github.com/VontaJamal/faye/issues/1`)
2. Issue #2: tester cohort thread (`https://github.com/VontaJamal/faye/issues/2`)
3. Issue #3: burn-in tracker and merge-gate source (`https://github.com/VontaJamal/faye/issues/3`)

## Labels

1. `alpha-feedback`: belongs in alpha feedback loop.
2. `triage-needed`: needs maintainer classification.
3. `sev-1`: core flow unusable.
4. `sev-2`: degraded but usable.
5. `sev-3`: non-blocking issue.
6. `accessibility`: keyboard/screen reader/reduced-motion issues.
7. `reliability`: wake/bridge/service stability issues.

## Daily Triage Loop

1. Scan new comments and issues from #1 and #2.
2. Confirm severity label (`sev-1`, `sev-2`, or `sev-3`) within 24 hours.
3. Split confirmed defects into dedicated bug issues and link back to #1.
4. Keep `triage-needed` on items that still need owner/action.

## Escalation Policy

1. `sev-1`: immediate fix branch; no feature merges.
2. `sev-2`: same-day fix queue.
3. `sev-3`: backlog unless correlated with high-volume reports.

## SLA Enforcement

Daily automation:

- workflow: `.github/workflows/alpha-triage-daily.yml`
- script: `./scripts/triage-sla-check.mjs`

Fail conditions:

1. any alpha bug issue older than 24h without severity label
2. any unresolved `sev-1` issue

## Severity Rules

1. `sev-1`: wake flow or speech unavailable for most users.
2. `sev-2`: intermittent failures, delayed response, partial breakage.
3. `sev-3`: docs/UI/polish issues with clear workaround.
