#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

today="$(date -u +%Y-%m-%d)"
last_tag="$(git describe --tags --abbrev=0 2>/dev/null || true)"

if [[ -n "$last_tag" ]]; then
  range="$last_tag..HEAD"
else
  range="HEAD"
fi

entries="$(git log --pretty='- %h %s' $range | grep -v 'chore: update changelog' || true)"
if [[ -z "$entries" ]]; then
  entries='- No user-facing changes recorded.'
fi

if [[ -f CHANGELOG.md ]] && grep -q '^<!-- changelog:history -->$' CHANGELOG.md; then
  history="$(awk 'f{print} /^<!-- changelog:history -->$/{f=1; print}' CHANGELOG.md)"
else
  history='<!-- changelog:history -->'
fi

cat > CHANGELOG.md <<EOF
# Changelog

## Unreleased - $today

$entries

$history
EOF
