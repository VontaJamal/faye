#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNS="${1:-2}"

run_matrix() {
  echo "[1] Security lint and shell validation"
  (cd "$ROOT_DIR" && bash -n scripts/*.sh)

  echo "[2] Dependency and build integrity"
  (cd "$ROOT_DIR" && npm run build)

  echo "[3] Test suite"
  (cd "$ROOT_DIR" && npm test)

  echo "[4] Accessibility baseline"
  (cd "$ROOT_DIR" && ./scripts/accessibility-check.sh)

  echo "[5] API contract smoke"
  (cd "$ROOT_DIR" && node -e "const fs=require('fs'); const api=fs.readFileSync('app/src/api.ts','utf8'); const required=['/v1/health','/v1/profiles','/v1/events']; for (const p of required) if (!api.includes(p)) throw new Error('Missing '+p); console.log('API smoke ok')")

  echo "[6] Documentation drift check"
  (cd "$ROOT_DIR" && ./scripts/docs-contract-check.sh)
}

for i in $(seq 1 "$RUNS"); do
  echo "======================================="
  echo "Seven Shadow Gauntlet run $i/$RUNS"
  echo "======================================="
  run_matrix
  echo "Run $i passed"
done

echo "All Seven Shadow runs passed ($RUNS/$RUNS)."
