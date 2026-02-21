#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required=(
  ".github/workflows/seven-shadow-system.yml"
  ".github/workflows/ci-quality.yml"
  ".github/workflows/hourly-canary.yml"
  ".github/workflows/install-smoke-matrix.yml"
  ".github/workflows/burn-in-7day.yml"
  ".github/workflows/burn-in-gate.yml"
  ".github/workflows/alpha-triage-daily.yml"
  ".github/workflows/issue-triage.yml"
  ".seven-shadow/policy.json"
  ".seven-shadow/policy-smoke.json"
  "governance/seven-shadow-system/README.md"
  "scripts/install.sh"
  "scripts/preflight.sh"
  "scripts/bootstrap.sh"
  "scripts/install-shims.sh"
  "scripts/panic-reset.sh"
  "scripts/install-kpi.mjs"
  "scripts/canary-smoke.sh"
  "scripts/security-check.sh"
  "scripts/always-on-proof.sh"
  "scripts/burn-in-day.sh"
  "scripts/slo-eval.sh"
  "scripts/burn-in-gate-check.mjs"
  "scripts/burn-in-issue-update.mjs"
  "scripts/triage-sla-check.mjs"
  "scripts/burn-in-exit-check.mjs"
  "scripts/faye"
  "scripts/install-listener.sh"
  "scripts/install-dashboard.sh"
  "scripts/install-telegram-bridge.sh"
  "scripts/install-speaker.sh"
  "scripts/speak-remote.sh"
  "scripts/telegram-bridge-control.sh"
  "references/reliability-slo.md"
  "docs/distribution.md"
  "docs/openclaw-second-install.md"
  "docs/public-alpha-kit.md"
  "docs/always-on-proof.md"
  "docs/burn-in.md"
  "docs/privacy.md"
  "docs/threat-model.md"
  "docs/roadmap.md"
  "docs/triage.md"
  "docs/releases/v1.2.0-alpha.1.md"
  "SECURITY.md"
  "CONTRIBUTING.md"
  "AGENT-QUICKSTART.md"
  "agent-contract.json"
  ".github/ISSUE_TEMPLATE/bug-report.md"
  ".github/ISSUE_TEMPLATE/feature-request.md"
  ".github/ISSUE_TEMPLATE/config.yml"
  "references/seven-shadow-system.md"
  "references/seven-shadow-doctrine.md"
  "references/supported-voices.md"
  "references/openclaw-telegram-protocol.md"
)

for file in "${required[@]}"; do
  [[ -f "$ROOT_DIR/$file" ]] || { echo "Missing required file: $file"; exit 1; }
done

grep -q "3-step" "$ROOT_DIR/README.md" || { echo "README missing 3-step onboarding text"; exit 1; }
grep -q "Install In One Command" "$ROOT_DIR/README.md" || { echo "README missing one-command install section"; exit 1; }
grep -q "OpenClaw Second Install" "$ROOT_DIR/README.md" || { echo "README missing OpenClaw second-install section"; exit 1; }
grep -q "Trust and Safety" "$ROOT_DIR/README.md" || { echo "README missing trust and safety section"; exit 1; }
grep -q "Seven Shadow" "$ROOT_DIR/README.md" || { echo "README missing Seven Shadow doctrine"; exit 1; }
grep -q "Telegram bridge" "$ROOT_DIR/README.md" || { echo "README missing Telegram bridge section"; exit 1; }
grep -q "Seven Shadow System" "$ROOT_DIR/README.md" || { echo "README missing Seven Shadow System section"; exit 1; }
grep -q "Contributing" "$ROOT_DIR/README.md" || { echo "README missing contributing section"; exit 1; }
grep -q "Open Dashboard (short commands)" "$ROOT_DIR/README.md" || { echo "README missing short command dashboard section"; exit 1; }
grep -q "Panic Stop vs Factory Reset" "$ROOT_DIR/README.md" || { echo "README missing panic/reset section"; exit 1; }
grep -q "No-risk recovery for new users" "$ROOT_DIR/README.md" || { echo "README missing no-risk recovery section"; exit 1; }

node - <<'NODE'
const fs = require("fs");
const policy = JSON.parse(fs.readFileSync(".seven-shadow/policy.json", "utf8"));
const smoke = JSON.parse(fs.readFileSync(".seven-shadow/policy-smoke.json", "utf8"));
if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
  throw new Error("Seven Shadow policy must include at least one rule");
}
if (typeof policy.maxAiScore !== "number") {
  throw new Error("Seven Shadow policy must define maxAiScore");
}
if (typeof smoke.minHumanApprovals !== "number" || smoke.minHumanApprovals !== 0) {
  throw new Error("Seven Shadow smoke policy must set minHumanApprovals to 0");
}
NODE

node - <<'NODE'
const fs = require("fs");
const path = require("path");

function parseVersion(raw) {
  const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (typeof pkg.version !== "string") {
  throw new Error("package.json must define string version");
}

const releaseDir = path.join("docs", "releases");
const releaseFiles = fs
  .readdirSync(releaseDir)
  .filter((name) => /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.md$/.test(name));

if (releaseFiles.length === 0) {
  throw new Error("docs/releases must contain at least one versioned release doc");
}

const releaseVersions = releaseFiles.map((name) => name.replace(/\.md$/, ""));
const latestRelease = releaseVersions
  .map((value) => ({ value, parsed: parseVersion(value) }))
  .filter((entry) => entry.parsed !== null)
  .sort((left, right) => compareSemver(right.parsed, left.parsed))[0];

if (!latestRelease) {
  throw new Error("failed to parse release versions");
}

const pkgVersion = `v${pkg.version}`;
if (pkgVersion !== latestRelease.value) {
  throw new Error(`package.json version (${pkg.version}) must match latest release doc (${latestRelease.value})`);
}
NODE

echo "Docs contract checks passed."
