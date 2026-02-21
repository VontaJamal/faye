#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/bin:/usr/bin:$PATH"
CONFIG="${FAYE_VOICE_CONFIG:-$HOME/.openclaw/faye-voice-config.json}"
RUNTIME_CONFIG="${FAYE_RUNTIME_CONFIG:-$HOME/.openclaw/faye-runtime-config.json}"
LOCAL_API_BASE_URL="http://127.0.0.1:4587"
LOCAL_EVENT_TOKEN_FILE="$HOME/.openclaw/secrets/faye-local-event-token.txt"
TMPDIR="$HOME/.openclaw/faye-voice/tmp"
FAYE_STATE_DIR="$HOME/.openclaw/faye-voice"
STOP_REQUEST_FILE="${FAYE_CONVERSATION_STOP_REQUEST_FILE:-$FAYE_STATE_DIR/conversation-stop-request.json}"
LEARNED_VARIANTS_FILE="${FAYE_WAKE_LEARNED_VARIANTS_FILE:-$FAYE_STATE_DIR/wake-word-learned-variants.json}"
LEGACY_CONVERSATION_MAX_TURNS="${FAYE_CONVERSATION_MAX_TURNS:-}"
CONVERSATION_BASE_TURNS="${FAYE_CONVERSATION_BASE_TURNS:-${LEGACY_CONVERSATION_MAX_TURNS:-8}}"
CONVERSATION_EXTEND_BY="${FAYE_CONVERSATION_EXTEND_BY:-4}"
CONVERSATION_HARD_CAP="${FAYE_CONVERSATION_HARD_CAP:-16}"
CONVERSATION_RESPONSE_WAIT_SECONDS="${FAYE_CONVERSATION_RESPONSE_WAIT_SECONDS:-40}"
mkdir -p "$TMPDIR"
chmod 700 "$TMPDIR" || true
mkdir -p "$FAYE_STATE_DIR"
chmod 700 "$FAYE_STATE_DIR" || true

log() {
  local code="$1"
  local msg="$2"
  printf '%s | %s | %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$code" "$msg"
}

require_config() {
  [[ -f "$CONFIG" ]] || {
    log "E_CONFIG_MISSING" "Config not found at $CONFIG"
    exit 1
  }
}

json_get() {
  local expression="$1"
  python3 - "$CONFIG" "$expression" <<'PY'
import json
import sys
cfg = json.load(open(sys.argv[1]))
expr = sys.argv[2]
print(cfg.get(expr, ""))
PY
}

json_variants() {
  python3 - "$CONFIG" "$LEARNED_VARIANTS_FILE" <<'PY'
import json
import re
import sys

cfg_path = sys.argv[1]
learned_path = sys.argv[2]

def normalize(phrase):
    text = str(phrase or "").strip().lower()
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

with open(cfg_path, "r", encoding="utf-8") as fh:
    cfg = json.load(fh)

source_variants = []
configured = cfg.get("wake_word_variants")
if isinstance(configured, list):
    source_variants.extend(configured)

wake_word = cfg.get("wake_word", "faye arise")
source_variants.append(wake_word)

try:
    with open(learned_path, "r", encoding="utf-8") as fh:
        learned = json.load(fh)
        if isinstance(learned, list):
            source_variants.extend(learned)
except Exception:
    pass

seen = set()
variants = []
for value in source_variants:
    norm = normalize(value)
    if not norm or norm in seen:
        continue
    seen.add(norm)
    variants.append(norm)

if not variants:
    variants = ["faye arise"]

print(json.dumps(variants))
PY
}

read_secret() {
  local file="$1"
  [[ -f "$file" ]] || { echo ""; return; }
  tr -d '\n' < "$file"
}

post_local_event() {
  local event_type="$1"
  local payload_json="$2"

  if [[ -f "$RUNTIME_CONFIG" ]]; then
    LOCAL_API_BASE_URL=$(python3 - "$RUNTIME_CONFIG" <<'PY'
import json
import sys
cfg = json.load(open(sys.argv[1]))
print(cfg.get("localApiBaseUrl", "http://127.0.0.1:4587"))
PY
)
  fi

  local token
  token=$(read_secret "$LOCAL_EVENT_TOKEN_FILE")
  [[ -n "$token" ]] || return 0

  curl -sS --max-time 5 --retry 1 --retry-all-errors \
    -X POST "${LOCAL_API_BASE_URL}/v1/internal/listener-event" \
    -H "Content-Type: application/json" \
    -H "x-faye-local-token: ${token}" \
    -d "{\"type\":\"${event_type}\",\"payload\":${payload_json}}" \
    >/dev/null 2>&1 || true
}

transcribe_clip() {
  local clip="$1"
  local response
  local status

  response="$(mktemp)"
  status=$(curl -sS -o "$response" -w "%{http_code}" \
    --retry 2 --retry-all-errors --max-time 30 \
    -X POST "https://api.elevenlabs.io/v1/speech-to-text" \
    -H "xi-api-key: ${API_KEY}" \
    -F "file=@${clip}" \
    -F "model_id=scribe_v1" || echo 000)

  if [[ "$status" -ge 400 || "$status" == "000" ]]; then
    local body
    body=$(tr -d '\n' < "$response" | head -c 200)
    rm -f "$response"
    log "E_STT_HTTP" "status=${status} body=${body}"
    post_local_event "listener_error" "{\"code\":\"E_STT_HTTP\",\"status\":${status}}"
    echo ""
    return
  fi

  python3 - "$response" <<'PY'
import json
import sys
try:
    payload = json.load(open(sys.argv[1]))
except Exception:
    print("")
    sys.exit(0)
print((payload.get("text") or "").strip())
PY

  rm -f "$response"
}

wake_match() {
  local heard="$1"
  python3 - "$heard" "$VARIANTS_JSON" <<'PY'
import difflib
import json
import re
import sys

heard = str(sys.argv[1] or "")
variants = json.loads(sys.argv[2] or "[]")

def normalize_phrase(text):
    value = str(text or "").strip().lower()
    value = re.sub(r"[^a-z0-9\s]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value

def merge_split_tokens(tokens):
    merged = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token == "a" and i + 1 < len(tokens) and tokens[i + 1] == "rise":
            merged.append("arise")
            i += 2
            continue
        merged.append(token)
        i += 1
    return merged

def phonetic_key(token):
    text = token.lower()
    text = re.sub(r"[^a-z0-9]", "", text)
    if not text:
        return ""
    text = text.replace("ph", "f").replace("ck", "k")
    text = re.sub(r"th", "t", text)
    text = re.sub(r"[fbpv]", "b", text)
    text = re.sub(r"[ckq]", "k", text)
    text = re.sub(r"[gj]", "j", text)
    text = re.sub(r"[zs]", "s", text)
    text = re.sub(r"[dt]", "t", text)
    text = re.sub(r"[aeiouy]+", "a", text)
    text = re.sub(r"(.)\1+", r"\1", text)
    return text

def token_similarity(left, right):
    if left == right:
        return 1.0
    base = difflib.SequenceMatcher(None, left, right).ratio()
    if phonetic_key(left) and phonetic_key(left) == phonetic_key(right):
        return max(base, 0.88)
    return base

heard_norm = normalize_phrase(heard)
if not heard_norm:
    print("0\t")
    sys.exit(0)

heard_tokens = merge_split_tokens(heard_norm.split())
if not heard_tokens:
    print("0\t")
    sys.exit(0)

for raw_variant in variants:
    variant = normalize_phrase(raw_variant)
    if not variant:
        continue
    variant_tokens = merge_split_tokens(variant.split())
    if not variant_tokens:
        continue

    target_len = len(variant_tokens)
    if target_len == 0 or len(heard_tokens) < target_len:
        continue

    for start in range(0, len(heard_tokens) - target_len + 1):
        window_tokens = heard_tokens[start:start + target_len]
        candidate = " ".join(window_tokens)

        if candidate == variant:
            print("1\t")
            sys.exit(0)

        exact_count = 0
        close_count = 0
        avg_similarity = 0.0
        for cand_token, variant_token in zip(window_tokens, variant_tokens):
            similarity = token_similarity(cand_token, variant_token)
            avg_similarity += similarity
            if cand_token == variant_token:
                exact_count += 1
                close_count += 1
            elif similarity >= 0.72:
                close_count += 1

        avg_similarity = avg_similarity / float(target_len)
        # Adaptive match rule:
        # - At least one token is exact.
        # - Every token is close enough.
        # - Aggregate similarity is high enough to avoid false positives.
        if exact_count >= 1 and close_count == target_len and avg_similarity >= 0.78:
            learned = candidate if candidate != variant else ""
            print(f"1\t{learned}")
            sys.exit(0)

print("0\t")
PY
}

remember_wake_variant() {
  local variant="$1"
  [[ -n "$variant" ]] || return 0
  python3 - "$LEARNED_VARIANTS_FILE" "$variant" <<'PY'
import json
import os
import re
import stat
import tempfile
import sys

path = sys.argv[1]
incoming = sys.argv[2]

def normalize(phrase):
    text = str(phrase or "").strip().lower()
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

candidate = normalize(incoming)
if not candidate:
    sys.exit(0)

items = []
if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            items = [normalize(x) for x in data if normalize(x)]
    except Exception:
        items = []

if candidate in items:
    sys.exit(0)

items.append(candidate)
items = items[-24:]

directory = os.path.dirname(path) or "."
os.makedirs(directory, exist_ok=True)
fd, tmp_path = tempfile.mkstemp(prefix=".wake-variants-", suffix=".json", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(items, fh, indent=2)
        fh.write("\n")
    os.chmod(tmp_path, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(tmp_path, path)
except Exception:
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    raise
PY
}

is_explicit_stop() {
  local spoken="$1"
  python3 - "$spoken" <<'PY'
import sys

spoken = (sys.argv[1] or "").strip().lower()
stop_phrases = [
    "stop conversation",
    "end conversation",
    "stop listening",
    "goodbye faye",
    "thanks faye stop",
    "that's all",
    "that is all",
]

for phrase in stop_phrases:
    if phrase in spoken:
        print("1")
        sys.exit(0)

print("0")
PY
}

send_telegram() {
  local text="$1"
  if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
    return 0
  fi

  curl -sS --retry 2 --retry-all-errors --max-time 10 \
    -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    --data-urlencode "text=${text}" >/dev/null 2>&1 || true
}

speak_local() {
  local text="$1"
  local escaped_text
  escaped_text="$(json_escape "$text")"
  curl -sS --max-time 8 --retry 1 --retry-all-errors \
    -X POST "${LOCAL_API_BASE_URL}/v1/speak" \
    -H "Content-Type: application/json" \
    -d "{\"text\":${escaped_text}}" \
    >/dev/null 2>&1 || true
}

json_escape() {
  local value="$1"
  python3 - "$value" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1]))
PY
}

new_session_id() {
  python3 - <<'PY'
import secrets
import time
print(f"s-{int(time.time())}-{secrets.token_hex(3)}")
PY
}

consume_external_stop_request() {
  local session_id="$1"
  python3 - "$STOP_REQUEST_FILE" "$session_id" <<'PY'
import json
import os
import re
import sys

path = sys.argv[1]
target = sys.argv[2]

def normalized(value):
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9_:-]+", "_", text)[:80]
    return text or "external_stop"

if not os.path.exists(path):
    print("")
    sys.exit(0)

try:
    with open(path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
except Exception:
    try:
        os.remove(path)
    except OSError:
        pass
    print("external_stop")
    sys.exit(0)

session_id = str(payload.get("sessionId", "")).strip()
if session_id and session_id not in (target, "*", "active"):
    print("")
    sys.exit(0)

_ = normalized(payload.get("reason"))
try:
    os.remove(path)
except OSError:
    pass

print("external_stop")
PY
}

emit_turn_started() {
  local session_id="$1"
  local turn="$2"
  local session_json
  session_json="$(json_escape "$session_id")"
  post_local_event "conversation_turn_started" "{\"session_id\":${session_json},\"turn\":${turn}}"
}

emit_turn_completed() {
  local session_id="$1"
  local turn="$2"
  local wait_result="$3"
  local session_json
  session_json="$(json_escape "$session_id")"
  post_local_event "conversation_turn_completed" "{\"session_id\":${session_json},\"turn\":${turn},\"wait_result\":\"${wait_result}\"}"
}

wait_for_roundtrip_completion() {
  local session_id="$1"
  local timeout_seconds="$2"
  local started_at
  started_at=$(date +%s)

  while true; do
    local payload
    payload="$(curl -sS --max-time 4 "${LOCAL_API_BASE_URL}/v1/health" || true)"

    if [[ -n "$payload" ]]; then
      local pending
      pending=$(python3 - "$session_id" <<'PY' <<<"$payload"
import json
import sys

target = sys.argv[1]
raw = sys.stdin.read()

try:
    doc = json.loads(raw)
except Exception:
    print("1")
    sys.exit(0)

pending_sessions = ((doc.get("roundTrip") or {}).get("pendingSessions") or [])
for item in pending_sessions:
    if isinstance(item, dict) and str(item.get("sessionId", "")).strip() == target:
        print("1")
        sys.exit(0)

print("0")
PY
)

      if [[ "$pending" == "0" ]]; then
        return 0
      fi
    fi

    local now elapsed
    now=$(date +%s)
    elapsed=$((now - started_at))
    if [[ "$elapsed" -ge "$timeout_seconds" ]]; then
      return 1
    fi
    sleep 0.4
  done
}

require_config
API_KEY_PATH="$(json_get "elevenlabs_api_key_path")"
WAKE_WORD="$(json_get "wake_word")"
THRESHOLD="$(json_get "silence_threshold")"
BOT_TOKEN_PATH="$(json_get "telegram_bot_token_path")"
CHAT_ID="$(json_get "telegram_chat_id")"
VARIANTS_JSON="$(json_variants)"

[[ -n "$WAKE_WORD" ]] || WAKE_WORD="Faye Arise"
[[ -n "$THRESHOLD" ]] || THRESHOLD="0.5%"
if ! [[ "$CONVERSATION_BASE_TURNS" =~ ^[0-9]+$ ]] || [[ "$CONVERSATION_BASE_TURNS" -lt 1 ]]; then
  CONVERSATION_BASE_TURNS=8
fi
if ! [[ "$CONVERSATION_EXTEND_BY" =~ ^[0-9]+$ ]] || [[ "$CONVERSATION_EXTEND_BY" -lt 1 ]]; then
  CONVERSATION_EXTEND_BY=4
fi
if ! [[ "$CONVERSATION_HARD_CAP" =~ ^[0-9]+$ ]] || [[ "$CONVERSATION_HARD_CAP" -lt 1 ]]; then
  CONVERSATION_HARD_CAP=16
fi
if [[ "$CONVERSATION_HARD_CAP" -lt "$CONVERSATION_BASE_TURNS" ]]; then
  CONVERSATION_HARD_CAP="$CONVERSATION_BASE_TURNS"
fi
if ! [[ "$CONVERSATION_RESPONSE_WAIT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$CONVERSATION_RESPONSE_WAIT_SECONDS" -lt 5 ]]; then
  CONVERSATION_RESPONSE_WAIT_SECONDS=40
fi

API_KEY="$(read_secret "${API_KEY_PATH/#\~/$HOME}")"
BOT_TOKEN="$(read_secret "${BOT_TOKEN_PATH/#\~/$HOME}")"

if [[ -z "$API_KEY" ]]; then
  log "E_API_KEY_MISSING" "ElevenLabs API key file is missing or empty"
  exit 1
fi

log "LISTENER_START" "wake_word='${WAKE_WORD}' threshold='${THRESHOLD}' base_turns='${CONVERSATION_BASE_TURNS}' extend_by='${CONVERSATION_EXTEND_BY}' hard_cap='${CONVERSATION_HARD_CAP}'"
post_local_event "listener_status" "{\"status\":\"started\",\"wake_word\":\"${WAKE_WORD}\",\"base_turns\":${CONVERSATION_BASE_TURNS},\"extend_by\":${CONVERSATION_EXTEND_BY},\"hard_cap\":${CONVERSATION_HARD_CAP}}"

while true; do
  clip="$TMPDIR/wake-check.wav"
  rec -q "$clip" rate 16k channels 1 \
    silence 1 0.2 "$THRESHOLD" \
    1 1.0 "$THRESHOLD" \
    trim 0 6 \
    2>/dev/null || true

  [[ -s "$clip" ]] || continue
  size=$(stat -f%z "$clip" 2>/dev/null || stat -c%s "$clip" 2>/dev/null || echo 0)
  if [[ "$size" -lt 10000 ]]; then
    rm -f "$clip"
    continue
  fi

  transcript="$(transcribe_clip "$clip")"
  rm -f "$clip"

  heard="$(echo "$transcript" | tr '[:upper:]' '[:lower:]')"
  [[ -n "$heard" ]] || continue
  log "HEARD" "$heard"

  match_output="$(wake_match "$heard")"
  match_flag="$(printf '%s' "$match_output" | cut -f1)"
  learned_variant="$(printf '%s' "$match_output" | cut -f2-)"

  if [[ "$match_flag" != "1" ]]; then
    continue
  fi

  if [[ -n "$learned_variant" ]]; then
    remember_wake_variant "$learned_variant" || true
    VARIANTS_JSON="$(json_variants)"
    learned_variant_json="$(json_escape "$learned_variant")"
    wake_word_json="$(json_escape "$WAKE_WORD")"
    post_local_event "wake_variant_learned" "{\"variant\":${learned_variant_json},\"wake_word\":${wake_word_json}}"
    log "WAKE_VARIANT_LEARNED" "$learned_variant"
  fi

  log "WAKE_DETECTED" "$heard"
  session_id="$(new_session_id)"
  heard_json="$(json_escape "$heard")"
  wake_word_json="$(json_escape "$WAKE_WORD")"
  session_json="$(json_escape "$session_id")"
  post_local_event "wake_detected" "{\"heard\":${heard_json},\"wake_word\":${wake_word_json},\"session_id\":${session_json}}"
  if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
    log "WAKE_LOCAL_ACK" "No Telegram bridge credentials configured; speaking local wake acknowledgment"
    speak_local "${FAYE_WAKE_ACK_TEXT:-I am here and listening. Tell me what you need.}"
  fi
  send_telegram "#faye_wake session=${session_id} wake_word=${WAKE_WORD}"
  current_turn_limit="$CONVERSATION_BASE_TURNS"
  post_local_event "listener_status" "{\"status\":\"conversation_loop_started\",\"session_id\":${session_json},\"base_turns\":${CONVERSATION_BASE_TURNS},\"extend_by\":${CONVERSATION_EXTEND_BY},\"hard_cap\":${CONVERSATION_HARD_CAP},\"max_turns\":${current_turn_limit}}"

  turn=0
  turns_sent=0
  loop_reason="idle_timeout"
  loop_active=1

  while [[ "$loop_active" -eq 1 ]]; do
    if [[ -n "$(consume_external_stop_request "$session_id")" ]]; then
      loop_reason="external_stop"
      break
    fi

    if [[ "$turn" -ge "$current_turn_limit" ]]; then
      if [[ "$current_turn_limit" -lt "$CONVERSATION_HARD_CAP" ]]; then
        next_turn_limit=$((current_turn_limit + CONVERSATION_EXTEND_BY))
        if [[ "$next_turn_limit" -gt "$CONVERSATION_HARD_CAP" ]]; then
          next_turn_limit="$CONVERSATION_HARD_CAP"
        fi

        if [[ "$next_turn_limit" -gt "$current_turn_limit" ]]; then
          current_turn_limit="$next_turn_limit"
          log "CONVERSATION_LOOP_EXTENDED" "session=${session_id} max_turns=${current_turn_limit}"
          post_local_event "listener_status" "{\"status\":\"conversation_loop_extended\",\"session_id\":${session_json},\"max_turns\":${current_turn_limit},\"hard_cap\":${CONVERSATION_HARD_CAP}}"
          continue
        fi
      fi

      loop_reason="max_turns_reached"
      break
    fi

    turn=$((turn + 1))
    emit_turn_started "$session_id" "$turn"

    msg_clip="$TMPDIR/message-${session_id}-${turn}.wav"
    rec -q "$msg_clip" rate 16k channels 1 \
      silence 1 0.3 "$THRESHOLD" \
      1 2.0 "$THRESHOLD" \
      trim 0 30 \
      2>/dev/null || true

    if [[ ! -s "$msg_clip" ]]; then
      rm -f "$msg_clip"
      emit_turn_completed "$session_id" "$turn" "idle_no_audio"
      loop_reason="idle_timeout"
      break
    fi

    size=$(stat -f%z "$msg_clip" 2>/dev/null || stat -c%s "$msg_clip" 2>/dev/null || echo 0)
    if [[ "$size" -lt 10000 ]]; then
      rm -f "$msg_clip"
      emit_turn_completed "$session_id" "$turn" "idle_audio_too_small"
      loop_reason="idle_timeout"
      break
    fi

    msg_text="$(transcribe_clip "$msg_clip")"
    rm -f "$msg_clip"
    if [[ -z "$msg_text" ]]; then
      emit_turn_completed "$session_id" "$turn" "idle_no_transcript"
      loop_reason="idle_timeout"
      break
    fi

    log "MESSAGE" "$msg_text"
    escaped_msg="$(json_escape "$msg_text")"
    post_local_event "message_transcribed" "{\"text\":${escaped_msg},\"session_id\":${session_json},\"turn\":${turn}}"

    if [[ "$(is_explicit_stop "$msg_text")" == "1" ]]; then
      emit_turn_completed "$session_id" "$turn" "explicit_user_stop"
      loop_reason="explicit_user_stop"
      break
    fi

    send_telegram "#faye_voice session=${session_id} turn=${turn} text=${msg_text}"
    turns_sent=$((turns_sent + 1))

    wait_result="completed"
    if [[ -n "$BOT_TOKEN" && -n "$CHAT_ID" ]]; then
      if ! wait_for_roundtrip_completion "$session_id" "$CONVERSATION_RESPONSE_WAIT_SECONDS"; then
        log "ROUNDTRIP_WAIT_TIMEOUT" "session=${session_id} turn=${turn}"
        emit_turn_completed "$session_id" "$turn" "agent_timeout"
        loop_reason="agent_timeout"
        break
      fi
    else
      wait_result="sent_no_bridge"
    fi

    if [[ -n "$(consume_external_stop_request "$session_id")" ]]; then
      emit_turn_completed "$session_id" "$turn" "external_stop"
      loop_reason="external_stop"
      break
    fi

    emit_turn_completed "$session_id" "$turn" "$wait_result"
  done

  post_local_event "listener_status" "{\"status\":\"conversation_loop_ended\",\"session_id\":${session_json},\"turns\":${turns_sent},\"max_turns\":${current_turn_limit},\"reason\":\"${loop_reason}\"}"

done
