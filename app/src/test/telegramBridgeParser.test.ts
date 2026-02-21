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

test("parses action command with confirmation", () => {
  const command = parseBridgeCommand("#faye_action name=listener_restart session=s-1 confirm=yes nonce=n-1");
  assert.deepEqual(command, {
    type: "action",
    name: "listener_restart",
    sessionId: "s-1",
    confirm: true,
    nonce: "n-1"
  });
});

test("parses action command with plain-name payload", () => {
  const command = parseBridgeCommand("#faye_action voice_test session=s-2");
  assert.deepEqual(command, {
    type: "action",
    name: "voice_test",
    sessionId: "s-2"
  });
});

test("parses action command JSON payload with nonce", () => {
  const command = parseBridgeCommand('#faye_action {"name":"bridge_restart","session_id":"s-3","confirm":true,"nonce":"op-88"}');
  assert.deepEqual(command, {
    type: "action",
    name: "bridge_restart",
    sessionId: "s-3",
    confirm: true,
    nonce: "op-88"
  });
});
