import assert from "node:assert/strict";
import test from "node:test";

import { runDoctor } from "../doctor";
import type { ConfigStore } from "../store";

function fakeStore(): ConfigStore {
  const store = {
    getConfig: () => ({
      schemaVersion: 1 as const,
      activeProfileId: "starter-profile",
      profiles: [
        {
          id: "starter-profile",
          name: "Starter",
          voiceId: "v",
          voiceName: "Voice",
          wakeWord: "Faye",
          wakeWordVariants: ["faye"],
          model: "eleven_multilingual_v2" as const,
          stability: 0.4,
          similarityBoost: 0.8,
          style: 0.7,
          elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
          silenceThreshold: "0.5%",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      eventTransport: "hybrid" as const,
      localApiBaseUrl: "http://127.0.0.1:4587" as const
    }),
    getActiveProfile: () => ({
      id: "starter-profile",
      name: "Starter",
      voiceId: "v",
      voiceName: "Voice",
      wakeWord: "Faye",
      wakeWordVariants: ["faye"],
      model: "eleven_multilingual_v2" as const,
      stability: 0.4,
      similarityBoost: 0.8,
      style: 0.7,
      elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
      silenceThreshold: "0.5%",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  };

  return store as unknown as ConfigStore;
}

test("doctor returns deterministic error codes for missing dependencies and files", async () => {
  const report = await runDoctor(fakeStore(), {
    hasCommandFn: (command) => command !== "rec" && command !== "curl",
    pathExistsFn: async () => false,
    fileModeFn: async () => null
  });

  assert.equal(report.ok, false);
  assert.equal(report.commands.rec, false);
  assert.equal(report.commands.curl, false);
  assert.equal(report.errorCodes.includes("E_DEP_REC_MISSING"), true);
  assert.equal(report.errorCodes.includes("E_DEP_CURL_MISSING"), true);
  assert.equal(report.errorCodes.includes("E_RUNTIME_CONFIG_MISSING"), true);
  assert.equal(report.errorCodes.includes("E_LEGACY_CONFIG_MISSING"), true);
  assert.equal(report.errorCodes.includes("E_LOCAL_EVENT_TOKEN_MISSING"), true);
  assert.equal(report.errorCodes.includes("E_ACTIVE_API_KEY_MISSING"), true);
});

test("doctor passes when dependencies, files, and permissions are healthy", async () => {
  const report = await runDoctor(fakeStore(), {
    hasCommandFn: () => true,
    pathExistsFn: async () => true,
    fileModeFn: async () => 0o600
  });

  assert.equal(report.ok, true);
  assert.equal(report.errorCodes.length, 0);
  assert.equal(report.secretPermissions.localEventTokenMode, "0600");
  assert.equal(report.secretPermissions.activeApiKeyMode, "0600");
});
