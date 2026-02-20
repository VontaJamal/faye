import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import { createApiServer } from "../api";
import { EventHub } from "../events";
import type { RuntimeConfig, VoiceProfile } from "../types";

interface MutableProfileInput {
  id: string;
  name: string;
  voiceId?: string;
  voiceName?: string;
  wakeWord?: string;
  wakeWordVariants?: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeProfile(input: MutableProfileInput): VoiceProfile {
  const created = nowIso();
  return {
    id: input.id,
    name: input.name,
    voiceId: input.voiceId ?? "voice-default",
    voiceName: input.voiceName ?? "Default Voice",
    wakeWord: input.wakeWord ?? "Faye Arise",
    wakeWordVariants: input.wakeWordVariants ?? ["faye arise"],
    model: "eleven_multilingual_v2",
    stability: 0.4,
    similarityBoost: 0.8,
    style: 0.7,
    elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
    silenceThreshold: "0.5%",
    createdAt: created,
    updatedAt: created
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class FakeStore {
  private config: RuntimeConfig;
  private readonly localToken = "test-local-token";

  constructor() {
    const starter = makeProfile({ id: "starter-profile", name: "Starter Profile" });
    this.config = {
      schemaVersion: 1,
      activeProfileId: starter.id,
      profiles: [starter],
      eventTransport: "hybrid",
      localApiBaseUrl: "http://127.0.0.1:4587"
    };
  }

  getConfig(): RuntimeConfig {
    return clone(this.config);
  }

  getActiveProfile(): VoiceProfile {
    const active = this.config.profiles.find((item) => item.id === this.config.activeProfileId);
    if (!active) {
      throw new Error("E_ACTIVE_PROFILE_NOT_FOUND");
    }
    return clone(active);
  }

  getLocalEventToken(): string {
    return this.localToken;
  }

  async createProfile(input: {
    name: string;
    voiceId: string;
    voiceName: string;
    wakeWord: string;
    wakeWordVariants?: string[];
  }): Promise<VoiceProfile> {
    const next = makeProfile({
      id: `profile-${this.config.profiles.length + 1}`,
      name: input.name,
      voiceId: input.voiceId,
      voiceName: input.voiceName,
      wakeWord: input.wakeWord,
      wakeWordVariants: input.wakeWordVariants ?? [input.wakeWord.toLowerCase()]
    });
    this.config.profiles.push(next);
    return clone(next);
  }

  async updateProfile(id: string, patch: Partial<VoiceProfile>): Promise<VoiceProfile> {
    const index = this.config.profiles.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    const existing = this.config.profiles[index];
    if (!existing) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    const next: VoiceProfile = {
      ...clone(existing),
      name: patch.name ?? existing.name,
      voiceId: patch.voiceId ?? existing.voiceId,
      voiceName: patch.voiceName ?? existing.voiceName,
      wakeWord: patch.wakeWord ?? existing.wakeWord,
      wakeWordVariants: patch.wakeWordVariants ?? existing.wakeWordVariants,
      model: patch.model ?? existing.model,
      stability: patch.stability ?? existing.stability,
      similarityBoost: patch.similarityBoost ?? existing.similarityBoost,
      style: patch.style ?? existing.style,
      elevenLabsApiKeyPath: patch.elevenLabsApiKeyPath ?? existing.elevenLabsApiKeyPath,
      telegramBotTokenPath: patch.telegramBotTokenPath ?? existing.telegramBotTokenPath,
      telegramChatId: patch.telegramChatId ?? existing.telegramChatId,
      silenceThreshold: patch.silenceThreshold ?? existing.silenceThreshold,
      speakerHost: patch.speakerHost ?? existing.speakerHost,
      speakerSshKey: patch.speakerSshKey ?? existing.speakerSshKey,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    };
    this.config.profiles[index] = next;
    return clone(next);
  }

  async deleteProfile(id: string): Promise<void> {
    const index = this.config.profiles.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }
    if (this.config.profiles.length === 1) {
      throw new Error("E_PROFILE_LAST_DELETE_BLOCKED");
    }

    this.config.profiles.splice(index, 1);
    if (this.config.activeProfileId === id) {
      this.config.activeProfileId = this.config.profiles[0]?.id ?? this.config.activeProfileId;
    }
  }

  async activateProfile(id: string): Promise<VoiceProfile> {
    const profile = this.config.profiles.find((item) => item.id === id);
    if (!profile) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }
    this.config.activeProfileId = id;
    return clone(profile);
  }

  async upsertSetupProfile(input: {
    name: string;
    voiceId: string;
    voiceName: string;
    wakeWord: string;
    wakeWordVariants?: string[];
  }): Promise<VoiceProfile> {
    const existing = this.config.profiles.find((item) => item.name === input.name);
    if (existing) {
      return this.updateProfile(existing.id, {
        voiceId: input.voiceId,
        voiceName: input.voiceName,
        wakeWord: input.wakeWord,
        wakeWordVariants: input.wakeWordVariants ?? [input.wakeWord.toLowerCase()]
      });
    }
    return this.createProfile(input);
  }

  async setEventTransport(mode: "local" | "hybrid"): Promise<void> {
    this.config.eventTransport = mode;
  }
}

class FakeServices {
  listenerRestarts = 0;
  bridgeRestarts = 0;

  async listenerStatus(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: "listener: running", stderr: "" };
  }

  async dashboardStatus(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: "dashboard: running", stderr: "" };
  }

  async bridgeStatus(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: "bridge: running", stderr: "" };
  }

  async restartListener(): Promise<{ code: number; stdout: string; stderr: string }> {
    this.listenerRestarts += 1;
    return { code: 0, stdout: "listener restarted", stderr: "" };
  }

  async restartBridge(): Promise<{ code: number; stdout: string; stderr: string }> {
    this.bridgeRestarts += 1;
    return { code: 0, stdout: "bridge restarted", stderr: "" };
  }
}

const fakeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const fakeElevenLabs = {
  synthesizeToFile: async () => undefined
};

async function startHarness(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  store: FakeStore;
  events: EventHub;
  services: FakeServices;
}> {
  const store = new FakeStore();
  const events = new EventHub();
  const services = new FakeServices();

  const app = createApiServer({
    store: store as never,
    events: events as never,
    logger: fakeLogger as never,
    elevenLabs: fakeElevenLabs as never,
    services: services as never
  });

  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("E_TEST_SERVER_ADDRESS");
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    close: async () => {
      server.close();
      await once(server, "close");
    },
    store,
    events,
    services
  };
}

async function requestJson(
  baseUrl: string,
  pathname: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

test("profiles endpoint returns active profile", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/profiles");
    assert.equal(response.status, 200);

    const body = response.body as { activeProfileId: string; profiles: Array<{ id: string }> };
    assert.equal(body.activeProfileId, "starter-profile");
    assert.equal(body.profiles.length, 1);
  } finally {
    await harness.close();
  }
});

test("health endpoint returns bridge runtime field", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/health");
    assert.equal(response.status, 200);
    const body = response.body as { ok: boolean; bridgeRuntime: unknown };
    assert.equal(typeof body.ok, "boolean");
    assert.equal("bridgeRuntime" in body, true);
  } finally {
    await harness.close();
  }
});

test("create and activate profile restarts listener", async () => {
  const harness = await startHarness();
  try {
    const created = await requestJson(harness.baseUrl, "/v1/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Desk Profile",
        voiceId: "voice_2",
        voiceName: "Desk Voice",
        wakeWord: "Desk Arise",
        wakeWordVariants: ["desk arise"],
        model: "eleven_multilingual_v2",
        stability: 0.4,
        similarityBoost: 0.8,
        style: 0.7,
        elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
        silenceThreshold: "0.5%"
      })
    });

    assert.equal(created.status, 201);
    const createdBody = created.body as { profile: { id: string } };

    const activated = await requestJson(harness.baseUrl, `/v1/profiles/${createdBody.profile.id}/activate`, {
      method: "POST"
    });

    assert.equal(activated.status, 200);
    assert.equal(harness.services.listenerRestarts, 1);
  } finally {
    await harness.close();
  }
});

test("listener-event route enforces token", async () => {
  const harness = await startHarness();
  try {
    const unauthorized = await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "wake_detected", payload: { heard: "faye arise" } })
    });
    assert.equal(unauthorized.status, 401);

    const accepted = await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-faye-local-token": "test-local-token"
      },
      body: JSON.stringify({ type: "wake_detected", payload: { heard: "faye arise" } })
    });

    assert.equal(accepted.status, 202);
    const recent = harness.events.recentEvents();
    assert.equal(recent.length >= 1, true);
    assert.equal(recent[recent.length - 1]?.type, "wake_detected");
  } finally {
    await harness.close();
  }
});

test("setup updates transport and active profile", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileName: "Primary Voice",
        voiceId: "voice_main",
        voiceName: "Main",
        wakeWord: "Faye Arise",
        eventTransport: "local"
      })
    });

    assert.equal(response.status, 201);
    assert.equal(harness.services.listenerRestarts, 1);

    const config = harness.store.getConfig();
    assert.equal(config.eventTransport, "local");
    assert.equal(config.activeProfileId.length > 0, true);
  } finally {
    await harness.close();
  }
});

test("setup accepts blank optional fields from dashboard payload", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileName: "Primary Voice",
        apiKey: "",
        voiceId: "voice_main",
        voiceName: "Main",
        wakeWord: "Faye Arise",
        telegramToken: "",
        telegramChatId: ""
      })
    });

    assert.equal(response.status, 201);
  } finally {
    await harness.close();
  }
});

test("setup returns validation details on malformed payload", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileName: "Primary Voice",
        voiceName: "Main",
        wakeWord: "Faye Arise"
      })
    });

    assert.equal(response.status, 400);
    const body = response.body as { error: string; issues: Array<{ path: string; message: string }> };
    assert.equal(body.error, "E_VALIDATION");
    assert.equal(Array.isArray(body.issues), true);
    assert.equal(body.issues.some((item) => item.path === "voiceId"), true);
  } finally {
    await harness.close();
  }
});

test("speak route returns profile-not-found for unknown profile", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", profileId: "missing-profile" })
    });

    assert.equal(response.status, 400);
    const body = response.body as { error: string };
    assert.equal(body.error, "E_PROFILE_NOT_FOUND");
  } finally {
    await harness.close();
  }
});

test("bridge restart endpoint calls service", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/bridge/restart", {
      method: "POST"
    });

    assert.equal(response.status, 200);
    assert.equal(harness.services.bridgeRestarts, 1);
  } finally {
    await harness.close();
  }
});
