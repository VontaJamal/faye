import test from "node:test";
import assert from "node:assert/strict";

import { parseBridgeCommand } from "../telegramBridgeParser";

test("parses simple speak command", () => {
  const command = parseBridgeCommand("#faye_speak Hello from OpenClaw");
  assert.deepEqual(command, {
    type: "speak",
    text: "Hello from OpenClaw",
    sessionId: undefined
  });
});

test("parses key-value speak command with session", () => {
  const command = parseBridgeCommand("#faye_speak session=abc123 turn=2 text=Mission acknowledged");
  assert.deepEqual(command, {
    type: "speak",
    text: "Mission acknowledged",
    sessionId: "abc123",
    turn: 2
  });
});

test("parses JSON speak command", () => {
  const command = parseBridgeCommand('#faye_speak {"session_id":"s-1","turn":3,"text":"Jarvis online"}');
  assert.deepEqual(command, {
    type: "speak",
    text: "Jarvis online",
    sessionId: "s-1",
    turn: 3
  });
});

test("parses activate profile command", () => {
  const command = parseBridgeCommand("#faye_profile_activate id=starter-profile");
  assert.deepEqual(command, {
    type: "activate_profile",
    profileId: "starter-profile"
  });
});

test("parses ping command", () => {
  const command = parseBridgeCommand("#faye_ping");
  assert.deepEqual(command, { type: "ping" });
});
