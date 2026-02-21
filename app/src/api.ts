import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import { playAudioFile } from "./audio";
import { ConversationSessionManager } from "./conversationSessionManager";
import { runDoctor, type DoctorReport } from "./doctor";
import type { EventHub } from "./events";
import { ElevenLabsClient } from "./elevenlabs";
import type { Logger } from "./logger";
import { MetricsCollector, metricsSnapshotToPrometheus } from "./metrics";
import {
  CONVERSATION_STOP_REQUEST_PATH,
  DASHBOARD_PUBLIC_DIR,
  DEFAULT_ELEVENLABS_KEY_PATH,
  DEFAULT_TELEGRAM_TOKEN_PATH
} from "./paths";
import { RoundTripCoordinator } from "./roundTripCoordinator";
import { ServiceControl } from "./service-control";
import type { ConfigStore } from "./store";
import { readBridgeRuntimeStatus } from "./telegramBridge";
import {
  LocalIngestEventSchema,
  ProfileCreateInputSchema,
  ProfilePatchInputSchema,
  SetupInputSchema,
  SpeakTestInputSchema,
  type UxKpiReport,
  type VoiceProfile
} from "./types";
import { UxKpiTracker } from "./ux-kpi";
import {
  clearConversationStopRequest,
  readConversationStopRequest,
  writeConversationStopRequest,
  writeSecret
} from "./utils";

interface ApiDependencies {
  store: ConfigStore;
  events: EventHub;
  logger: Logger;
  elevenLabs: ElevenLabsClient;
  services: ServiceControl;
  uxKpi?: UxKpiTracker;
  conversationStopRequestPath?: string;
}

function readPositiveEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isLoopbackAddress(address?: string): boolean {
  if (!address) {
    return false;
  }
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("::ffff:127.")
  );
}

function localOnly(req: Request, res: Response, next: NextFunction): void {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    res.status(403).json({ error: "E_LOCAL_ONLY" });
    return;
  }

  const remote = req.socket.remoteAddress;
  if (!isLoopbackAddress(remote)) {
    res.status(403).json({ error: "E_LOCAL_ONLY", remote });
    return;
  }

  next();
}

function routeError(logger: Logger, res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error("API_ROUTE_ERROR", "API request failed", { message });

  if (error instanceof ZodError) {
    res.status(400).json({
      error: "E_VALIDATION",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  if (message.startsWith("E_")) {
    res.status(400).json({ error: message });
    return;
  }

  res.status(500).json({ error: "E_INTERNAL" });
}

function profileConfigured(profile: VoiceProfile): boolean {
  const name = profile.name.trim().toLowerCase();
  const voiceName = profile.voiceName.trim();
  const wakeWord = profile.wakeWord.trim();
  if (profile.voiceId === "EXAMPLE_VOICE_ID") {
    return false;
  }
  if (profile.id === "starter-profile" && name === "starter profile") {
    return false;
  }
  return voiceName.length > 0 && wakeWord.length > 0;
}

function onboardingSummary(args: {
  doctor: DoctorReport;
  listener: { code: number };
  dashboard: { code: number };
  bridge: { code: number };
  activeProfile: VoiceProfile;
  uxReport: UxKpiReport | null;
}): {
  checklist: {
    bridgeRequired: boolean;
    completed: number;
    total: number;
    items: Array<{ id: string; label: string; ok: boolean; message: string }>;
  };
  firstSetupAt: string | null;
  firstVoiceSuccessAt: string | null;
  timeToFirstSuccessMs: number | null;
  lastVoiceTestAt: string | null;
  lastVoiceTestOk: boolean | null;
} {
  const bridgeRequired = Boolean(args.activeProfile.telegramBotTokenPath && args.activeProfile.telegramChatId);
  const servicesReady = args.listener.code === 0 && args.dashboard.code === 0 && (!bridgeRequired || args.bridge.code === 0);
  const apiKeyReady =
    args.doctor.files.activeApiKey && args.doctor.secretPermissions.activeApiKeyMode === "0600";
  const readyProfile = profileConfigured(args.activeProfile);
  const voiceTestPassed = args.uxReport?.lastVoiceTestOk === true;

  const items = [
    {
      id: "services-ready",
      label: "Services ready",
      ok: servicesReady,
      message: bridgeRequired
        ? "listener + dashboard + bridge must be running"
        : "listener + dashboard must be running (bridge optional)"
    },
    {
      id: "api-key-ready",
      label: "API key ready",
      ok: apiKeyReady,
      message: "active profile key file exists and has 0600 permissions"
    },
    {
      id: "profile-configured",
      label: "Profile configured",
      ok: readyProfile,
      message: "profile has real voice and wake-word values"
    },
    {
      id: "voice-test-passed",
      label: "Voice test passed",
      ok: voiceTestPassed,
      message: "latest dashboard voice test completed successfully"
    }
  ];

  return {
    checklist: {
      bridgeRequired,
      completed: items.filter((item) => item.ok).length,
      total: items.length,
      items
    },
    firstSetupAt: args.uxReport?.firstSetupAt ?? null,
    firstVoiceSuccessAt: args.uxReport?.firstVoiceSuccessAt ?? null,
    timeToFirstSuccessMs: args.uxReport?.timeToFirstSuccessMs ?? null,
    lastVoiceTestAt: args.uxReport?.lastVoiceTestAt ?? null,
    lastVoiceTestOk: args.uxReport?.lastVoiceTestOk ?? null
  };
}

export function createApiServer(deps: ApiDependencies): express.Express {
  const app = express();
  const roundTrip = new RoundTripCoordinator({
    events: deps.events,
    store: deps.store,
    logger: deps.logger
  });
  const metrics = new MetricsCollector({
    events: deps.events
  });
  const legacyTurns = readPositiveEnvInt("FAYE_CONVERSATION_MAX_TURNS");
  const baseTurns = readPositiveEnvInt("FAYE_CONVERSATION_BASE_TURNS") ?? legacyTurns;
  const extendBy = readPositiveEnvInt("FAYE_CONVERSATION_EXTEND_BY");
  const hardCap = readPositiveEnvInt("FAYE_CONVERSATION_HARD_CAP");
  const ttlMs = readPositiveEnvInt("FAYE_CONVERSATION_TTL_MS");

  const conversation = new ConversationSessionManager({
    events: deps.events,
    logger: deps.logger,
    ttlMs,
    turnPolicy: {
      ...(typeof baseTurns === "number" ? { baseTurns } : {}),
      ...(typeof extendBy === "number" ? { extendBy } : {}),
      ...(typeof hardCap === "number" ? { hardCap } : {})
    }
  });
  const uxKpi = deps.uxKpi ?? new UxKpiTracker();
  const stopRequestPath = deps.conversationStopRequestPath ?? CONVERSATION_STOP_REQUEST_PATH;

  const recordUxKpi = async (operation: string, callback: () => Promise<void>): Promise<void> => {
    try {
      await callback();
    } catch (error) {
      deps.logger.warn("UX_KPI_WRITE_FAILED", "Failed to write UX KPI report", {
        operation,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const normalizeOptional = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const normalizeReason = (value: unknown, fallback: string): string => {
    if (typeof value !== "string") {
      return fallback;
    }
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_:-]+/g, "_")
      .slice(0, 80);
    return normalized.length > 0 ? normalized : fallback;
  };

  const parseContextLimit = (value: unknown): number => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
      return 8;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      return 8;
    }
    return Math.max(1, Math.min(16, parsed));
  };

  const parseIncludePending = (value: unknown): boolean => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== "string") {
      return true;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "no") {
      return false;
    }
    return true;
  };

  const speakWithProfile = async (text: string, profileId?: string): Promise<{ profileId: string }> => {
    const config = deps.store.getConfig();
    const selectedId = profileId ?? config.activeProfileId;
    const profile = config.profiles.find((item) => item.id === selectedId);
    if (!profile) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    const outFile = path.join(os.tmpdir(), `faye-speak-${Date.now()}.mp3`);
    await deps.elevenLabs.synthesizeToFile(profile, text, outFile);
    await playAudioFile(outFile);
    await fs.unlink(outFile).catch(() => undefined);
    return { profileId: profile.id };
  };

  app.use(express.json({ limit: "300kb" }));
  app.use("/v1", localOnly);

  app.get("/v1/health", async (_req, res) => {
    try {
      const doctor = await runDoctor(deps.store);
      const listener = await deps.services.listenerStatus();
      const dashboard = await deps.services.dashboardStatus();
      const bridge = await deps.services.bridgeStatus();
      const bridgeRuntime = await readBridgeRuntimeStatus();
      const activeProfile = deps.store.getActiveProfile();
      const conversationSnapshot = conversation.getSnapshot();
      const activeConversation = conversation.getActiveSessionSnapshot();
      const stopRequest = await readConversationStopRequest(stopRequestPath).catch((error) => {
        deps.logger.warn("CONVERSATION_STOP_READ_FAILED", "Failed to read conversation stop request", {
          message: error instanceof Error ? error.message : String(error)
        });
        return null;
      });
      const stopRequested =
        Boolean(stopRequest) &&
        Boolean(activeConversation) &&
        stopRequest?.sessionId.trim() === activeConversation?.sessionId;
      if (stopRequest && !stopRequested) {
        await clearConversationStopRequest(stopRequestPath).catch((error) => {
          deps.logger.warn("CONVERSATION_STOP_CLEAR_FAILED", "Failed to clear stale conversation stop request", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      }
      const uxReport = await uxKpi.getReport().catch((error) => {
        deps.logger.warn("UX_KPI_READ_FAILED", "Failed to read UX KPI report", {
          message: error instanceof Error ? error.message : String(error)
        });
        return null;
      });

      res.json({
        ok: doctor.ok,
        doctor,
        services: {
          listener,
          dashboard,
          bridge
        },
        bridgeRuntime,
        roundTrip: roundTrip.getSnapshot(),
        metrics: metrics.getSnapshot(),
        conversation: {
          ...conversationSnapshot,
          activeSessionId: activeConversation?.sessionId ?? null,
          activeTurn: activeConversation?.totalTurns ?? null,
          lastTurnAt: activeConversation?.lastTurnAt ?? null,
          lastEndReason: conversationSnapshot.lastEnded?.reason ?? null,
          stopRequested
        },
        onboarding: onboardingSummary({
          doctor,
          listener,
          dashboard,
          bridge,
          activeProfile,
          uxReport
        })
      });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.get("/v1/metrics", (req, res) => {
    try {
      const snapshot = metrics.getSnapshot();
      const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "";
      if (format === "prom" || format === "prometheus" || format === "text") {
        res.type("text/plain").send(metricsSnapshotToPrometheus(snapshot));
        return;
      }
      res.json(snapshot);
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.get("/v1/conversation/active", (_req, res) => {
    try {
      const session = conversation.getActiveSessionSnapshot();
      res.json({ session });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.get("/v1/conversation/:sessionId/context", (req, res) => {
    try {
      const sessionId = req.params.sessionId.trim();
      if (!sessionId) {
        res.status(400).json({ error: "E_CONVERSATION_ID_REQUIRED" });
        return;
      }

      const context = conversation.getContext(sessionId, {
        limit: parseContextLimit(req.query.limit),
        includePending: parseIncludePending(req.query.includePending)
      });

      if (!context) {
        res.status(404).json({ error: "E_CONVERSATION_NOT_FOUND" });
        return;
      }

      res.json({ context });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.get("/v1/conversation/:sessionId", (req, res) => {
    try {
      const sessionId = req.params.sessionId.trim();
      if (!sessionId) {
        res.status(400).json({ error: "E_CONVERSATION_ID_REQUIRED" });
        return;
      }

      const session = conversation.getSessionSnapshot(sessionId);
      if (!session) {
        res.status(404).json({ error: "E_CONVERSATION_NOT_FOUND" });
        return;
      }

      res.json({ session });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/conversation/:sessionId/end", async (req, res) => {
    try {
      const sessionId = req.params.sessionId.trim();
      if (!sessionId) {
        res.status(400).json({ error: "E_CONVERSATION_ID_REQUIRED" });
        return;
      }

      const requestedReason = normalizeReason((req.body ?? {})["reason"], "manual_terminated");
      const endReason = "external_stop";
      const session = conversation.endSession(sessionId, endReason);
      if (!session) {
        res.status(404).json({ error: "E_CONVERSATION_NOT_FOUND" });
        return;
      }

      await writeConversationStopRequest(stopRequestPath, {
        sessionId,
        reason: requestedReason,
        requestedAt: new Date().toISOString()
      });

      deps.events.publish("conversation_ended", {
        session_id: sessionId,
        reason: endReason,
        requested_reason: requestedReason
      });

      res.json({ session, endReason, requestedReason });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.get("/v1/profiles", (_req, res) => {
    try {
      const config = deps.store.getConfig();
      res.json({
        activeProfileId: config.activeProfileId,
        eventTransport: config.eventTransport,
        profiles: config.profiles
      });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/setup", async (req, res) => {
    await recordUxKpi("setup-attempt", async () => {
      await uxKpi.recordSetupAttempt();
    });
    try {
      const raw = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const setup = SetupInputSchema.parse({
        ...raw,
        apiKey: normalizeOptional(raw.apiKey),
        telegramToken: normalizeOptional(raw.telegramToken),
        telegramChatId: normalizeOptional(raw.telegramChatId)
      });

      if (setup.apiKey) {
        await writeSecret(DEFAULT_ELEVENLABS_KEY_PATH, setup.apiKey);
      }
      if (setup.telegramToken) {
        await writeSecret(DEFAULT_TELEGRAM_TOKEN_PATH, setup.telegramToken);
      }

      const profile = await deps.store.upsertSetupProfile({
        name: setup.profileName,
        voiceId: setup.voiceId,
        voiceName: setup.voiceName,
        wakeWord: setup.wakeWord,
        wakeWordVariants: [setup.wakeWord.toLowerCase()],
        model: "eleven_multilingual_v2",
        stability: 0.4,
        similarityBoost: 0.8,
        style: 0.7,
        elevenLabsApiKeyPath: DEFAULT_ELEVENLABS_KEY_PATH,
        telegramBotTokenPath: setup.telegramToken ? DEFAULT_TELEGRAM_TOKEN_PATH : undefined,
        telegramChatId: setup.telegramChatId,
        silenceThreshold: "0.5%"
      });

      await deps.store.activateProfile(profile.id);
      await deps.store.setEventTransport(setup.eventTransport);
      const restart = await deps.services.restartListener();

      deps.events.publish("setup_saved", {
        profileId: profile.id,
        profileName: profile.name,
        listenerRestartCode: restart.code
      });
      await recordUxKpi("setup-success", async () => {
        await uxKpi.recordSetupSuccess();
      });

      res.status(201).json({ profile, listenerRestart: restart });
    } catch (error) {
      await recordUxKpi("setup-failure", async () => {
        await uxKpi.recordSetupFailure(error);
      });
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/profiles", async (req, res) => {
    try {
      const profile = await deps.store.createProfile(ProfileCreateInputSchema.parse(req.body));
      deps.events.publish("profile_created", { id: profile.id, name: profile.name });
      res.status(201).json({ profile });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.patch("/v1/profiles/:id", async (req, res) => {
    try {
      const profileId = req.params.id;
      const profile = await deps.store.updateProfile(profileId, ProfilePatchInputSchema.parse(req.body));
      deps.events.publish("profile_updated", { id: profile.id, name: profile.name });
      res.json({ profile });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.delete("/v1/profiles/:id", async (req, res) => {
    try {
      const profileId = req.params.id;
      await deps.store.deleteProfile(profileId);
      deps.events.publish("profile_deleted", { id: profileId });
      res.status(204).send();
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/profiles/:id/activate", async (req, res) => {
    try {
      const profileId = req.params.id;
      const profile = await deps.store.activateProfile(profileId);
      const restart = await deps.services.restartListener();
      deps.events.publish("profile_activated", {
        id: profile.id,
        name: profile.name,
        listenerRestartCode: restart.code
      });
      res.json({ profile, listenerRestart: restart });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/speak", async (req, res) => {
    try {
      const parsed = SpeakTestInputSchema.parse(req.body ?? {});
      const played = await speakWithProfile(parsed.text, parsed.profileId);
      deps.events.publish("speak", { profileId: played.profileId, text: parsed.text });
      res.json({ ok: true, profileId: played.profileId });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/speak/test", async (req, res) => {
    await recordUxKpi("voice-test-attempt", async () => {
      await uxKpi.recordVoiceTestAttempt();
    });
    try {
      const parsed = SpeakTestInputSchema.parse(req.body ?? {});
      const played = await speakWithProfile(parsed.text, parsed.profileId);
      deps.events.publish("speak_test", { profileId: played.profileId, text: parsed.text });
      await recordUxKpi("voice-test-success", async () => {
        await uxKpi.recordVoiceTestSuccess();
      });
      res.json({ ok: true, profileId: played.profileId });
    } catch (error) {
      await recordUxKpi("voice-test-failure", async () => {
        await uxKpi.recordVoiceTestFailure(error);
      });
      routeError(deps.logger, res, error);
    }
  });

  app.get("/v1/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    for (const event of deps.events.recentEvents()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const unsubscribe = deps.events.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 25_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      res.end();
    });
  });

  app.post("/v1/listener/restart", async (_req, res) => {
    await recordUxKpi("listener-restart-attempt", async () => {
      await uxKpi.recordListenerRestartAttempt();
    });
    try {
      const result = await deps.services.restartListener();
      deps.events.publish("listener_restarted", { code: result.code });
      if (result.code !== 0) {
        await recordUxKpi("listener-restart-failure", async () => {
          await uxKpi.recordListenerRestartFailure(result.stderr || result.stdout || "non-zero exit");
        });
      }
      res.json({ result });
    } catch (error) {
      await recordUxKpi("listener-restart-failure", async () => {
        await uxKpi.recordListenerRestartFailure(error);
      });
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/bridge/restart", async (_req, res) => {
    await recordUxKpi("bridge-restart-attempt", async () => {
      await uxKpi.recordBridgeRestartAttempt();
    });
    try {
      const result = await deps.services.restartBridge();
      deps.events.publish("bridge_restarted", { code: result.code });
      if (result.code !== 0) {
        await recordUxKpi("bridge-restart-failure", async () => {
          await uxKpi.recordBridgeRestartFailure(result.stderr || result.stdout || "non-zero exit");
        });
      }
      res.json({ result });
    } catch (error) {
      await recordUxKpi("bridge-restart-failure", async () => {
        await uxKpi.recordBridgeRestartFailure(error);
      });
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/internal/listener-event", (req, res) => {
    try {
      const token = req.header("x-faye-local-token") ?? "";
      if (token !== deps.store.getLocalEventToken()) {
        res.status(401).json({ error: "E_UNAUTHORIZED" });
        return;
      }

      const event = LocalIngestEventSchema.parse(req.body ?? {});
      deps.events.publish(event.type, event.payload);
      res.status(202).json({ accepted: true });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.use(express.static(DASHBOARD_PUBLIC_DIR));

  app.get("*", async (_req, res) => {
    const indexPath = path.join(DASHBOARD_PUBLIC_DIR, "index.html");
    try {
      const content = await fs.readFile(indexPath, "utf8");
      res.type("html").send(content);
    } catch {
      res.status(404).send("Dashboard not built yet. Run npm run build:dashboard");
    }
  });

  return app;
}
