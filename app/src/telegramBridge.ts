import fs from "node:fs/promises";
import path from "node:path";

import { createLogger } from "./logger";
import {
  BRIDGE_OFFSET_PATH,
  BRIDGE_PROCESSED_KEYS_PATH,
  BRIDGE_RUNTIME_STATUS_PATH,
  DEFAULT_API_BASE_URL,
  FAYE_STATE_DIR,
  LOCAL_EVENT_TOKEN_PATH
} from "./paths";
import { ConfigStore } from "./store";
import type { BridgeCommand } from "./telegramBridgeParser";
import { parseBridgeCommand } from "./telegramBridgeParser";
import { ensureDir, expandHomePath, pathExists, readSecret } from "./utils";

interface TelegramMessage {
  message_id: number;
  text?: string;
  date?: number;
  chat?: {
    id?: number;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

export interface BridgeRuntimeStatus {
  state: "starting" | "idle" | "processing" | "error";
  updatedAt: string;
  consecutiveErrors: number;
  backoffMs: number;
  lastErrorAt?: string;
  lastError?: string;
  lastSuccessAt?: string;
  lastOffset?: number;
  lastUpdateId?: number;
  lastCommandType?: string;
  lastCommandStatus?: "ok" | "error" | "duplicate";
}

interface ProcessedKeyStore {
  order: string[];
  set: Set<string>;
}

interface ProcessUpdateDependencies {
  callLocalApiFn?: (pathname: string, body?: unknown) => Promise<void>;
  sendTelegramFn?: (botToken: string, chatId: number, text: string) => Promise<void>;
  writeOffsetFn?: (offset: number) => Promise<void>;
  hasProcessedFn?: (key: string) => Promise<boolean>;
  markProcessedFn?: (key: string) => Promise<void>;
  recordRuntimeFn?: (patch: Partial<BridgeRuntimeStatus>) => Promise<void>;
  emitLocalEventFn?: (eventType: string, payload: Record<string, unknown>) => Promise<void>;
}

const PROCESSED_KEYS_LIMIT = 2500;
let processedKeysCache: ProcessedKeyStore | null = null;
let runtimeCache: BridgeRuntimeStatus | null = null;
let localEventTokenCache: string | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOffset(): Promise<number> {
  if (!(await pathExists(BRIDGE_OFFSET_PATH))) {
    return 0;
  }

  const raw = (await fs.readFile(BRIDGE_OFFSET_PATH, "utf8")).trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function writeOffset(offset: number): Promise<void> {
  await ensureDir(path.dirname(BRIDGE_OFFSET_PATH));
  await fs.writeFile(BRIDGE_OFFSET_PATH, `${offset}\n`, { mode: 0o600 });
  await fs.chmod(BRIDGE_OFFSET_PATH, 0o600);
}

function defaultRuntimeStatus(): BridgeRuntimeStatus {
  return {
    state: "starting",
    updatedAt: new Date().toISOString(),
    consecutiveErrors: 0,
    backoffMs: 2000
  };
}

function normalizeRuntimeStatus(input: unknown): BridgeRuntimeStatus {
  const raw = input && typeof input === "object" ? (input as Partial<BridgeRuntimeStatus>) : {};
  const now = new Date().toISOString();

  return {
    state:
      raw.state === "starting" || raw.state === "idle" || raw.state === "processing" || raw.state === "error"
        ? raw.state
        : "starting",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    consecutiveErrors: Number.isFinite(raw.consecutiveErrors) ? Math.max(0, Number(raw.consecutiveErrors)) : 0,
    backoffMs: Number.isFinite(raw.backoffMs) ? Math.max(500, Number(raw.backoffMs)) : 2000,
    lastErrorAt: typeof raw.lastErrorAt === "string" ? raw.lastErrorAt : undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    lastSuccessAt: typeof raw.lastSuccessAt === "string" ? raw.lastSuccessAt : undefined,
    lastOffset: Number.isFinite(raw.lastOffset) ? Number(raw.lastOffset) : undefined,
    lastUpdateId: Number.isFinite(raw.lastUpdateId) ? Number(raw.lastUpdateId) : undefined,
    lastCommandType: typeof raw.lastCommandType === "string" ? raw.lastCommandType : undefined,
    lastCommandStatus:
      raw.lastCommandStatus === "ok" || raw.lastCommandStatus === "error" || raw.lastCommandStatus === "duplicate"
        ? raw.lastCommandStatus
        : undefined
  };
}

async function loadRuntimeStatus(): Promise<BridgeRuntimeStatus> {
  if (runtimeCache) {
    return runtimeCache;
  }

  if (!(await pathExists(BRIDGE_RUNTIME_STATUS_PATH))) {
    runtimeCache = defaultRuntimeStatus();
    return runtimeCache;
  }

  try {
    const raw = await fs.readFile(BRIDGE_RUNTIME_STATUS_PATH, "utf8");
    runtimeCache = normalizeRuntimeStatus(JSON.parse(raw) as unknown);
    return runtimeCache;
  } catch {
    runtimeCache = defaultRuntimeStatus();
    return runtimeCache;
  }
}

async function persistRuntimeStatus(status: BridgeRuntimeStatus): Promise<void> {
  await ensureDir(path.dirname(BRIDGE_RUNTIME_STATUS_PATH));
  await fs.writeFile(BRIDGE_RUNTIME_STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(BRIDGE_RUNTIME_STATUS_PATH, 0o600);
}

async function updateRuntimeStatus(patch: Partial<BridgeRuntimeStatus>): Promise<void> {
  const current = await loadRuntimeStatus();
  runtimeCache = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await persistRuntimeStatus(runtimeCache);
}

export async function readBridgeRuntimeStatus(): Promise<BridgeRuntimeStatus | null> {
  if (!(await pathExists(BRIDGE_RUNTIME_STATUS_PATH))) {
    return null;
  }

  try {
    const raw = await fs.readFile(BRIDGE_RUNTIME_STATUS_PATH, "utf8");
    return normalizeRuntimeStatus(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

async function loadProcessedKeyStore(): Promise<ProcessedKeyStore> {
  if (processedKeysCache) {
    return processedKeysCache;
  }

  if (!(await pathExists(BRIDGE_PROCESSED_KEYS_PATH))) {
    processedKeysCache = { order: [], set: new Set() };
    return processedKeysCache;
  }

  try {
    const raw = await fs.readFile(BRIDGE_PROCESSED_KEYS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { keys?: string[] };
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter((item) => typeof item === "string") : [];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(key);
      }
    }
    const trimmed = deduped.slice(-PROCESSED_KEYS_LIMIT);
    processedKeysCache = {
      order: trimmed,
      set: new Set(trimmed)
    };
    return processedKeysCache;
  } catch {
    processedKeysCache = { order: [], set: new Set() };
    return processedKeysCache;
  }
}

async function persistProcessedKeyStore(store: ProcessedKeyStore): Promise<void> {
  await ensureDir(path.dirname(BRIDGE_PROCESSED_KEYS_PATH));
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    keys: store.order
  };
  await fs.writeFile(BRIDGE_PROCESSED_KEYS_PATH, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(BRIDGE_PROCESSED_KEYS_PATH, 0o600);
}

async function hasProcessedCommandKey(key: string): Promise<boolean> {
  const store = await loadProcessedKeyStore();
  return store.set.has(key);
}

async function markProcessedCommandKey(key: string): Promise<void> {
  const store = await loadProcessedKeyStore();
  if (store.set.has(key)) {
    return;
  }

  store.order.push(key);
  store.set.add(key);

  while (store.order.length > PROCESSED_KEYS_LIMIT) {
    const removed = store.order.shift();
    if (removed) {
      store.set.delete(removed);
    }
  }

  await persistProcessedKeyStore(store);
}

function bridgeCommandKey(command: BridgeCommand, updateId: number): string {
  if (command.type === "speak") {
    return command.sessionId ? `speak:session:${command.sessionId}:update:${updateId}` : `speak:update:${updateId}`;
  }
  if (command.type === "activate_profile") {
    return `activate:${command.profileId}:update:${updateId}`;
  }
  return `ping:update:${updateId}`;
}

async function telegramRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`E_TELEGRAM_HTTP_${response.status}: ${text.slice(0, 180)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function toChatId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

async function callLocalApi(pathname: string, body?: unknown): Promise<void> {
  const response = await fetch(`http://127.0.0.1:4587${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`E_LOCAL_API_${response.status}: ${text.slice(0, 180)}`);
  }
}

async function sendTelegram(botToken: string, chatId: number, text: string): Promise<void> {
  const payload = new URLSearchParams();
  payload.set("chat_id", String(chatId));
  payload.set("text", text);

  await telegramRequest<{ ok: boolean }>(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload.toString()
  });
}

async function readLocalEventToken(): Promise<string | null> {
  if (typeof localEventTokenCache === "string" && localEventTokenCache.length > 0) {
    return localEventTokenCache;
  }

  if (!(await pathExists(LOCAL_EVENT_TOKEN_PATH))) {
    return null;
  }

  try {
    const token = await readSecret(LOCAL_EVENT_TOKEN_PATH);
    if (!token) {
      return null;
    }
    localEventTokenCache = token;
    return token;
  } catch {
    return null;
  }
}

async function emitLocalEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const token = await readLocalEventToken();
  if (!token) {
    return;
  }

  const response = await fetch(`${DEFAULT_API_BASE_URL}/v1/internal/listener-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-faye-local-token": token
    },
    body: JSON.stringify({
      type: eventType,
      payload
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`E_LOCAL_EVENT_${response.status}: ${text.slice(0, 180)}`);
  }
}

async function getBridgeCredentials(store: ConfigStore): Promise<{ botToken: string; chatId: number } | null> {
  const active = store.getActiveProfile();
  if (!active.telegramBotTokenPath || !active.telegramChatId) {
    return null;
  }

  const chatId = toChatId(active.telegramChatId);
  if (chatId === null) {
    return null;
  }

  const tokenPath = expandHomePath(active.telegramBotTokenPath);
  if (!(await pathExists(tokenPath))) {
    return null;
  }

  const botToken = await readSecret(tokenPath);
  if (!botToken) {
    return null;
  }

  return { botToken, chatId };
}

export async function processUpdates(
  botToken: string,
  chatId: number,
  updates: TelegramUpdate[],
  logger: ReturnType<typeof createLogger>,
  deps?: ProcessUpdateDependencies
): Promise<number> {
  const callLocalApiFn = deps?.callLocalApiFn ?? callLocalApi;
  const sendTelegramFn = deps?.sendTelegramFn ?? sendTelegram;
  const writeOffsetFn = deps?.writeOffsetFn ?? writeOffset;
  const hasProcessedFn = deps?.hasProcessedFn ?? hasProcessedCommandKey;
  const markProcessedFn = deps?.markProcessedFn ?? markProcessedCommandKey;
  const recordRuntimeFn = deps?.recordRuntimeFn ?? updateRuntimeStatus;
  const emitLocalEventFn = deps?.emitLocalEventFn ?? emitLocalEvent;
  let maxOffset = 0;

  for (const update of updates) {
    maxOffset = Math.max(maxOffset, update.update_id);
    await recordRuntimeFn({
      state: "processing",
      lastUpdateId: update.update_id
    });

    const message = update.message;
    if (!message?.text || message.chat?.id !== chatId) {
      await writeOffsetFn(maxOffset);
      await recordRuntimeFn({ lastOffset: maxOffset });
      continue;
    }

    const command = parseBridgeCommand(message.text);
    if (!command) {
      await writeOffsetFn(maxOffset);
      continue;
    }

    const commandKey = bridgeCommandKey(command, update.update_id);
    if (await hasProcessedFn(commandKey)) {
      logger.info("BRIDGE_DUPLICATE_SKIP", "Duplicate bridge command skipped", {
        commandKey,
        updateId: update.update_id
      });
      await recordRuntimeFn({
        lastCommandType: command.type,
        lastCommandStatus: "duplicate"
      });

      if (command.type === "speak" && command.sessionId) {
        await sendTelegramFn(botToken, chatId, `#faye_spoken status=duplicate session=${command.sessionId}`).catch(() => undefined);
        await emitLocalEventFn("bridge_spoken", {
          session_id: command.sessionId,
          status: "duplicate",
          turn: command.turn
        }).catch(() => undefined);
      }

      await writeOffsetFn(maxOffset);
      await recordRuntimeFn({ lastOffset: maxOffset });
      continue;
    }

    try {
      if (command.type === "ping") {
        await markProcessedFn(commandKey);
        await sendTelegramFn(botToken, chatId, "#faye_pong status=online");
      } else if (command.type === "activate_profile") {
        await callLocalApiFn(`/v1/profiles/${encodeURIComponent(command.profileId)}/activate`);
        await markProcessedFn(commandKey);
        await sendTelegramFn(botToken, chatId, `#faye_ack action=activate_profile profile=${command.profileId} status=ok`);
      } else if (command.type === "speak") {
        if (command.sessionId) {
          await emitLocalEventFn("bridge_speak_received", {
            session_id: command.sessionId,
            update_id: update.update_id,
            text: command.text,
            turn: command.turn
          }).catch(() => undefined);
        }

        await callLocalApiFn("/v1/speak", {
          text: command.text
        });
        await markProcessedFn(commandKey);

        const sessionPart = command.sessionId ? ` session=${command.sessionId}` : "";
        await sendTelegramFn(botToken, chatId, `#faye_spoken status=ok${sessionPart}`);

        if (command.sessionId) {
          await emitLocalEventFn("bridge_spoken", {
            session_id: command.sessionId,
            status: "ok",
            turn: command.turn
          }).catch(() => undefined);
        }
      }
      await recordRuntimeFn({
        lastCommandType: command.type,
        lastCommandStatus: "ok"
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.warn("BRIDGE_CMD_FAIL", "Bridge command failed", {
        command,
        updateId: update.update_id,
        message: messageText
      });
      await recordRuntimeFn({
        lastCommandType: command.type,
        lastCommandStatus: "error",
        lastErrorAt: new Date().toISOString(),
        lastError: messageText.slice(0, 200)
      });

      const sessionPart = command.type === "speak" && command.sessionId ? ` session=${command.sessionId}` : "";
      await sendTelegramFn(botToken, chatId, `#faye_spoken status=error${sessionPart}`).catch(() => undefined);
      if (command.type === "speak" && command.sessionId) {
        await emitLocalEventFn("bridge_spoken", {
          session_id: command.sessionId,
          status: "error",
          turn: command.turn
        }).catch(() => undefined);
      }
    }

    await writeOffsetFn(maxOffset);
    await recordRuntimeFn({ lastOffset: maxOffset });
  }

  return maxOffset;
}

async function bootstrapOffset(botToken: string, logger: ReturnType<typeof createLogger>): Promise<void> {
  const current = await readOffset();
  if (current > 0) {
    return;
  }

  const response = await telegramRequest<TelegramResponse>(
    `https://api.telegram.org/bot${botToken}/getUpdates?timeout=0&limit=100`
  );

  if (!response.ok || response.result.length === 0) {
    return;
  }

  const latestUpdate = response.result.reduce<TelegramUpdate | null>((latest, item) => {
    if (!latest || item.update_id > latest.update_id) {
      return item;
    }
    return latest;
  }, null);

  if (!latestUpdate) {
    return;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const messageAge = typeof latestUpdate.message?.date === "number" ? nowUnix - latestUpdate.message.date : null;
  const recentWindowSeconds = 120;
  const allowReplayLatest = messageAge !== null && messageAge >= 0 && messageAge <= recentWindowSeconds;
  const bootstrapOffset = allowReplayLatest ? Math.max(0, latestUpdate.update_id - 1) : latestUpdate.update_id;

  await writeOffset(bootstrapOffset);
  logger.info("BRIDGE_BOOTSTRAP", "Initialized Telegram offset", {
    offset: bootstrapOffset,
    latestUpdateId: latestUpdate.update_id,
    replayLatest: allowReplayLatest
  });
}

export async function startTelegramBridge(): Promise<void> {
  const logger = createLogger();
  await ensureDir(FAYE_STATE_DIR);
  await loadRuntimeStatus();
  await updateRuntimeStatus({
    state: "starting",
    consecutiveErrors: 0,
    backoffMs: 2000
  });

  const store = new ConfigStore(logger);
  await store.init();

  logger.info("BRIDGE_START", "Faye Telegram bridge starting", {});
  let consecutiveErrors = 0;
  let backoffMs = 2000;

  while (true) {
    try {
      await store.init();
      const creds = await getBridgeCredentials(store);
      await updateRuntimeStatus({
        state: "idle",
        consecutiveErrors,
        backoffMs
      });

      if (!creds) {
        logger.warn("BRIDGE_NO_TELEGRAM", "Telegram credentials not configured; sleeping", {});
        await updateRuntimeStatus({
          state: "idle",
          consecutiveErrors: 0,
          backoffMs: 5000
        });
        await sleep(5000);
        continue;
      }

      await bootstrapOffset(creds.botToken, logger);
      const offset = await readOffset();
      await updateRuntimeStatus({
        state: "processing",
        lastOffset: offset,
        consecutiveErrors,
        backoffMs
      });
      const response = await telegramRequest<TelegramResponse>(
        `https://api.telegram.org/bot${creds.botToken}/getUpdates?timeout=25&offset=${offset + 1}&allowed_updates=["message"]`
      );

      if (!response.ok || response.result.length === 0) {
        consecutiveErrors = 0;
        backoffMs = 2000;
        await updateRuntimeStatus({
          state: "idle",
          consecutiveErrors,
          backoffMs,
          lastSuccessAt: new Date().toISOString()
        });
        continue;
      }

      const maxOffset = await processUpdates(creds.botToken, creds.chatId, response.result, logger);
      if (maxOffset > 0) {
        await writeOffset(maxOffset);
      }
      consecutiveErrors = 0;
      backoffMs = 2000;
      await updateRuntimeStatus({
        state: "idle",
        consecutiveErrors,
        backoffMs,
        lastSuccessAt: new Date().toISOString(),
        lastOffset: maxOffset > 0 ? maxOffset : offset
      });
    } catch (error) {
      consecutiveErrors += 1;
      backoffMs = Math.min(30_000, 2_000 * 2 ** (consecutiveErrors - 1));
      const message = error instanceof Error ? error.message : String(error);
      logger.error("BRIDGE_LOOP_ERROR", "Telegram bridge loop error", {
        error: message,
        consecutiveErrors,
        backoffMs
      });
      await updateRuntimeStatus({
        state: "error",
        consecutiveErrors,
        backoffMs,
        lastErrorAt: new Date().toISOString(),
        lastError: message.slice(0, 200)
      });
      await sleep(backoffMs);
    }
  }
}

if (require.main === module) {
  startTelegramBridge().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
