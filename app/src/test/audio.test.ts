import assert from "node:assert/strict";
import test from "node:test";

import { createAudioPlayer } from "../audio";

test("audio player prefers afplay when available", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const play = createAudioPlayer({
    hasCommandFn: (command) => command === "afplay",
    runCommandFn: async (command, args) => {
      calls.push({ command, args: [...args] });
    }
  });

  await play("/tmp/test.mp3");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "afplay");
  assert.deepEqual(calls[0]?.args, ["/tmp/test.mp3"]);
});

test("audio player falls back to mpv when afplay is unavailable", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const play = createAudioPlayer({
    hasCommandFn: (command) => command === "mpv",
    runCommandFn: async (command, args) => {
      calls.push({ command, args: [...args] });
    }
  });

  await play("/tmp/test.mp3");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "mpv");
  assert.deepEqual(calls[0]?.args, ["--no-video", "--really-quiet", "/tmp/test.mp3"]);
});

test("audio player throws deterministic error when no player exists", async () => {
  const play = createAudioPlayer({
    hasCommandFn: () => false,
    runCommandFn: async () => undefined
  });

  await assert.rejects(async () => play("/tmp/test.mp3"), /E_AUDIO_PLAYER_NOT_FOUND/);
});
