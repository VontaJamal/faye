import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("ConfigStore bootstraps and manages profile lifecycle", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "faye-store-test-"));

  const prevHome = process.env.HOME;
  const prevRuntime = process.env.FAYE_RUNTIME_CONFIG;
  const prevLegacy = process.env.FAYE_VOICE_CONFIG;

  process.env.HOME = tmp;
  process.env.FAYE_RUNTIME_CONFIG = path.join(tmp, "runtime.json");
  process.env.FAYE_VOICE_CONFIG = path.join(tmp, "legacy.json");

  try {
    const { createLogger } = await import("../logger");
    const { ConfigStore } = await import("../store");

    const store = new ConfigStore(createLogger());
    await store.init();

    const created = await store.createProfile({
      name: "QA Profile",
      voiceId: "voice_123",
      voiceName: "QA Voice",
      wakeWord: "Faye Rise",
      wakeWordVariants: ["faye rise"],
      model: "eleven_multilingual_v2",
      stability: 0.3,
      similarityBoost: 0.7,
      style: 0.6,
      elevenLabsApiKeyPath: path.join(tmp, "key.txt"),
      silenceThreshold: "0.5%"
    });

    assert.ok(created.id.length > 3);

    const activated = await store.activateProfile(created.id);
    assert.equal(activated.id, created.id);

    const config = store.getConfig();
    assert.equal(config.activeProfileId, created.id);
    assert.ok(config.profiles.find((item) => item.id === created.id));
  } finally {
    process.env.HOME = prevHome;
    process.env.FAYE_RUNTIME_CONFIG = prevRuntime;
    process.env.FAYE_VOICE_CONFIG = prevLegacy;
  }
});
