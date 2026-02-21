import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createApiServer } from "../api";
import { EventHub } from "../events";
import type { RuntimeConfig, VoiceProfile } from "../types";
import { UxKpiTracker } from "../ux-kpi";

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

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

  enableTelegramForActiveProfile(): void {
    const profile = this.config.profiles.find((item) => item.id === this.config.activeProfileId);
    if (!profile) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    profile.telegramBotTokenPath = "~/.openclaw/secrets/telegram-bot-token.txt";
    profile.telegramChatId = "123456789";
    profile.updatedAt = nowIso();
  }
}

class FakeServices {
  listenerRestarts = 0;
  bridgeRestarts = 0;
  listenerStops = 0;
  bridgeStops = 0;
  dashboardStops = 0;
  bridgeStatusCode = 0;
  stopCode = 0;

  async listenerStatus(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: "listener: running", stderr: "" };
  }

  async dashboardStatus(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: "dashboard: running", stderr: "" };
  }

  async bridgeStatus(): Promise<{ code: number; stdout: string; stderr: string }> {
    return {
      code: this.bridgeStatusCode,
      stdout: this.bridgeStatusCode === 0 ? "bridge: running" : "bridge: stopped",
      stderr: ""
    };
  }

  async restartListener(): Promise<{ code: number; stdout: string; stderr: string }> {
    this.listenerRestarts += 1;
    return { code: 0, stdout: "listener restarted", stderr: "" };
  }

  async restartBridge(): Promise<{ code: number; stdout: string; stderr: string }> {
    this.bridgeRestarts += 1;
    return { code: 0, stdout: "bridge restarted", stderr: "" };
  }

  async stopListener(): Promise<{ code: number; stdout: string; stderr: string }> {
    this.listenerStops += 1;
    return {
      code: this.stopCode,
      stdout: this.stopCode === 0 ? "listener stopped" : "",
      stderr: this.stopCode === 0 ? "" : "listener stop failed"
    };
  }

  async stopBridge(): Promise<{ code: number; stdout: string; stderr: string }> {
    this.bridgeStops += 1;
    return {
      code: this.stopCode,
      stdout: this.stopCode === 0 ? "bridge stopped" : "",
      stderr: this.stopCode === 0 ? "" : "bridge stop failed"
    };
  }

  async stopDashboard(): Promise<{ code: number; stdout: string; stderr: string }> {
    this.dashboardStops += 1;
    return {
      code: this.stopCode,
      stdout: this.stopCode === 0 ? "dashboard stopped" : "",
      stderr: this.stopCode === 0 ? "" : "dashboard stop failed"
    };
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
  stopRequestPath: string;
  systemPaths: {
    openclawDir: string;
    secretsDir: string;
    stateDir: string;
    runtimeConfigPath: string;
    legacyConfigPath: string;
    reportsDir: string;
  };
}> {
  const store = new FakeStore();
  const events = new EventHub();
  const services = new FakeServices();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-api-test-"));
  const uxKpiPath = path.join(tempDir, "ui-kpi.json");
  const stopRequestPath = path.join(tempDir, "conversation-stop-request.json");
  const stateDir = path.join(tempDir, "state");
  const secretsDir = path.join(tempDir, "secrets");
  const reportsDir = path.join(tempDir, "reports");
  const openclawDir = path.join(tempDir, "openclaw");
  const runtimeConfigPath = path.join(tempDir, "faye-runtime-config.json");
  const legacyConfigPath = path.join(tempDir, "faye-voice-config.json");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(secretsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.mkdir(openclawDir, { recursive: true });

  const app = createApiServer({
    store: store as never,
    events: events as never,
    logger: fakeLogger as never,
    elevenLabs: fakeElevenLabs as never,
    services: services as never,
    uxKpi: new UxKpiTracker({ reportPath: uxKpiPath }),
    conversationStopRequestPath: stopRequestPath,
    systemPaths: {
      openclawDir,
      secretsDir,
      stateDir,
      runtimeConfigPath,
      legacyConfigPath,
      reportsDir
    }
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
      await fs.rm(tempDir, { recursive: true, force: true });
    },
    store,
    events,
    services,
    stopRequestPath,
    systemPaths: {
      openclawDir,
      secretsDir,
      stateDir,
      runtimeConfigPath,
      legacyConfigPath,
      reportsDir
    }
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
    const body = response.body as {
      ok: boolean;
      bridgeRuntime: unknown;
      roundTrip: { activeSessions: number };
      metrics: { eventCounts: { wakeDetections: number } };
      conversation: {
        policy: {
          ttlMs: number;
          turnPolicy: {
            baseTurns: number;
            extendBy: number;
            hardCap: number;
          };
        };
        activeSessions: number;
        activeSessionId: string | null;
        activeTurn: number | null;
        lastTurnAt: string | null;
        lastEndReason: string | null;
        stopRequested: boolean;
        endReasons: Record<string, number>;
        sessions: Array<{ sessionId: string; state: string; turnLimit: number; turns: Array<{ turn: number; userText: string | null }> }>;
      };
      onboarding: {
        checklist: {
          bridgeRequired: boolean;
          completed: number;
          total: number;
          items: Array<{ id: string; ok: boolean; label: string; message: string }>;
        };
        firstSetupAt: string | null;
        firstVoiceSuccessAt: string | null;
        timeToFirstSuccessMs: number | null;
        lastVoiceTestAt: string | null;
        lastVoiceTestOk: boolean | null;
      };
    };
    assert.equal(typeof body.ok, "boolean");
    assert.equal("bridgeRuntime" in body, true);
    assert.equal(typeof body.roundTrip.activeSessions, "number");
    assert.equal(typeof body.metrics.eventCounts.wakeDetections, "number");
    assert.equal(typeof body.conversation.activeSessions, "number");
    assert.equal(body.conversation.policy.ttlMs > 0, true);
    assert.equal(body.conversation.policy.turnPolicy.baseTurns, 8);
    assert.equal(body.conversation.policy.turnPolicy.extendBy, 4);
    assert.equal(body.conversation.policy.turnPolicy.hardCap, 16);
    assert.equal(typeof body.conversation.stopRequested, "boolean");
    assert.equal(typeof body.conversation.endReasons, "object");
    assert.equal(Array.isArray(body.conversation.sessions), true);
    assert.equal(typeof body.onboarding.checklist.bridgeRequired, "boolean");
    assert.equal(Array.isArray(body.onboarding.checklist.items), true);
    assert.equal(body.onboarding.checklist.total, 4);
    assert.equal(body.onboarding.firstVoiceSuccessAt, null);
    assert.equal(body.onboarding.lastVoiceTestOk, null);
  } finally {
    await harness.close();
  }
});

test("health onboarding marks bridge optional when telegram is not configured", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/health");
    assert.equal(response.status, 200);
    const body = response.body as {
      onboarding: {
        checklist: {
          bridgeRequired: boolean;
          items: Array<{ id: string; ok: boolean }>;
        };
      };
    };

    const servicesReady = body.onboarding.checklist.items.find((item) => item.id === "services-ready");
    assert.equal(body.onboarding.checklist.bridgeRequired, false);
    assert.equal(servicesReady?.ok, true);
  } finally {
    await harness.close();
  }
});

test("health onboarding requires bridge when telegram is configured", async () => {
  const harness = await startHarness();
  try {
    harness.store.enableTelegramForActiveProfile();
    harness.services.bridgeStatusCode = 1;

    const response = await requestJson(harness.baseUrl, "/v1/health");
    assert.equal(response.status, 200);
    const body = response.body as {
      onboarding: {
        checklist: {
          bridgeRequired: boolean;
          items: Array<{ id: string; ok: boolean }>;
        };
      };
    };

    const servicesReady = body.onboarding.checklist.items.find((item) => item.id === "services-ready");
    assert.equal(body.onboarding.checklist.bridgeRequired, true);
    assert.equal(servicesReady?.ok, false);
  } finally {
    await harness.close();
  }
});

test("metrics endpoint tracks wake-to-spoken flow", async () => {
  const harness = await startHarness();
  try {
    const acceptedWake = await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-faye-local-token": "test-local-token"
      },
      body: JSON.stringify({ type: "wake_detected", payload: { session_id: "s-metrics-1", heard: "faye arise" } })
    });
    assert.equal(acceptedWake.status, 202);

    const acceptedSpoken = await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-faye-local-token": "test-local-token"
      },
      body: JSON.stringify({ type: "bridge_spoken", payload: { session_id: "s-metrics-1", status: "ok" } })
    });
    assert.equal(acceptedSpoken.status, 202);

    const metrics = await requestJson(harness.baseUrl, "/v1/metrics");
    assert.equal(metrics.status, 200);

    const body = metrics.body as {
      eventCounts: { wakeDetections: number };
      roundTrip: { bridgeSpokenOk: number };
      latency: { samples: number; p95Ms: number | null };
    };
    assert.equal(body.eventCounts.wakeDetections, 1);
    assert.equal(body.roundTrip.bridgeSpokenOk, 1);
    assert.equal(body.latency.samples >= 1, true);
    assert.equal(body.latency.p95Ms !== null, true);

    const promResponse = await fetch(`${harness.baseUrl}/v1/metrics?format=prom`);
    assert.equal(promResponse.status, 200);
    const promBody = await promResponse.text();
    assert.equal(promBody.includes("faye_wake_detections_total"), true);
    assert.equal(promBody.includes("faye_roundtrip_latency_p95_ms"), true);
  } finally {
    await harness.close();
  }
});

test("health conversation snapshot tracks multi-turn session context", async () => {
  const harness = await startHarness();
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-faye-local-token": "test-local-token"
    };

    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "wake_detected", payload: { session_id: "s-convo-1", heard: "faye arise" } })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "message_transcribed", payload: { session_id: "s-convo-1", turn: 1, text: "hello" } })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "bridge_speak_received",
        payload: { session_id: "s-convo-1", turn: 1, text: "hi there" }
      })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "bridge_spoken", payload: { session_id: "s-convo-1", turn: 1, status: "ok" } })
    });

    const health = await requestJson(harness.baseUrl, "/v1/health");
    assert.equal(health.status, 200);

    const body = health.body as {
      conversation: {
        activeSessions: number;
        activeSessionId: string | null;
        activeTurn: number | null;
        lastTurnAt: string | null;
        stopRequested: boolean;
        sessions: Array<{
          sessionId: string;
          state: string;
          turnLimit: number;
          totalTurns: number;
          turns: Array<{ turn: number; userText: string | null; assistantText: string | null }>;
        }>;
      };
    };

    const session = body.conversation.sessions.find((item) => item.sessionId === "s-convo-1");
    assert.equal(body.conversation.activeSessions >= 1, true);
    assert.equal(body.conversation.activeSessionId, "s-convo-1");
    assert.equal(body.conversation.activeTurn, 1);
    assert.equal(typeof body.conversation.lastTurnAt, "string");
    assert.equal(body.conversation.stopRequested, false);
    assert.equal(session?.state, "awaiting_user");
    assert.equal(session?.turnLimit, 8);
    assert.equal(session?.totalTurns, 1);
    assert.equal(session?.turns[0]?.assistantText, "hi there");
  } finally {
    await harness.close();
  }
});

test("conversation session API returns retained session details", async () => {
  const harness = await startHarness();
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-faye-local-token": "test-local-token"
    };

    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "wake_detected", payload: { session_id: "s-api-1", heard: "faye arise" } })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "message_transcribed", payload: { session_id: "s-api-1", turn: 1, text: "hello" } })
    });

    const response = await requestJson(harness.baseUrl, "/v1/conversation/s-api-1");
    assert.equal(response.status, 200);
    const body = response.body as {
      session: {
        sessionId: string;
        state: string;
        totalTurns: number;
      };
    };
    assert.equal(body.session.sessionId, "s-api-1");
    assert.equal(body.session.state, "awaiting_assistant");
    assert.equal(body.session.totalTurns, 1);
  } finally {
    await harness.close();
  }
});

test("conversation active API returns active session summary", async () => {
  const harness = await startHarness();
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-faye-local-token": "test-local-token"
    };

    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "wake_detected", payload: { session_id: "s-active-1", heard: "faye arise" } })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "message_transcribed", payload: { session_id: "s-active-1", turn: 1, text: "hello" } })
    });

    const response = await requestJson(harness.baseUrl, "/v1/conversation/active");
    assert.equal(response.status, 200);
    const body = response.body as {
      session: {
        sessionId: string;
        state: string;
        totalTurns: number;
      };
    };

    assert.equal(body.session.sessionId, "s-active-1");
    assert.equal(body.session.state, "awaiting_assistant");
    assert.equal(body.session.totalTurns, 1);
  } finally {
    await harness.close();
  }
});

test("conversation context API returns role-based context with filtering", async () => {
  const harness = await startHarness();
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-faye-local-token": "test-local-token"
    };

    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "wake_detected", payload: { session_id: "s-context-api-1", heard: "faye arise" } })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "message_transcribed",
        payload: { session_id: "s-context-api-1", turn: 1, text: "check status" }
      })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "bridge_action_requested",
        payload: { session_id: "s-context-api-1", action: "listener_restart", confirm: false }
      })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "bridge_action_blocked",
        payload: { session_id: "s-context-api-1", action: "listener_restart", reason: "confirm_required" }
      })
    });
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "bridge_speak_received",
        payload: { session_id: "s-context-api-1", turn: 1, text: "Please confirm restart." }
      })
    });

    const response = await requestJson(
      harness.baseUrl,
      "/v1/conversation/s-context-api-1/context?limit=8&includePending=false"
    );
    assert.equal(response.status, 200);
    const body = response.body as {
      context: {
        sessionId: string;
        messages: Array<{ role: string; status?: string; action?: string }>;
      };
    };

    assert.equal(body.context.sessionId, "s-context-api-1");
    assert.equal(body.context.messages.some((item) => item.role === "user"), true);
    assert.equal(body.context.messages.some((item) => item.status === "needs_confirm"), true);
    assert.equal(body.context.messages.some((item) => item.action === "listener_restart"), true);
    assert.equal(body.context.messages.some((item) => item.status === "pending"), false);
  } finally {
    await harness.close();
  }
});

test("conversation end API terminates active session", async () => {
  const harness = await startHarness();
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-faye-local-token": "test-local-token"
    };

    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "wake_detected", payload: { session_id: "s-end-api-1", heard: "faye arise" } })
    });

    const response = await requestJson(harness.baseUrl, "/v1/conversation/s-end-api-1/end", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: "dashboard_manual_end"
      })
    });
    assert.equal(response.status, 200);
    const body = response.body as {
      session: {
        state: string;
        endReason: string;
      };
      requestedReason: string;
      endReason: string;
    };
    assert.equal(body.session.state, "ended");
    assert.equal(body.session.endReason, "external_stop");
    assert.equal(body.endReason, "external_stop");
    assert.equal(body.requestedReason, "dashboard_manual_end");

    const stopRequest = JSON.parse(await fs.readFile(harness.stopRequestPath, "utf8")) as {
      sessionId: string;
      reason: string;
    };
    assert.equal(stopRequest.sessionId, "s-end-api-1");
    assert.equal(stopRequest.reason, "dashboard_manual_end");

    const missing = await requestJson(harness.baseUrl, "/v1/conversation/missing-session/end", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });
    assert.equal(missing.status, 404);
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

test("panic-stop endpoint requires typed confirmation", async () => {
  const harness = await startHarness();
  try {
    const response = await requestJson(harness.baseUrl, "/v1/system/panic-stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmation: "not it"
      })
    });

    assert.equal(response.status, 400);
    const body = response.body as { error: string };
    assert.equal(body.error, "E_PANIC_CONFIRMATION_REQUIRED");
  } finally {
    await harness.close();
  }
});

test("panic-stop endpoint stops listener and bridge while keeping dashboard running", async () => {
  const harness = await startHarness();
  try {
    await requestJson(harness.baseUrl, "/v1/internal/listener-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-faye-local-token": "test-local-token"
      },
      body: JSON.stringify({ type: "wake_detected", payload: { session_id: "s-panic-1", heard: "faye arise" } })
    });

    const response = await requestJson(harness.baseUrl, "/v1/system/panic-stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmation: "PANIC STOP",
        reason: "integration_panic"
      })
    });

    assert.equal(response.status, 200);
    const body = response.body as {
      ok: boolean;
      result: {
        action: string;
        endedSessionId: string | null;
        dashboardKeptRunning: boolean;
      };
    };

    assert.equal(body.ok, true);
    assert.equal(body.result.action, "panic-stop");
    assert.equal(body.result.endedSessionId, "s-panic-1");
    assert.equal(body.result.dashboardKeptRunning, true);
    assert.equal(harness.services.listenerStops, 1);
    assert.equal(harness.services.bridgeStops, 1);
    assert.equal(harness.services.dashboardStops, 0);
  } finally {
    await harness.close();
  }
});

test("factory-reset endpoint archives diagnostics then wipes state", async () => {
  const harness = await startHarness();
  try {
    await fs.writeFile(harness.systemPaths.runtimeConfigPath, JSON.stringify({ ok: true }), "utf8");
    await fs.writeFile(harness.systemPaths.legacyConfigPath, JSON.stringify({ ok: true }), "utf8");
    await fs.writeFile(path.join(harness.systemPaths.secretsDir, "elevenlabs-api-key.txt"), "test-key\n", "utf8");
    await fs.writeFile(path.join(harness.systemPaths.stateDir, "telegram-bridge-runtime.json"), "{}", "utf8");
    await fs.writeFile(path.join(harness.systemPaths.reportsDir, "ui-kpi.json"), "{}", "utf8");

    const response = await requestJson(harness.baseUrl, "/v1/system/factory-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmation: "FACTORY RESET",
        reason: "integration_factory_reset"
      })
    });

    assert.equal(response.status, 200);
    const body = response.body as {
      ok: boolean;
      result: {
        action: string;
        archivePath: string | null;
        wipedPaths: string[];
      };
    };

    assert.equal(body.ok, true);
    assert.equal(body.result.action, "factory-reset");
    assert.equal(typeof body.result.archivePath, "string");
    assert.equal(Array.isArray(body.result.wipedPaths), true);
    assert.equal(await exists(String(body.result.archivePath)), true);
    assert.equal(await exists(harness.systemPaths.runtimeConfigPath), false);
    assert.equal(await exists(harness.systemPaths.legacyConfigPath), false);
    assert.equal(await exists(harness.systemPaths.secretsDir), false);
    assert.equal(await exists(harness.systemPaths.stateDir), false);
    assert.equal(await exists(harness.systemPaths.reportsDir), false);
    assert.equal(harness.services.listenerStops, 1);
    assert.equal(harness.services.bridgeStops, 1);
    assert.equal(harness.services.dashboardStops, 1);
  } finally {
    await harness.close();
  }
});
