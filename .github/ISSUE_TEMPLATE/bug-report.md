---
name: Bug report
about: Report a bug in setup, wake flow, dashboard, or bridge behavior
title: "[Bug] "
labels: ["bug"]
assignees: []
---

## What happened

Describe the bug in plain words.

## Expected behavior

What should have happened.

## Reproduction steps

1. 
2. 
3. 

## Environment

- OS:
- Node version:
- Faye commit/version:
- Telegram enabled: yes/no

## Logs or screenshots

Paste relevant output from:

- `faye status`
- `faye panic --confirm "PANIC STOP" --json` or `faye reset --confirm "FACTORY RESET" --json` (if used)
- `./scripts/faye first-success --json` (include `.faye/reports/install-attempt-*.json`)
- `.faye/reports/ui-kpi.json`
- `./scripts/faye doctor`
- `~/.openclaw/faye-voice/listener-error.log`
- `~/.openclaw/faye-voice/telegram-bridge-error.log`
