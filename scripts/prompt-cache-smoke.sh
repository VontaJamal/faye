#!/usr/bin/env bash
set -euo pipefail

URL="${FAYE_PROMPT_CACHE_SMOKE_URL:-https://api.openai.com/v1/responses}"
TOKEN="${FAYE_PROMPT_CACHE_SMOKE_AUTH_TOKEN:-${OPENAI_API_KEY:-}}"
MODEL="${FAYE_PROMPT_CACHE_SMOKE_MODEL:-gpt-5-mini}"
RETENTION="${FAYE_PROMPT_CACHE_SMOKE_RETENTION:-in_memory}"
CACHE_KEY="${FAYE_PROMPT_CACHE_SMOKE_CACHE_KEY:-shadow-prompt-cache-smoke-v1}"
MAX_OUTPUT_TOKENS="${FAYE_PROMPT_CACHE_SMOKE_MAX_OUTPUT_TOKENS:-120}"
INCLUDE_HINTS="${FAYE_PROMPT_CACHE_SMOKE_INCLUDE_HINTS:-1}"
PREFIX_FILE="${FAYE_PROMPT_CACHE_SMOKE_PREFIX_FILE:-}"

if [[ -z "$TOKEN" ]]; then
  echo "E_PROMPT_CACHE_SMOKE_AUTH_MISSING: set OPENAI_API_KEY or FAYE_PROMPT_CACHE_SMOKE_AUTH_TOKEN" >&2
  exit 1
fi

if [[ "$RETENTION" != "in_memory" && "$RETENTION" != "24h" ]]; then
  echo "E_PROMPT_CACHE_SMOKE_RETENTION_INVALID: expected in_memory or 24h" >&2
  exit 1
fi

if [[ -n "$PREFIX_FILE" ]]; then
  if [[ ! -f "$PREFIX_FILE" ]]; then
    echo "E_PROMPT_CACHE_SMOKE_PREFIX_FILE_MISSING: $PREFIX_FILE" >&2
    exit 1
  fi
  PREFIX_CONTENT="$(cat "$PREFIX_FILE")"
else
  PREFIX_CONTENT=""
  for i in $(seq 1 520); do
    PREFIX_CONTENT+="Shadow prompt cache stability block ${i}. "
  done
fi

PROMPT="${PREFIX_CONTENT}

Task: respond with exactly one short sentence about why stable prompt prefixes improve cache hit rates."

make_payload() {
  local payload_file="$1"
  local run_label="$2"
  node - "$payload_file" "$MODEL" "$PROMPT" "$MAX_OUTPUT_TOKENS" "$CACHE_KEY" "$RETENTION" "$INCLUDE_HINTS" "$run_label" <<'NODE'
const fs = require("node:fs");

const [
  payloadPath,
  model,
  prompt,
  maxOutputTokens,
  cacheKey,
  retention,
  includeHints,
  runLabel,
] = process.argv.slice(2);

const payload = {
  model,
  input: [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt,
        },
      ],
    },
  ],
  max_output_tokens: Number(maxOutputTokens),
  metadata: {
    probe: "faye_prompt_cache_smoke_v1",
    run: runLabel,
  },
};

if (includeHints === "1") {
  payload.prompt_cache_key = cacheKey;
  payload.prompt_cache_retention = retention;
}

fs.writeFileSync(payloadPath, JSON.stringify(payload));
NODE
}

extract_usage() {
  local response_file="$1"
  node - "$response_file" <<'NODE'
const fs = require("node:fs");

const responsePath = process.argv[2];
const body = JSON.parse(fs.readFileSync(responsePath, "utf8"));
const usage = body?.usage ?? {};
const details = usage?.input_tokens_details ?? usage?.prompt_tokens_details ?? usage?.inputTokensDetails ?? {};

const cachedTokens = Number(
  details?.cached_tokens ?? usage?.cached_tokens ?? usage?.cachedTokens ?? 0
);
const inputTokens = Number(
  usage?.input_tokens ?? usage?.prompt_tokens ?? usage?.inputTokens ?? 0
);

const safeCached = Number.isFinite(cachedTokens) ? cachedTokens : 0;
const safeInput = Number.isFinite(inputTokens) ? inputTokens : 0;

console.log(JSON.stringify({ cachedTokens: safeCached, inputTokens: safeInput }));
NODE
}

call_endpoint() {
  local payload_file="$1"
  local response_file="$2"

  local status
  status="$(curl -sS -o "$response_file" -w "%{http_code}" \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    --data-binary "@$payload_file")"

  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    local body
    body="$(head -c 500 "$response_file" | tr '\n' ' ')"
    echo "E_PROMPT_CACHE_SMOKE_HTTP_${status}: ${body}" >&2
    exit 1
  fi
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PAYLOAD1="$TMP_DIR/payload-1.json"
PAYLOAD2="$TMP_DIR/payload-2.json"
RESP1="$TMP_DIR/response-1.json"
RESP2="$TMP_DIR/response-2.json"

make_payload "$PAYLOAD1" "run-1"
make_payload "$PAYLOAD2" "run-2"

call_endpoint "$PAYLOAD1" "$RESP1"
call_endpoint "$PAYLOAD2" "$RESP2"

usage_one="$(extract_usage "$RESP1")"
usage_two="$(extract_usage "$RESP2")"

cached_one="$(node -e 'const v = JSON.parse(process.argv[1]); console.log(v.cachedTokens);' "$usage_one")"
cached_two="$(node -e 'const v = JSON.parse(process.argv[1]); console.log(v.cachedTokens);' "$usage_two")"
input_two="$(node -e 'const v = JSON.parse(process.argv[1]); console.log(v.inputTokens);' "$usage_two")"

hit_rate="$(node -e 'const c=Number(process.argv[1]); const i=Number(process.argv[2]); const d=Math.max(1,c+i); console.log((c/d).toFixed(4));' "$cached_two" "$input_two")"

if [[ "$cached_two" -le 0 ]]; then
  echo "E_PROMPT_CACHE_SMOKE_CACHE_MISS: second request reported cached_tokens=${cached_two}" >&2
  echo "Run1 usage: $usage_one" >&2
  echo "Run2 usage: $usage_two" >&2
  exit 1
fi

echo "PROMPT_CACHE_SMOKE_PASS cached_tokens_run1=${cached_one} cached_tokens_run2=${cached_two} hit_rate=${hit_rate}"
