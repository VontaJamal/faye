import assert from "node:assert/strict";
import test from "node:test";

import type { Logger } from "../logger";
import { processUpdates, type TelegramUpdate } from "../telegramBridge";

function makeLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}

function speakUpdate(updateId: number, sessionId: string, text: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text: `#faye_speak session=${sessionId} text=${text}`,
      chat: {
        id: 999
      }
    }
  };
}

test("telegram bridge runs speak command end-to-end and sends ack", async () => {
  const localCalls: Array<{ pathname: string; body?: unknown }> = [];
  const telegramMessages: string[] = [];
  const offsets: number[] = [];
  const processed = new Set<string>();

  const updates = [speakUpdate(1001, "s-demo-1", "Hello there")];
  const maxOffset = await processUpdates("token", 999, updates, makeLogger(), {
    callLocalApiFn: async (pathname, body) => {
      localCalls.push({ pathname, body });
    },
    sendTelegramFn: async (_token, _chatId, text) => {
      telegramMessages.push(text);
    },
    writeOffsetFn: async (offset) => {
      offsets.push(offset);
    },
    hasProcessedFn: async (key) => processed.has(key),
    markProcessedFn: async (key) => {
      processed.add(key);
    }
  });

  assert.equal(maxOffset, 1001);
  assert.equal(localCalls.length, 1);
  assert.equal(localCalls[0]?.pathname, "/v1/speak");
  assert.deepEqual(localCalls[0]?.body, { text: "Hello there" });
  assert.equal(telegramMessages.includes("#faye_spoken status=ok session=s-demo-1"), true);
  assert.equal(offsets[offsets.length - 1], 1001);
});

test("telegram bridge suppresses duplicate replay by idempotency key", async () => {
  const localCalls: Array<{ pathname: string; body?: unknown }> = [];
  const telegramMessages: string[] = [];
  const processed = new Set<string>();

  const deps = {
    callLocalApiFn: async (pathname: string, body?: unknown) => {
      localCalls.push({ pathname, body });
    },
    sendTelegramFn: async (_token: string, _chatId: number, text: string) => {
      telegramMessages.push(text);
    },
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key: string) => processed.has(key),
    markProcessedFn: async (key: string) => {
      processed.add(key);
    }
  };

  const updates = [speakUpdate(1002, "s-demo-2", "Replay me once")];
  await processUpdates("token", 999, updates, makeLogger(), deps);
  await processUpdates("token", 999, updates, makeLogger(), deps);

  assert.equal(localCalls.length, 1);
  assert.equal(telegramMessages.includes("#faye_spoken status=duplicate session=s-demo-2"), true);
});

test("telegram bridge avoids duplicate speak after simulated crash before offset write", async () => {
  const processed = new Set<string>();
  const localCalls: string[] = [];
  let crashed = false;

  const updates = [speakUpdate(1003, "s-crash-1", "Survive crash")];

  await assert.rejects(
    async () => {
      await processUpdates("token", 999, updates, makeLogger(), {
        callLocalApiFn: async () => {
          localCalls.push("called");
        },
        sendTelegramFn: async () => undefined,
        hasProcessedFn: async (key) => processed.has(key),
        markProcessedFn: async (key) => {
          processed.add(key);
        },
        writeOffsetFn: async () => {
          crashed = true;
          throw new Error("E_SIMULATED_CRASH");
        }
      });
    },
    /E_SIMULATED_CRASH/
  );

  assert.equal(crashed, true);
  assert.equal(localCalls.length, 1);

  await processUpdates("token", 999, updates, makeLogger(), {
    callLocalApiFn: async () => {
      localCalls.push("called");
    },
    sendTelegramFn: async () => undefined,
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key) => processed.has(key),
    markProcessedFn: async (key) => {
      processed.add(key);
    }
  });

  assert.equal(localCalls.length, 1);
});
