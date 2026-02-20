#!/usr/bin/env bash
set -euo pipefail

html="dashboard/public/index.html"
css="dashboard/public/styles.css"

[[ -f "$html" ]] || { echo "Missing $html"; exit 1; }
[[ -f "$css" ]] || { echo "Missing $css"; exit 1; }

grep -q '<main' "$html" || { echo "Missing <main> landmark"; exit 1; }
grep -q 'aria-live' "$html" || { echo "Missing aria-live region"; exit 1; }
grep -q 'prefers-reduced-motion' "$css" || { echo "Missing reduced-motion media query"; exit 1; }
grep -q '<label' "$html" || { echo "Missing form labels"; exit 1; }

echo "Accessibility baseline checks passed."
