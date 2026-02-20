# Security Policy

## Supported Versions

Security fixes are applied on `main`.

## Reporting a Vulnerability

Please do not open a public issue for active vulnerabilities.

Instead:

1. Open a private GitHub Security Advisory for this repository.
2. Include reproduction steps, affected files, and expected impact.
3. Include whether the issue can expose secrets, run arbitrary commands, or leak user audio/text.

Response target:

- Initial acknowledgement: within 72 hours.
- Initial risk assessment: within 7 days.
- Mitigation plan or patch target date: as soon as triaged.

## Security Baseline

Faye security baseline for V1:

1. Local API binds to `127.0.0.1` only.
2. Secret files are written with `0600`.
3. Setup prompts hide secret input in terminal.
4. Wake-word and command parsing use constrained, validated inputs.
5. CI blocks release if high+ severity `npm audit` findings fail.

## Responsible Disclosure

After a patch is ready and users have upgrade guidance, we publish:

1. A short advisory summary.
2. Affected versions and fixed version.
3. Upgrade steps.
