import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIDGE_OFFSET_PATH,
  DEFAULT_API_BASE_URL,
  DEFAULT_ELEVENLABS_KEY_PATH,
  DEFAULT_TELEGRAM_TOKEN_PATH,
  FAYE_STATE_DIR,
  LOCAL_EVENT_TOKEN_PATH,
  OPENCLAW_DIR,
  SECRETS_DIR
} from "../paths";

test("paths constants stay anchored to openclaw directories", () => {
  assert.equal(DEFAULT_API_BASE_URL, "http://127.0.0.1:4587");
  assert.equal(SECRETS_DIR.startsWith(OPENCLAW_DIR), true);
  assert.equal(FAYE_STATE_DIR.startsWith(OPENCLAW_DIR), true);
  assert.equal(DEFAULT_ELEVENLABS_KEY_PATH.startsWith(SECRETS_DIR), true);
  assert.equal(DEFAULT_TELEGRAM_TOKEN_PATH.startsWith(SECRETS_DIR), true);
  assert.equal(LOCAL_EVENT_TOKEN_PATH.startsWith(SECRETS_DIR), true);
  assert.equal(BRIDGE_OFFSET_PATH.startsWith(FAYE_STATE_DIR), true);
});
