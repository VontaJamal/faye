# Contributing to Faye

Thank you for helping build Faye.

This project is beginner-friendly, local-first, and open.

## Fast Start for Contributors

1. Fork + clone this repo.
2. Install deps and build:
```bash
npm ci
npm run build
```
3. Run tests:
```bash
npm test
./scripts/seven-shadow-test.sh 2
```

## Contribution Rules

1. Keep local API loopback-only (`127.0.0.1`) unless maintainers explicitly approve.
2. Never commit real API keys, tokens, or private keys.
3. Preserve accessibility baseline for dashboard changes.
4. Keep setup flow simple for first-time users.
5. Add or update docs when behavior changes.

## Pull Request Checklist

1. Explain user impact in plain language.
2. Include test evidence (`npm test` and/or `./scripts/seven-shadow-test.sh 2`).
3. Include accessibility impact for UI changes.
4. Include fallback behavior for failures.
5. Use the PR template and complete Rinshari design preflight blocks when applicable.

## Good First Contributions

1. Improve onboarding clarity in docs.
2. Add tests for edge cases in bridge/listener flow.
3. Improve keyboard and screen-reader UX in dashboard.
4. Improve troubleshooting playbooks with reproducible fixes.
