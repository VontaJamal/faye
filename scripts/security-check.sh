#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v rg >/dev/null 2>&1; then
  search_args=(
    --hidden
    --glob '!.git/**'
    --glob '!node_modules/**'
    --glob '!governance/seven-shadow-system/node_modules/**'
  )

  scan_pattern() {
    local pattern="$1"
    set +e
    rg -n "${search_args[@]}" -- "$pattern" .
    local code=$?
    set -e

    if [[ "$code" -eq 0 ]]; then
      return 0
    fi

    if [[ "$code" -eq 1 ]]; then
      return 1
    fi

    echo "ripgrep failed with exit code $code while scanning pattern: $pattern"
    exit 1
  }

  echo "Checking for accidentally committed private keys..."
  if scan_pattern '-----BEGIN [A-Z ]*PRIVATE KEY-----'; then
    echo "Potential private key material detected."
    exit 1
  fi

  echo "Checking for high-risk secret patterns..."
  if scan_pattern '(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xoxb-[0-9A-Za-z-]{20,}|sk-[A-Za-z0-9]{20,})'; then
    echo "Potential committed secret detected."
    exit 1
  fi
else
  echo "ripgrep not found; skipping pattern security checks."
fi

echo "Security pattern checks passed."
