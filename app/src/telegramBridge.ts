import { createLogger } from "./logger";
import { FAYE_STATE_DIR } from "./paths";
import { ConfigStore } from "./store";
import type { BridgeCommand } from "./telegramBridgeParser";
import { parseBridgeCommand } from "./telegramBridgeParser";
import {
  bridgeCommandKey,
  sendActionResult,
  toChatId,
  toRuntimeCommandType
} from "./telegramBridgeCommandUtils";
import { emitLocalEvent } from "./telegramBridgeLocalEvents";
import {
  hasProcessedCommandKey,
  loadRuntimeStatus,
  markProcessedCommandKey,
  readOffset,
  readBridgeRuntimeStatus,
  type BridgeRuntimeStatus,
  updateRuntimeStatus,
  writeOffset
} from "./telegramBridgeRuntimeState";
import {
  callLocalApi,
  fetchLocalJson,
  sendTelegram,
  telegramRequest
} from "./telegramBridgeTransport";
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

interface ProcessUpdateDependencies {
  callLocalApiFn?: (pathname: string, body?: unknown) => Promise<void>;
  fetchLocalJsonFn?: (pathname: string) => Promise<unknown>;
  sendTelegramFn?: (botToken: string, chatId: number, text: string) => Promise<void>;
  writeOffsetFn?: (offset: number) => Promise<void>;
  hasProcessedFn?: (key: string) => Promise<boolean>;
  markProcessedFn?: (key: string) => Promise<void>;
  recordRuntimeFn?: (patch: Partial<BridgeRuntimeStatus>) => Promise<void>;
  emitLocalEventFn?: (eventType: string, payload: Record<string, unknown>) => Promise<void>;
}

export type { BridgeRuntimeStatus } from "./telegramBridgeRuntimeState";
export { readBridgeRuntimeStatus };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const fetchLocalJsonFn = deps?.fetchLocalJsonFn ?? ((pathname: string) => fetchLocalJson(pathname));
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
        lastCommandType: toRuntimeCommandType(command),
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
      } else if (command.type === "action") {
        const action = command.name;
        await emitLocalEventFn("bridge_action_requested", {
          session_id: command.sessionId,
          action,
          update_id: update.update_id,
          confirm: command.confirm === true,
          nonce: command.nonce
        }).catch(() => undefined);

        const requiresConfirm = action === "listener_restart" || action === "bridge_restart";
        if (requiresConfirm && command.confirm !== true) {
          await markProcessedFn(commandKey);
          await sendActionResult(sendTelegramFn, botToken, chatId, {
            name: action,
            status: "needs_confirm",
            reason: "confirm_required",
            sessionId: command.sessionId
          });

          await emitLocalEventFn("bridge_action_blocked", {
            session_id: command.sessionId,
            action,
            reason: "confirm_required",
            code: "confirm_required",
            status: "needs_confirm",
            nonce: command.nonce
          }).catch(() => undefined);
        } else {
          if (action === "health_summary") {
            await fetchLocalJsonFn("/v1/health");
          } else if (action === "voice_test") {
            await callLocalApiFn("/v1/speak/test", {
              text: "Faye action voice test."
            });
          } else if (action === "listener_restart") {
            await callLocalApiFn("/v1/listener/restart");
          } else {
            await callLocalApiFn("/v1/bridge/restart");
          }

          await markProcessedFn(commandKey);
          await sendActionResult(sendTelegramFn, botToken, chatId, {
            name: action,
            status: "ok",
            reason: "ok",
            sessionId: command.sessionId
          });

          await emitLocalEventFn("bridge_action_executed", {
            session_id: command.sessionId,
            action,
            status: "ok",
            reason: "ok",
            code: "ok",
            nonce: command.nonce
          }).catch(() => undefined);
        }
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
        lastCommandType: toRuntimeCommandType(command),
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
        lastCommandType: toRuntimeCommandType(command),
        lastCommandStatus: "error",
        lastErrorAt: new Date().toISOString(),
        lastError: messageText.slice(0, 200)
      });

      if (command.type === "action") {
        await sendActionResult(sendTelegramFn, botToken, chatId, {
          name: command.name,
          status: "error",
          reason: "execution_failed",
          sessionId: command.sessionId
        }).catch(() => undefined);
        await emitLocalEventFn("bridge_action_executed", {
          session_id: command.sessionId,
          action: command.name,
          status: "error",
          reason: "execution_failed",
          code: "execution_failed",
          detail: messageText.slice(0, 160),
          nonce: command.nonce
        }).catch(() => undefined);
      } else {
        const sessionPart = command.type === "speak" && command.sessionId ? ` session=${command.sessionId}` : "";
        await sendTelegramFn(botToken, chatId, `#faye_spoken status=error${sessionPart}`).catch(() => undefined);
      }

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
