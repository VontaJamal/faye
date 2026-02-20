# Alpha Triage Playbook

Use this during public alpha.

## Labels

1. `alpha-feedback`: belongs in alpha feedback loop.
2. `triage-needed`: needs maintainer classification.
3. `sev-1`: core flow unusable.
4. `sev-2`: degraded but usable.
5. `sev-3`: non-blocking issue.
6. `accessibility`: keyboard/screen reader/reduced-motion issues.
7. `reliability`: wake/bridge/service stability issues.

## Triage SLA

1. New bug issue: label within 24 hours.
2. Severity assigned: within 24 hours.
3. First maintainer response: within 48 hours.

## Severity Rules

1. `sev-1`: wake flow or speech unavailable for most users.
2. `sev-2`: intermittent failures, delayed response, partial breakage.
3. `sev-3`: docs/UI/polish issues with clear workaround.
