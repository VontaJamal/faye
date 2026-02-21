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

function speakUpdate(updateId: number, sessionId: string, text: string, turn?: number): TelegramUpdate {
  const turnPart = typeof turn === "number" ? ` turn=${turn}` : "";
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text: `#faye_speak session=${sessionId}${turnPart} text=${text}`,
      chat: {
        id: 999
      }
    }
  };
}

function activateUpdate(updateId: number, profileId: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text: `#faye_profile_activate id=${profileId}`,
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

test("telegram bridge records runtime telemetry for successful command path", async () => {
  const runtimePatches: Array<Record<string, unknown>> = [];

  await processUpdates("token", 999, [speakUpdate(1004, "s-telemetry-1", "runtime")], makeLogger(), {
    callLocalApiFn: async () => undefined,
    sendTelegramFn: async () => undefined,
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async () => false,
    markProcessedFn: async () => undefined,
    recordRuntimeFn: async (patch) => {
      runtimePatches.push({ ...patch });
    }
  });

  assert.equal(runtimePatches.some((patch) => patch.state === "processing" && patch.lastUpdateId === 1004), true);
  assert.equal(runtimePatches.some((patch) => patch.lastCommandType === "speak" && patch.lastCommandStatus === "ok"), true);
  assert.equal(runtimePatches.some((patch) => patch.lastOffset === 1004), true);
});

test("telegram bridge emits local round-trip events for session speak flow", async () => {
  const localEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];

  await processUpdates("token", 999, [speakUpdate(1005, "s-events-1", "bridge event test")], makeLogger(), {
    callLocalApiFn: async () => undefined,
    sendTelegramFn: async () => undefined,
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async () => false,
    markProcessedFn: async () => undefined,
    emitLocalEventFn: async (eventType, payload) => {
      localEvents.push({ type: eventType, payload });
    }
  });

  assert.equal(localEvents.some((event) => event.type === "bridge_speak_received"), true);
  assert.equal(
    localEvents.some(
      (event) =>
        event.type === "bridge_spoken" &&
        event.payload.session_id === "s-events-1" &&
        event.payload.status === "ok"
    ),
    true
  );
});

test("telegram bridge emits duplicate spoken event on replayed session", async () => {
  const localEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const processed = new Set<string>();

  const deps = {
    callLocalApiFn: async () => undefined,
    sendTelegramFn: async () => undefined,
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key: string) => processed.has(key),
    markProcessedFn: async (key: string) => {
      processed.add(key);
    },
    emitLocalEventFn: async (eventType: string, payload: Record<string, unknown>) => {
      localEvents.push({ type: eventType, payload });
    }
  };

  await processUpdates("token", 999, [speakUpdate(1006, "s-events-2", "once")], makeLogger(), deps);
  await processUpdates("token", 999, [speakUpdate(1006, "s-events-2", "once")], makeLogger(), deps);

  assert.equal(
    localEvents.some(
      (event) =>
        event.type === "bridge_spoken" &&
        event.payload.session_id === "s-events-2" &&
        event.payload.status === "duplicate"
    ),
    true
  );
});

test("telegram bridge processes multiple turns in the same session", async () => {
  const localCalls: Array<{ pathname: string; body?: unknown }> = [];
  const telegramMessages: string[] = [];
  const localEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const processed = new Set<string>();

  const updates = [
    speakUpdate(2001, "s-loop-1", "First response", 1),
    speakUpdate(2002, "s-loop-1", "Second response", 2)
  ];

  await processUpdates("token", 999, updates, makeLogger(), {
    callLocalApiFn: async (pathname, body) => {
      localCalls.push({ pathname, body });
    },
    sendTelegramFn: async (_token, _chatId, text) => {
      telegramMessages.push(text);
    },
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key) => processed.has(key),
    markProcessedFn: async (key) => {
      processed.add(key);
    },
    emitLocalEventFn: async (type, payload) => {
      localEvents.push({ type, payload });
    }
  });

  assert.equal(localCalls.length, 2);
  assert.equal(localCalls[0]?.pathname, "/v1/speak");
  assert.equal(localCalls[1]?.pathname, "/v1/speak");
  assert.equal(localCalls[0]?.body && (localCalls[0].body as { text?: string }).text, "First response");
  assert.equal(localCalls[1]?.body && (localCalls[1].body as { text?: string }).text, "Second response");
  assert.equal(telegramMessages.includes("#faye_spoken status=ok session=s-loop-1"), true);
  assert.equal(
    localEvents.some(
      (event) =>
        event.type === "bridge_speak_received" &&
        event.payload.session_id === "s-loop-1" &&
        event.payload.turn === 2 &&
        event.payload.text === "Second response"
    ),
    true
  );
});

test("telegram bridge keeps action execution reliable with replayed mixed commands", async () => {
  const localCalls: Array<{ pathname: string; body?: unknown }> = [];
  const processed = new Set<string>();

  const updates = [
    speakUpdate(3001, "s-mixed-1", "Need status", 1),
    activateUpdate(3002, "starter-profile"),
    speakUpdate(3003, "s-mixed-1", "Action complete", 2)
  ];

  const deps = {
    callLocalApiFn: async (pathname: string, body?: unknown) => {
      localCalls.push({ pathname, body });
    },
    sendTelegramFn: async () => undefined,
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key: string) => processed.has(key),
    markProcessedFn: async (key: string) => {
      processed.add(key);
    },
    emitLocalEventFn: async () => undefined
  };

  await processUpdates("token", 999, updates, makeLogger(), deps);
  await processUpdates("token", 999, updates, makeLogger(), deps);

  assert.equal(localCalls.filter((call) => call.pathname === "/v1/speak").length, 2);
  assert.equal(localCalls.filter((call) => call.pathname === "/v1/profiles/starter-profile/activate").length, 1);
});
