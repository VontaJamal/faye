#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function parsePositiveInt(raw, fallback) {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    sessions: 20,
    turns: 4,
    reportDir: path.resolve(process.cwd(), ".faye", "reports"),
    json: false
  };

  for (const arg of argv) {
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg.startsWith("--sessions=")) {
      args.sessions = parsePositiveInt(arg.slice("--sessions=".length), args.sessions);
      continue;
    }
    if (arg.startsWith("--turns=")) {
      args.turns = parsePositiveInt(arg.slice("--turns=".length), args.turns);
      continue;
    }
    if (arg.startsWith("--report-dir=")) {
      const raw = arg.slice("--report-dir=".length).trim();
      if (raw) {
        args.reportDir = path.resolve(process.cwd(), raw);
      }
    }
  }

  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function makeProfile(id, name) {
  const now = nowIso();
  return {
    id,
    name,
    voiceId: "voice-main",
    voiceName: "Main Voice",
    wakeWord: "Faye Arise",
    wakeWordVariants: ["faye arise"],
    model: "eleven_multilingual_v2",
    stability: 0.4,
    similarityBoost: 0.8,
    style: 0.7,
    elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
    silenceThreshold: "0.5%",
    createdAt: now,
    updatedAt: now
  };
}

class SoakStore {
  constructor(localToken) {
    this.localToken = localToken;
    const starter = makeProfile("starter-profile", "Starter Profile");
    this.config = {
      schemaVersion: 1,
      activeProfileId: starter.id,
      profiles: [starter],
      eventTransport: "hybrid",
      localApiBaseUrl: "http://127.0.0.1:4587"
    };
  }

  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  getActiveProfile() {
    const active = this.config.profiles.find((item) => item.id === this.config.activeProfileId);
    if (!active) {
      throw new Error("E_ACTIVE_PROFILE_NOT_FOUND");
    }
    return JSON.parse(JSON.stringify(active));
  }

  getLocalEventToken() {
    return this.localToken;
  }

  async createProfile(input) {
    const next = makeProfile(`soak-${this.config.profiles.length + 1}`, input.name);
    next.voiceId = input.voiceId;
    next.voiceName = input.voiceName;
    next.wakeWord = input.wakeWord;
    next.wakeWordVariants = input.wakeWordVariants ?? [input.wakeWord.toLowerCase()];
    this.config.profiles.push(next);
    return JSON.parse(JSON.stringify(next));
  }

  async updateProfile(id, patch) {
    const index = this.config.profiles.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }
    const existing = this.config.profiles[index];
    if (!existing) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }
    const next = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    };
    this.config.profiles[index] = next;
    return JSON.parse(JSON.stringify(next));
  }

  async deleteProfile(id) {
    const index = this.config.profiles.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }
    if (this.config.profiles.length <= 1) {
      throw new Error("E_PROFILE_LAST_DELETE_BLOCKED");
    }
    this.config.profiles.splice(index, 1);
    if (this.config.activeProfileId === id) {
      this.config.activeProfileId = this.config.profiles[0]?.id ?? this.config.activeProfileId;
    }
  }

  async activateProfile(id) {
    const profile = this.config.profiles.find((item) => item.id === id);
    if (!profile) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }
    this.config.activeProfileId = id;
    return JSON.parse(JSON.stringify(profile));
  }

  async upsertSetupProfile(input) {
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

  async setEventTransport(mode) {
    this.config.eventTransport = mode;
  }
}

class SoakServices {
  async listenerStatus() {
    return { code: 0, stdout: "listener: running", stderr: "" };
  }

  async dashboardStatus() {
    return { code: 0, stdout: "dashboard: running", stderr: "" };
  }

  async bridgeStatus() {
    return { code: 0, stdout: "bridge: running", stderr: "" };
  }

  async restartListener() {
    return { code: 0, stdout: "listener restarted", stderr: "" };
  }

  async restartBridge() {
    return { code: 0, stdout: "bridge restarted", stderr: "" };
  }
}

function actionUpdate(updateId, name, options = {}) {
  const sessionPart = options.sessionId ? ` session=${options.sessionId}` : "";
  const confirmPart = options.confirm === true ? " confirm=yes" : "";
  const noncePart = options.nonce ? ` nonce=${options.nonce}` : "";
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

async function writeReport(reportDir, report) {
  await fs.mkdir(reportDir, { recursive: true, mode: 0o700 });
  const stamp = nowIso().replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `conversation-soak-${stamp}-${process.pid}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(reportPath, 0o600);
  return reportPath;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  let createApiServer;
  let EventHub;
  let UxKpiTracker;
  let processUpdates;
  try {
    ({ createApiServer } = require("../dist/app/api.js"));
    ({ EventHub } = require("../dist/app/events.js"));
    ({ UxKpiTracker } = require("../dist/app/ux-kpi.js"));
    ({ processUpdates } = require("../dist/app/telegramBridge.js"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_BUILD_APP_REQUIRED: run npm run build:app before soak (${message})`);
  }

  const localToken = `soak-token-${process.pid}`;
  const store = new SoakStore(localToken);
  const events = new EventHub();
  const services = new SoakServices();
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  const elevenLabs = {
    synthesizeToFile: async () => undefined
  };

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-soak-"));
  const stopRequestPath = path.join(tempDir, "conversation-stop-request.json");
  const uxKpiPath = path.join(tempDir, "ui-kpi.json");

  const app = createApiServer({
    store,
    events,
    logger,
    elevenLabs,
    services,
    uxKpi: new UxKpiTracker({ reportPath: uxKpiPath }),
    conversationStopRequestPath: stopRequestPath
  });

  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("E_SOAK_ADDRESS");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  const fetchJson = async (pathname, init = undefined) => {
    const response = await fetch(`${baseUrl}${pathname}`, init);
    const text = await response.text();
    const body = text.length > 0 ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`E_HTTP_${response.status}:${pathname}:${JSON.stringify(body)}`);
    }
    return body;
  };

  const postEvent = async (type, payload) => {
    await fetchJson("/v1/internal/listener-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-faye-local-token": localToken
      },
      body: JSON.stringify({
        type,
        payload
      })
    });
  };

  const actionCounters = {
    requested: 0,
    executed: 0,
    blocked: 0,
    needsConfirm: 0,
    ackOk: 0,
    ackError: 0,
    ackNeedsConfirm: 0,
    lowRiskAttempts: 0,
    impactfulBlocked: 0,
    impactfulConfirmed: 0
  };

  let nextUpdateId = 10_000;
  const processed = new Set();

  const bridgeDeps = {
    callLocalApiFn: async () => undefined,
    fetchLocalJsonFn: async () => ({ ok: true }),
    sendTelegramFn: async (_token, _chatId, text) => {
      if (typeof text !== "string") {
        return;
      }
      if (text.includes("status=ok")) {
        actionCounters.ackOk += 1;
      } else if (text.includes("status=error")) {
        actionCounters.ackError += 1;
      } else if (text.includes("status=needs_confirm")) {
        actionCounters.ackNeedsConfirm += 1;
      }
    },
    writeOffsetFn: async () => undefined,
    hasProcessedFn: async (key) => processed.has(key),
    markProcessedFn: async (key) => {
      processed.add(key);
    },
    emitLocalEventFn: async (eventType, payload) => {
      if (eventType === "bridge_action_requested") {
        actionCounters.requested += 1;
      } else if (eventType === "bridge_action_executed") {
        actionCounters.executed += 1;
      } else if (eventType === "bridge_action_blocked") {
        actionCounters.blocked += 1;
        if (payload?.status === "needs_confirm" || payload?.reason === "confirm_required") {
          actionCounters.needsConfirm += 1;
        }
      }

      await postEvent(eventType, payload);
    }
  };

  const totalTurnsRequested = options.sessions * options.turns;
  const expectedImpactfulSessions = Math.floor(options.sessions / 5);

  try {
    for (let sessionIndex = 1; sessionIndex <= options.sessions; sessionIndex += 1) {
      const sessionId = `soak-session-${sessionIndex}`;
      await postEvent("wake_detected", {
        session_id: sessionId,
        heard: "faye arise"
      });
      await postEvent("listener_status", {
        session_id: sessionId,
        status: "conversation_loop_started",
        max_turns: 8
      });

      for (let turn = 1; turn <= options.turns; turn += 1) {
        await postEvent("conversation_turn_started", {
          session_id: sessionId,
          turn
        });
        await postEvent("message_transcribed", {
          session_id: sessionId,
          turn,
          text: `soak user ${sessionIndex}-${turn}`
        });
        await postEvent("bridge_speak_received", {
          session_id: sessionId,
          turn,
          text: `soak assistant ${sessionIndex}-${turn}`
        });
        await postEvent("bridge_spoken", {
          session_id: sessionId,
          turn,
          status: "ok"
        });
        await postEvent("conversation_turn_completed", {
          session_id: sessionId,
          turn,
          wait_result: "completed"
        });
      }

      if (sessionIndex % 3 === 0) {
        actionCounters.lowRiskAttempts += 2;
        await processUpdates("token", 999, [actionUpdate(nextUpdateId, "health_summary", { sessionId })], logger, bridgeDeps);
        nextUpdateId += 1;
        await processUpdates("token", 999, [actionUpdate(nextUpdateId, "voice_test", { sessionId })], logger, bridgeDeps);
        nextUpdateId += 1;
      }

      if (sessionIndex % 5 === 0) {
        actionCounters.impactfulBlocked += 1;
        await processUpdates(
          "token",
          999,
          [actionUpdate(nextUpdateId, "listener_restart", { sessionId, nonce: `impact-${sessionIndex}-block` })],
          logger,
          bridgeDeps
        );
        nextUpdateId += 1;

        actionCounters.impactfulConfirmed += 1;
        await processUpdates(
          "token",
          999,
          [actionUpdate(nextUpdateId, "listener_restart", { sessionId, confirm: true, nonce: `impact-${sessionIndex}-confirm` })],
          logger,
          bridgeDeps
        );
        nextUpdateId += 1;

        await processUpdates(
          "token",
          999,
          [actionUpdate(nextUpdateId, "listener_restart", { sessionId, confirm: true, nonce: `impact-${sessionIndex}-confirm` })],
          logger,
          bridgeDeps
        );
        nextUpdateId += 1;
      }

      await postEvent("listener_status", {
        session_id: sessionId,
        status: "conversation_loop_ended",
        turns: options.turns,
        max_turns: 8,
        reason: "explicit_user_stop"
      });
    }

    const health = await fetchJson("/v1/health");
    const conversation = health.conversation ?? {};
    const metrics = health.metrics ?? {};

    const roundTripTimeouts = Number(metrics?.roundTrip?.timeouts ?? 0);
    const bridgeSpokenError = Number(metrics?.roundTrip?.bridgeSpokenError ?? 0);
    const activeSessions = Number(conversation?.activeSessions ?? 0);
    const completedSessions = Number(conversation?.totals?.sessionsEnded ?? 0);
    const transcribedTurns = Number(metrics?.eventCounts?.messageTranscribed ?? 0);

    const failures = [];
    if (roundTripTimeouts !== 0) {
      failures.push(`roundTrip.timeouts=${roundTripTimeouts}`);
    }
    if (bridgeSpokenError !== 0) {
      failures.push(`bridgeSpokenError=${bridgeSpokenError}`);
    }
    if (completedSessions !== options.sessions) {
      failures.push(`completedSessions=${completedSessions}`);
    }
    if (activeSessions !== 0) {
      failures.push(`conversation.activeSessions=${activeSessions}`);
    }

    const confirmPolicyOk =
      actionCounters.impactfulBlocked >= expectedImpactfulSessions &&
      actionCounters.needsConfirm >= expectedImpactfulSessions &&
      actionCounters.impactfulConfirmed === expectedImpactfulSessions;
    if (!confirmPolicyOk) {
      failures.push(
        `confirm_policy(blocked=${actionCounters.impactfulBlocked},needs_confirm=${actionCounters.needsConfirm},confirmed=${actionCounters.impactfulConfirmed},expected=${expectedImpactfulSessions})`
      );
    }

    const pass = failures.length === 0;

    const report = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      config: {
        sessions: options.sessions,
        turnsPerSession: options.turns
      },
      counters: {
        sessions: {
          requested: options.sessions,
          completed: completedSessions
        },
        turns: {
          requested: totalTurnsRequested,
          transcribed: transcribedTurns
        },
        actions: {
          requested: actionCounters.requested,
          executed: actionCounters.executed,
          blocked: actionCounters.blocked,
          needsConfirm: actionCounters.needsConfirm,
          ackOk: actionCounters.ackOk,
          ackError: actionCounters.ackError,
          ackNeedsConfirm: actionCounters.ackNeedsConfirm,
          lowRiskAttempts: actionCounters.lowRiskAttempts,
          impactfulBlocked: actionCounters.impactfulBlocked,
          impactfulConfirmed: actionCounters.impactfulConfirmed
        }
      },
      health: {
        roundTripTimeouts,
        bridgeSpokenError,
        activeSessions,
        endReasons: conversation?.endReasons ?? {}
      },
      thresholds: {
        roundTripTimeoutsMustEqual: 0,
        bridgeSpokenErrorMustEqual: 0,
        completedSessionsMustEqualRequested: true,
        activeSessionsMustEqual: 0,
        impactfulActionsRequireConfirm: true
      },
      pass,
      failures
    };

    const reportPath = await writeReport(options.reportDir, report);

    if (options.json) {
      console.log(JSON.stringify({ reportPath, ...report }, null, 2));
    } else {
      console.log(`conversation soak report: ${reportPath}`);
      console.log(`pass: ${report.pass ? "true" : "false"}`);
      if (!report.pass) {
        console.log(`failures: ${report.failures.join(", ")}`);
      }
    }

    if (!pass) {
      process.exitCode = 1;
    }
  } finally {
    server.close();
    await once(server, "close");
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
