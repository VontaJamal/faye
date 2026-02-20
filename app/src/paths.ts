import os from "node:os";
import path from "node:path";

export const HOME_DIR = os.homedir();
export const OPENCLAW_DIR = path.join(HOME_DIR, ".openclaw");
export const SECRETS_DIR = path.join(OPENCLAW_DIR, "secrets");
export const FAYE_STATE_DIR = path.join(OPENCLAW_DIR, "faye-voice");

export const LEGACY_CONFIG_PATH =
  process.env.FAYE_VOICE_CONFIG ?? path.join(OPENCLAW_DIR, "faye-voice-config.json");

export const RUNTIME_CONFIG_PATH =
  process.env.FAYE_RUNTIME_CONFIG ?? path.join(OPENCLAW_DIR, "faye-runtime-config.json");

export const LOCAL_EVENT_TOKEN_PATH = path.join(SECRETS_DIR, "faye-local-event-token.txt");
export const BRIDGE_OFFSET_PATH = path.join(FAYE_STATE_DIR, "telegram-bridge-offset.txt");
export const BRIDGE_PROCESSED_KEYS_PATH = path.join(FAYE_STATE_DIR, "telegram-bridge-processed-keys.json");
export const BRIDGE_RUNTIME_STATUS_PATH = path.join(FAYE_STATE_DIR, "telegram-bridge-runtime.json");

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:4587" as const;

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DASHBOARD_PUBLIC_DIR = path.join(REPO_ROOT, "dashboard", "public");

export const DEFAULT_ELEVENLABS_KEY_PATH = path.join(SECRETS_DIR, "elevenlabs-api-key.txt");
export const DEFAULT_TELEGRAM_TOKEN_PATH = path.join(SECRETS_DIR, "telegram-bot-token.txt");
