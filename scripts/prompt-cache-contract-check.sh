#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STRICT_DEPENDENT=false
DEPENDENT_CONFIG_PATH="${FAYE_OPENCLAW_CONFIG_PATH:-}"
JSON_OUTPUT=false

usage() {
  cat <<'USAGE'
Usage: ./scripts/prompt-cache-contract-check.sh [--dependent-config <path>] [--strict-dependent] [--json]

Validates the Shadow Prompt Caching v1 contract artifacts in this repository.
If --dependent-config is provided (or FAYE_OPENCLAW_CONFIG_PATH is set), the script also validates
that the dependent runtime config includes prompt caching keys.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dependent-config)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing value for --dependent-config" >&2
        exit 2
      fi
      DEPENDENT_CONFIG_PATH="$1"
      ;;
    --strict-dependent)
      STRICT_DEPENDENT=true
      ;;
    --json)
      JSON_OUTPUT=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

required_files=(
  "references/shadow-prompt-caching-v1.md"
  "references/openclaw-prompt-caching-config.example.json"
  "docs/audits/2026-02-21-prompt-cache-prefix-stability.md"
  "scripts/prompt-cache-smoke.sh"
  "scripts/prompt-cache-baseline.mjs"
)

errors=()
notes=()

for file in "${required_files[@]}"; do
  if [[ ! -f "$ROOT_DIR/$file" ]]; then
    errors+=("E_PROMPT_CACHE_CONTRACT_FILE_MISSING:$file")
  fi
done

README_PATH="$ROOT_DIR/README.md"
if [[ -f "$README_PATH" ]]; then
  grep -q "Prompt Caching" "$README_PATH" || errors+=("E_PROMPT_CACHE_README_SECTION_MISSING")
  grep -q "scripts/prompt-cache-contract-check.sh" "$README_PATH" || errors+=("E_PROMPT_CACHE_README_COMMAND_MISSING")
else
  errors+=("E_PROMPT_CACHE_README_MISSING")
fi

CONFIG_EXAMPLE_PATH="$ROOT_DIR/references/openclaw-prompt-caching-config.example.json"
if [[ -f "$CONFIG_EXAMPLE_PATH" ]]; then
  if ! node - "$CONFIG_EXAMPLE_PATH" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const raw = fs.readFileSync(path, "utf8");
const config = JSON.parse(raw);
const promptCaching = config?.agents?.defaults?.promptCaching;

if (!promptCaching || typeof promptCaching !== "object") {
  throw new Error("E_PROMPT_CACHE_EXAMPLE_CONTRACT_MISSING");
}

if (typeof promptCaching.enabled !== "boolean") {
  throw new Error("E_PROMPT_CACHE_EXAMPLE_ENABLED_INVALID");
}

if (!["in_memory", "24h"].includes(promptCaching.retentionDefault)) {
  throw new Error("E_PROMPT_CACHE_EXAMPLE_RETENTION_INVALID");
}

if (promptCaching.keyStrategy !== "session_stable_v1") {
  throw new Error("E_PROMPT_CACHE_EXAMPLE_KEY_STRATEGY_INVALID");
}

if (typeof promptCaching.saltEnvVar !== "string" || promptCaching.saltEnvVar.trim().length < 1) {
  throw new Error("E_PROMPT_CACHE_EXAMPLE_SALT_ENV_INVALID");
}

if (typeof promptCaching.forceResponsesStore !== "boolean") {
  throw new Error("E_PROMPT_CACHE_EXAMPLE_FORCE_RESPONSES_STORE_INVALID");
}
NODE
  then
    errors+=("E_PROMPT_CACHE_EXAMPLE_SCHEMA_INVALID")
  fi
fi

if [[ -n "$DEPENDENT_CONFIG_PATH" ]]; then
  if [[ ! -f "$DEPENDENT_CONFIG_PATH" ]]; then
    if [[ "$STRICT_DEPENDENT" == true ]]; then
      errors+=("E_PROMPT_CACHE_DEPENDENT_CONFIG_MISSING:$DEPENDENT_CONFIG_PATH")
    else
      notes+=("Dependent config not found: $DEPENDENT_CONFIG_PATH")
    fi
  else
    required_tokens=(
      "promptCaching"
      "retentionDefault"
      "keyStrategy"
      "session_stable_v1"
      "saltEnvVar"
    )

    for token in "${required_tokens[@]}"; do
      if ! grep -q "$token" "$DEPENDENT_CONFIG_PATH"; then
        errors+=("E_PROMPT_CACHE_DEPENDENT_TOKEN_MISSING:$token")
      fi
    done
  fi
elif [[ "$STRICT_DEPENDENT" == true ]]; then
  errors+=("E_PROMPT_CACHE_DEPENDENT_CONFIG_REQUIRED")
fi

if [[ "$JSON_OUTPUT" == true ]]; then
  errors_joined="${errors[*]-}"
  notes_joined="${notes[*]-}"
  node - "$errors_joined" "$notes_joined" <<'NODE'
const errors = (process.argv[2] || "").trim();
const notes = (process.argv[3] || "").trim();
const errorList = errors ? errors.split(/\s+/) : [];
const noteList = notes ? notes.split(/\s+/) : [];
console.log(JSON.stringify({ ok: errorList.length === 0, errors: errorList, notes: noteList }, null, 2));
NODE
else
  if [[ ${#notes[@]} -gt 0 ]]; then
    for note in "${notes[@]}"; do
      echo "NOTE: $note"
    done
  fi

  if [[ ${#errors[@]} -gt 0 ]]; then
    for err in "${errors[@]}"; do
      echo "ERROR: $err" >&2
    done
    exit 1
  fi

  echo "Prompt cache contract checks passed."
fi
