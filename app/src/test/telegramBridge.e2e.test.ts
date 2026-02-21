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

function actionUpdate(
  updateId: number,
  name: "health_summary" | "voice_test" | "listener_restart" | "bridge_restart",
  options?: { sessionId?: string; confirm?: boolean; nonce?: string }
): TelegramUpdate {
  const sessionPart = options?.sessionId ? ` session=${options.sessionId}` : "";
  const confirmPart = options?.confirm === true ? " confirm=yes" : "";
  const noncePart = options?.nonce ? ` nonce=${options.nonce}` : "";
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text: `#faye_action name=${name}${sessionPart}${confirmPart}${noncePart}`,
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

test("telegram bridge executes low-risk action and sends deterministic action_result ack", async () => {
  const telegramMessages: string[] = [];
  const localCalls: string[] = [];
  const localEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];

  await processUpdates(
    "token",
    999,
    [actionUpdate(4001, "voice_test", { sessionId: "s-action-1", nonce: "voice-1" })],
    makeLogger(),
    {
    callLocalApiFn: async (pathname) => {
      localCalls.push(pathname);
    },
    fetchLocalJsonFn: async () => ({ ok: true }),
    sendTelegramFn: async (_token, _chatId, text) => {
      telegramMessages.push(text);
    },
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async () => false,
    markProcessedFn: async () => undefined,
    emitLocalEventFn: async (type, payload) => {
      localEvents.push({ type, payload });
    }
    }
  );

  assert.equal(localCalls.includes("/v1/speak/test"), true);
  assert.equal(
    telegramMessages.includes("#faye_action_result name=voice_test status=ok reason=ok session=s-action-1"),
    true
  );
  assert.equal(localEvents.some((event) => event.type === "bridge_action_requested"), true);
  assert.equal(localEvents.some((event) => event.type === "bridge_action_executed"), true);
  assert.equal(
    localEvents.some((event) => event.type === "bridge_action_requested" && event.payload.nonce === "voice-1"),
    true
  );
});

test("telegram bridge blocks impactful action without confirm", async () => {
  const telegramMessages: string[] = [];
  const localCalls: string[] = [];
  const localEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];

  await processUpdates(
    "token",
    999,
    [actionUpdate(4002, "listener_restart", { sessionId: "s-action-2" })],
    makeLogger(),
    {
      callLocalApiFn: async (pathname) => {
        localCalls.push(pathname);
      },
      fetchLocalJsonFn: async () => ({ ok: true }),
      sendTelegramFn: async (_token, _chatId, text) => {
        telegramMessages.push(text);
      },
      writeOffsetFn: async () => undefined,
      hasProcessedFn: async () => false,
      markProcessedFn: async () => undefined,
      emitLocalEventFn: async (type, payload) => {
        localEvents.push({ type, payload });
      }
    }
  );

  assert.equal(localCalls.length, 0);
  assert.equal(
    telegramMessages.includes(
      "#faye_action_result name=listener_restart status=needs_confirm reason=confirm_required session=s-action-2"
    ),
    true
  );
  assert.equal(localEvents.some((event) => event.type === "bridge_action_blocked"), true);
});

test("telegram bridge executes confirmed impactful action exactly once across replay", async () => {
  const processed = new Set<string>();
  const localCalls: string[] = [];

  const deps = {
    callLocalApiFn: async (pathname: string) => {
      localCalls.push(pathname);
    },
    fetchLocalJsonFn: async () => ({ ok: true }),
    sendTelegramFn: async () => undefined,
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key: string) => processed.has(key),
    markProcessedFn: async (key: string) => {
      processed.add(key);
    },
    emitLocalEventFn: async () => undefined
  };

  const update = actionUpdate(4003, "bridge_restart", { sessionId: "s-action-3", confirm: true });
  await processUpdates("token", 999, [update], makeLogger(), deps);
  await processUpdates("token", 999, [update], makeLogger(), deps);

  assert.equal(localCalls.filter((call) => call === "/v1/bridge/restart").length, 1);
});

test("telegram bridge action nonce deduplicates across distinct update ids", async () => {
  const processed = new Set<string>();
  const localCalls: string[] = [];

  const deps = {
    callLocalApiFn: async (pathname: string) => {
      localCalls.push(pathname);
    },
    fetchLocalJsonFn: async () => ({ ok: true }),
    sendTelegramFn: async () => undefined,
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key: string) => processed.has(key),
    markProcessedFn: async (key: string) => {
      processed.add(key);
    },
    emitLocalEventFn: async () => undefined
  };

  await processUpdates(
    "token",
    999,
    [actionUpdate(5001, "listener_restart", { sessionId: "s-action-4", confirm: true, nonce: "op-44" })],
    makeLogger(),
    deps
  );
  await processUpdates(
    "token",
    999,
    [actionUpdate(5002, "listener_restart", { sessionId: "s-action-4", confirm: true, nonce: "op-44" })],
    makeLogger(),
    deps
  );

  assert.equal(localCalls.filter((call) => call === "/v1/listener/restart").length, 1);
});
