import assert from "node:assert/strict";
import test from "node:test";

import { ConversationSessionManager } from "../conversationSessionManager";
import { EventHub } from "../events";
import type { Logger } from "../logger";

function makeLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}

test("conversation manager tracks multi-turn user and assistant flow", () => {
  const events = new EventHub();
  let now = 1_000;
  const manager = new ConversationSessionManager({
    events,
    logger: makeLogger(),
    nowMsFn: () => now,
    ttlMs: 60_000,
    maxTurnsPerSession: 6
  });

  events.publish("wake_detected", { session_id: "s-convo-1" });
  now += 10;
  events.publish("message_transcribed", { session_id: "s-convo-1", turn: 1, text: "Hey Faye" });
  now += 8;
  events.publish("bridge_speak_received", { session_id: "s-convo-1", turn: 1, text: "Hey there" });
  now += 8;
  events.publish("bridge_spoken", { session_id: "s-convo-1", turn: 1, status: "ok" });

  now += 10;
  events.publish("message_transcribed", { session_id: "s-convo-1", turn: 2, text: "Open docs" });
  now += 8;
  events.publish("bridge_speak_received", { session_id: "s-convo-1", turn: 2, text: "Docs opened" });
  now += 8;
  events.publish("bridge_spoken", { session_id: "s-convo-1", turn: 2, status: "ok" });

  const snapshot = manager.getSnapshot();
  manager.stop();

  assert.equal(snapshot.activeSessions, 1);
  assert.equal(snapshot.policy.ttlMs, 60_000);
  assert.equal(snapshot.policy.turnPolicy.baseTurns, 8);
  assert.equal(snapshot.totals.userTurns, 2);
  assert.equal(snapshot.totals.assistantResponses, 2);

  const session = snapshot.sessions[0];
  assert.equal(session?.sessionId, "s-convo-1");
  assert.equal(session?.state, "awaiting_user");
  assert.equal(session?.totalTurns, 2);
  assert.equal(session?.retainedTurns, 2);
  assert.equal(session?.turnLimit, 8);
  assert.equal(typeof session?.lastTurnAt, "string");
  assert.equal(session?.stopRequested, false);
  assert.equal(session?.turns[1]?.assistantText, "Docs opened");
  assert.equal(session?.turns[1]?.assistantStatus, "ok");
});

test("conversation manager retains only max turns per session", () => {
  const events = new EventHub();
  let now = 5_000;
  const manager = new ConversationSessionManager({
    events,
    logger: makeLogger(),
    nowMsFn: () => now,
    ttlMs: 60_000,
    maxTurnsPerSession: 2
  });

  events.publish("wake_detected", { session_id: "s-cap-1" });

  for (let turn = 1; turn <= 3; turn += 1) {
    now += 5;
    events.publish("message_transcribed", { session_id: "s-cap-1", turn, text: `user-${turn}` });
    now += 5;
    events.publish("bridge_speak_received", { session_id: "s-cap-1", turn, text: `assistant-${turn}` });
    now += 5;
    events.publish("bridge_spoken", { session_id: "s-cap-1", turn, status: "ok" });
  }

  const snapshot = manager.getSnapshot();
  manager.stop();

  const session = snapshot.sessions[0];
  assert.equal(session?.totalTurns, 3);
  assert.equal(session?.retainedTurns, 2);
  assert.equal(session?.turns[0]?.turn, 2);
  assert.equal(session?.turns[1]?.turn, 3);
});

test("conversation manager expires stale sessions by TTL", () => {
  const events = new EventHub();
  let now = 10_000;
  const manager = new ConversationSessionManager({
    events,
    logger: makeLogger(),
    nowMsFn: () => now,
    ttlMs: 5_000,
    maxTurnsPerSession: 4
  });

  events.publish("wake_detected", { session_id: "s-ttl-1" });
  now += 10;
  events.publish("message_transcribed", { session_id: "s-ttl-1", turn: 1, text: "still here" });

  now += 5_100;
  const snapshot = manager.getSnapshot();
  manager.stop();

  assert.equal(snapshot.activeSessions, 0);
  assert.equal(snapshot.retainedSessions, 0);
  assert.equal(snapshot.totals.sessionsExpired >= 1, true);
  assert.equal(snapshot.endReasons.ttl_expired, 1);
  assert.equal(snapshot.lastEnded?.reason, "ttl_expired");
});

test("conversation manager ends session from listener status", () => {
  const events = new EventHub();
  let now = 20_000;
  const manager = new ConversationSessionManager({
    events,
    logger: makeLogger(),
    nowMsFn: () => now,
    ttlMs: 60_000
  });

  events.publish("wake_detected", { session_id: "s-end-1" });
  now += 10;
  events.publish("message_transcribed", { session_id: "s-end-1", turn: 1, text: "wrap up" });
  now += 10;
  events.publish("listener_status", {
    session_id: "s-end-1",
    status: "conversation_loop_ended",
    reason: "max_turns_reached"
  });

  const snapshot = manager.getSnapshot();
  manager.stop();

  assert.equal(snapshot.activeSessions, 0);
  assert.equal(snapshot.retainedSessions, 1);
  assert.equal(snapshot.sessions[0]?.state, "ended");
  assert.equal(snapshot.sessions[0]?.endReason, "max_turns_reached");
  assert.equal(snapshot.endReasons.max_turns_reached, 1);
  assert.equal(snapshot.lastEnded?.sessionId, "s-end-1");
});

test("conversation manager applies listener turn-limit updates", () => {
  const events = new EventHub();
  let now = 30_000;
  const manager = new ConversationSessionManager({
    events,
    logger: makeLogger(),
    nowMsFn: () => now,
    ttlMs: 60_000
  });

  events.publish("listener_status", {
    session_id: "s-policy-1",
    status: "conversation_loop_started",
    max_turns: 8
  });
  now += 10;
  events.publish("listener_status", {
    session_id: "s-policy-1",
    status: "conversation_loop_extended",
    max_turns: 12
  });

  const session = manager.getSessionSnapshot("s-policy-1");
  manager.stop();

  assert.equal(session?.turnLimit, 12);
  assert.equal(session?.extensionsUsed, 1);
});

test("conversation manager supports manual termination", () => {
  const events = new EventHub();
  const manager = new ConversationSessionManager({
    events,
    logger: makeLogger()
  });

  events.publish("wake_detected", { session_id: "s-manual-1" });
  events.publish("message_transcribed", { session_id: "s-manual-1", turn: 1, text: "hello" });

  const ended = manager.endSession("s-manual-1", "dashboard_manual_end");
  const snapshot = manager.getSnapshot();
  manager.stop();

  assert.equal(ended?.state, "ended");
  assert.equal(ended?.endReason, "dashboard_manual_end");
  assert.equal(snapshot.endReasons.dashboard_manual_end, 1);
});

test("conversation manager exposes normalized role context with action outcomes", () => {
  const events = new EventHub();
  let now = 40_000;
  const manager = new ConversationSessionManager({
    events,
    logger: makeLogger(),
    nowMsFn: () => now,
    ttlMs: 60_000
  });

  events.publish("wake_detected", { session_id: "s-context-1" });
  now += 5;
  events.publish("conversation_turn_started", { session_id: "s-context-1", turn: 1 });
  now += 5;
  events.publish("message_transcribed", { session_id: "s-context-1", turn: 1, text: "Check health" });
  now += 5;
  events.publish("bridge_action_requested", { session_id: "s-context-1", action: "listener_restart", confirm: false });
  now += 5;
  events.publish("bridge_action_blocked", {
    session_id: "s-context-1",
    action: "listener_restart",
    reason: "confirm_required"
  });
  now += 5;
  events.publish("bridge_speak_received", { session_id: "s-context-1", turn: 1, text: "Please confirm restart." });
  now += 5;
  events.publish("bridge_spoken", { session_id: "s-context-1", turn: 1, status: "ok" });
  now += 5;
  events.publish("conversation_turn_completed", { session_id: "s-context-1", turn: 1, wait_result: "completed" });
  now += 5;
  events.publish("conversation_ended", { session_id: "s-context-1", reason: "external_stop" });

  const context = manager.getContext("s-context-1", {
    limit: 8,
    includePending: false
  });
  const active = manager.getActiveSessionSnapshot();
  manager.stop();

  assert.equal(active, null);
  assert.equal(context?.sessionId, "s-context-1");
  assert.equal(context?.state, "ended");
  assert.equal(context?.stopRequested, true);
  assert.equal(context?.turnProgress.current, 1);
  assert.equal(context?.messages.some((item) => item.role === "user" && item.text === "Check health"), true);
  assert.equal(context?.messages.some((item) => item.status === "needs_confirm" && item.action === "listener_restart"), true);
  assert.equal(context?.messages.some((item) => item.role === "assistant" && item.status === "ok"), true);
});
