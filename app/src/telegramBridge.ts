import fs from "node:fs/promises";
import path from "node:path";

import { createLogger } from "./logger";
import { BRIDGE_OFFSET_PATH, BRIDGE_PROCESSED_KEYS_PATH, FAYE_STATE_DIR } from "./paths";
import { ConfigStore } from "./store";
import type { BridgeCommand } from "./telegramBridgeParser";
import { parseBridgeCommand } from "./telegramBridgeParser";
import { ensureDir, expandHomePath, pathExists, readSecret } from "./utils";

interface TelegramMessage {
  message_id: number;
  text?: string;
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
}

const PROCESSED_KEYS_LIMIT = 2500;
let processedKeysCache: ProcessedKeyStore | null = null;

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
    return command.sessionId ? `speak:session:${command.sessionId}` : `speak:update:${updateId}`;
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
  let maxOffset = 0;

  for (const update of updates) {
    maxOffset = Math.max(maxOffset, update.update_id);

    const message = update.message;
    if (!message?.text || message.chat?.id !== chatId) {
      await writeOffsetFn(maxOffset);
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

      if (command.type === "speak" && command.sessionId) {
        await sendTelegramFn(botToken, chatId, `#faye_spoken status=duplicate session=${command.sessionId}`).catch(() => undefined);
      }

      await writeOffsetFn(maxOffset);
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
        await callLocalApiFn("/v1/speak", {
          text: command.text
        });
        await markProcessedFn(commandKey);

        const sessionPart = command.sessionId ? ` session=${command.sessionId}` : "";
        await sendTelegramFn(botToken, chatId, `#faye_spoken status=ok${sessionPart}`);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.warn("BRIDGE_CMD_FAIL", "Bridge command failed", {
        command,
        updateId: update.update_id,
        message: messageText
      });

      const sessionPart = command.type === "speak" && command.sessionId ? ` session=${command.sessionId}` : "";
      await sendTelegramFn(botToken, chatId, `#faye_spoken status=error${sessionPart}`).catch(() => undefined);
    }

    await writeOffsetFn(maxOffset);
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

  const maxUpdateId = Math.max(...response.result.map((item) => item.update_id));
  await writeOffset(maxUpdateId);
  logger.info("BRIDGE_BOOTSTRAP", "Initialized Telegram offset", {
    offset: maxUpdateId
  });
}

export async function startTelegramBridge(): Promise<void> {
  const logger = createLogger();
  await ensureDir(FAYE_STATE_DIR);

  const store = new ConfigStore(logger);
  await store.init();

  logger.info("BRIDGE_START", "Faye Telegram bridge starting", {});

  while (true) {
    try {
      await store.init();
      const creds = await getBridgeCredentials(store);
      if (!creds) {
        logger.warn("BRIDGE_NO_TELEGRAM", "Telegram credentials not configured; sleeping", {});
        await sleep(5000);
        continue;
      }

      await bootstrapOffset(creds.botToken, logger);
      const offset = await readOffset();
      const response = await telegramRequest<TelegramResponse>(
        `https://api.telegram.org/bot${creds.botToken}/getUpdates?timeout=25&offset=${offset + 1}&allowed_updates=["message"]`
      );

      if (!response.ok || response.result.length === 0) {
        continue;
      }

      const maxOffset = await processUpdates(creds.botToken, creds.chatId, response.result, logger);
      if (maxOffset > 0) {
        await writeOffset(maxOffset);
      }
    } catch (error) {
      logger.error("BRIDGE_LOOP_ERROR", "Telegram bridge loop error", {
        error: error instanceof Error ? error.message : String(error)
      });
      await sleep(2000);
    }
  }
}

if (require.main === module) {
  startTelegramBridge().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
