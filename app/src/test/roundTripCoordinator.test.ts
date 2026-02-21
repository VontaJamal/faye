import assert from "node:assert/strict";
import test from "node:test";

import { EventHub } from "../events";
import type { Logger } from "../logger";
import { RoundTripCoordinator } from "../roundTripCoordinator";

function makeLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("round-trip coordinator completes happy path without retry", async () => {
  const events = new EventHub();
  const sentMessages: string[] = [];
  const coordinator = new RoundTripCoordinator({
    events,
    store: {
      getActiveProfile: () => ({})
    },
    logger: makeLogger(),
    watchdogMs: 25,
    resolveTelegramFn: async () => ({ botToken: "token", chatId: 1234 }),
    sendTelegramFn: async (_token, _chatId, text) => {
      sentMessages.push(text);
    }
  });

  events.publish("wake_detected", { session_id: "s-happy" });
  events.publish("message_transcribed", { session_id: "s-happy", text: "Hello world" });
  events.publish("bridge_speak_received", { session_id: "s-happy" });
  events.publish("bridge_spoken", { session_id: "s-happy", status: "ok" });

  await wait(5);
  const snapshot = coordinator.getSnapshot();
  coordinator.stop();

  assert.equal(snapshot.totals.started, 1);
  assert.equal(snapshot.totals.retriesSent, 0);
  assert.equal(snapshot.totals.completed, 1);
  assert.equal(snapshot.totals.timeouts, 0);
  assert.equal(snapshot.activeSessions, 0);
  assert.equal(snapshot.lastCompleted?.sessionId, "s-happy");
  assert.equal(snapshot.lastCompleted?.status, "ok");
  assert.equal(sentMessages.length, 0);
});

test("round-trip coordinator retries once then times out", async () => {
  const events = new EventHub();
  const sentMessages: string[] = [];
  const coordinator = new RoundTripCoordinator({
    events,
    store: {
      getActiveProfile: () => ({})
    },
    logger: makeLogger(),
    watchdogMs: 20,
    resolveTelegramFn: async () => ({ botToken: "token", chatId: 1234 }),
    sendTelegramFn: async (_token, _chatId, text) => {
      sentMessages.push(text);
    }
  });

  events.publish("wake_detected", { session_id: "s-timeout" });
  events.publish("message_transcribed", { session_id: "s-timeout", text: "Need response" });

  await wait(70);
  const snapshot = coordinator.getSnapshot();
  coordinator.stop();

  assert.equal(snapshot.totals.started, 1);
  assert.equal(snapshot.totals.retriesSent, 1);
  assert.equal(snapshot.totals.completed, 0);
  assert.equal(snapshot.totals.timeouts, 1);
  assert.equal(snapshot.lastTimeout?.sessionId, "s-timeout");
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.includes("#faye_voice session=s-timeout retry=1"), true);
});

test("round-trip coordinator completes after single retry", async () => {
  const events = new EventHub();
  const sentMessages: string[] = [];
  const coordinator = new RoundTripCoordinator({
    events,
    store: {
      getActiveProfile: () => ({})
    },
    logger: makeLogger(),
    watchdogMs: 20,
    resolveTelegramFn: async () => ({ botToken: "token", chatId: 1234 }),
    sendTelegramFn: async (_token, _chatId, text) => {
      sentMessages.push(text);
    }
  });

  events.publish("wake_detected", { session_id: "s-recover" });
  events.publish("message_transcribed", { session_id: "s-recover", text: "Recover path" });

  await wait(30);
  events.publish("bridge_speak_received", { session_id: "s-recover" });
  events.publish("bridge_spoken", { session_id: "s-recover", status: "ok" });

  await wait(10);
  const snapshot = coordinator.getSnapshot();
  coordinator.stop();

  assert.equal(snapshot.totals.retriesSent, 1);
  assert.equal(snapshot.totals.completed, 1);
  assert.equal(snapshot.totals.timeouts, 0);
  assert.equal(snapshot.lastCompleted?.sessionId, "s-recover");
  assert.equal(sentMessages.length, 1);
});

test("round-trip session status reflects lifecycle transitions", async () => {
  const events = new EventHub();
  const coordinator = new RoundTripCoordinator({
    events,
    store: {
      getActiveProfile: () => ({})
    },
    logger: makeLogger(),
    watchdogMs: 25
  });

  const before = coordinator.getSessionStatus("s-status");
  assert.equal(before.pending, false);
  assert.equal(before.state, null);

  events.publish("wake_detected", { session_id: "s-status" });
  const afterWake = coordinator.getSessionStatus("s-status");
  assert.equal(afterWake.pending, true);
  assert.equal(afterWake.state, "wake_detected");

  events.publish("message_transcribed", { session_id: "s-status", text: "Hello status" });
  events.publish("bridge_speak_received", { session_id: "s-status" });
  events.publish("bridge_spoken", { session_id: "s-status", status: "ok" });

  await wait(5);
  const afterDone = coordinator.getSessionStatus("s-status");
  coordinator.stop();

  assert.equal(afterDone.pending, false);
  assert.equal(afterDone.state, null);
  assert.equal(afterDone.retryCount, 0);
});

test("round-trip marks timeout as retry_unavailable when credentials are missing", async () => {
  const events = new EventHub();
  const coordinator = new RoundTripCoordinator({
    events,
    store: {
      getActiveProfile: () => ({})
    },
    logger: makeLogger(),
    watchdogMs: 20,
    resolveTelegramFn: async () => null
  });

  events.publish("wake_detected", { session_id: "s-no-creds" });
  events.publish("message_transcribed", { session_id: "s-no-creds", text: "Need retry path" });

  await wait(35);
  const snapshot = coordinator.getSnapshot();
  coordinator.stop();

  assert.equal(snapshot.totals.retriesSent, 0);
  assert.equal(snapshot.totals.timeouts, 1);
  assert.equal(snapshot.lastTimeout?.reason, "retry_unavailable");
});
