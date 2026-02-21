import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import express from "express";

import { playAudioFile } from "../audio";
import { ConversationSessionManager } from "../conversationSessionManager";
import { MetricsCollector } from "../metrics";
import {
  CONVERSATION_STOP_REQUEST_PATH,
  DASHBOARD_PUBLIC_DIR,
  FAYE_STATE_DIR,
  LEGACY_CONFIG_PATH,
  OPENCLAW_DIR,
  REPORTS_DIR,
  RUNTIME_CONFIG_PATH,
  SECRETS_DIR
} from "../paths";
import { RoundTripCoordinator } from "../roundTripCoordinator";
import { UxKpiTracker } from "../ux-kpi";
import {
  pathExists,
  writeConversationStopRequest
} from "../utils";
import type { ApiDependencies, ApiRouteContext, RouteErrorHandler } from "./context";
import { ensureConfirmation, normalizeOptional, normalizeReason, parseContextLimit, parseIncludePending, readPositiveEnvInt } from "./helpers";
import { localOnly } from "./middleware/localOnly";
import { routeError } from "./middleware/routeError";
import { registerConversationRoutes } from "./routes/conversation";
import { registerEventRoutes } from "./routes/events";
import { registerHealthRoutes } from "./routes/health";
import { registerProfileRoutes } from "./routes/profiles";
import { registerRecoveryRoutes } from "./routes/recovery";
import { registerSpeechRoutes } from "./routes/speech";

export type { ApiDependencies } from "./context";

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

  const recoveryPaths = {
    openclawDir: deps.systemPaths?.openclawDir ?? OPENCLAW_DIR,
    secretsDir: deps.systemPaths?.secretsDir ?? SECRETS_DIR,
    stateDir: deps.systemPaths?.stateDir ?? FAYE_STATE_DIR,
    runtimeConfigPath: deps.systemPaths?.runtimeConfigPath ?? RUNTIME_CONFIG_PATH,
    legacyConfigPath: deps.systemPaths?.legacyConfigPath ?? LEGACY_CONFIG_PATH,
    reportsDir: deps.systemPaths?.reportsDir ?? REPORTS_DIR
  };

  const volatileRuntimeFiles = [
    stopRequestPath,
    path.join(recoveryPaths.stateDir, "telegram-bridge-runtime.json"),
    path.join(recoveryPaths.stateDir, "telegram-bridge-offset.txt"),
    path.join(recoveryPaths.stateDir, "telegram-bridge-processed-keys.json")
  ];

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

  const endActiveSessionForRecovery = async (requestedReason: string): Promise<{
    endedSessionId: string | null;
    stopRequestWritten: boolean;
  }> => {
    const active = conversation.getActiveSessionSnapshot();
    if (!active || active.state === "ended") {
      return { endedSessionId: null, stopRequestWritten: false };
    }

    const session = conversation.endSession(active.sessionId, "external_stop");
    if (!session) {
      return { endedSessionId: null, stopRequestWritten: false };
    }

    await writeConversationStopRequest(stopRequestPath, {
      sessionId: active.sessionId,
      reason: requestedReason,
      requestedAt: new Date().toISOString()
    });

    deps.events.publish("conversation_ended", {
      session_id: active.sessionId,
      reason: "external_stop",
      requested_reason: requestedReason
    });

    return { endedSessionId: active.sessionId, stopRequestWritten: true };
  };

  const clearVolatileRuntimeFiles = async (): Promise<string[]> => {
    const cleared: string[] = [];
    for (const filePath of volatileRuntimeFiles) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      cleared.push(filePath);
    }
    return cleared;
  };

  const archiveDiagnostics = async (archivePath: string): Promise<string[]> => {
    const archived: string[] = [];
    const targets: Array<{ source: string; name: string }> = [
      { source: recoveryPaths.runtimeConfigPath, name: path.basename(recoveryPaths.runtimeConfigPath) },
      { source: recoveryPaths.legacyConfigPath, name: path.basename(recoveryPaths.legacyConfigPath) },
      { source: recoveryPaths.secretsDir, name: "secrets" },
      { source: recoveryPaths.stateDir, name: "faye-voice" },
      { source: recoveryPaths.reportsDir, name: "reports" }
    ];

    await fs.mkdir(archivePath, { recursive: true, mode: 0o700 });

    for (const target of targets) {
      if (!(await pathExists(target.source))) {
        continue;
      }
      await fs.cp(target.source, path.join(archivePath, target.name), { recursive: true, force: true });
      archived.push(target.source);
    }

    return archived;
  };

  const wipeFactoryResetTargets = async (): Promise<string[]> => {
    const wiped: string[] = [];
    const targets = [
      recoveryPaths.runtimeConfigPath,
      recoveryPaths.legacyConfigPath,
      recoveryPaths.secretsDir,
      recoveryPaths.stateDir,
      recoveryPaths.reportsDir
    ];

    for (const target of targets) {
      await fs.rm(target, { recursive: true, force: true });
      wiped.push(target);
    }

    return wiped;
  };

  const context: ApiRouteContext = {
    deps,
    roundTrip,
    metrics,
    conversation,
    uxKpi,
    stopRequestPath,
    recoveryPaths,
    recordUxKpi,
    normalizeReason,
    normalizeOptional,
    parseContextLimit,
    parseIncludePending,
    ensureConfirmation,
    speakWithProfile,
    endActiveSessionForRecovery,
    clearVolatileRuntimeFiles,
    archiveDiagnostics,
    wipeFactoryResetTargets
  };

  const onRouteError: RouteErrorHandler = (res, error) => {
    routeError(deps.logger, res, error);
  };

  app.use(express.json({ limit: "300kb" }));
  app.use("/v1", localOnly);

  registerHealthRoutes(app, context, onRouteError);
  registerConversationRoutes(app, context, onRouteError);
  registerProfileRoutes(app, context, onRouteError);
  registerSpeechRoutes(app, context, onRouteError);
  registerRecoveryRoutes(app, context, onRouteError);
  registerEventRoutes(app, context, onRouteError);

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
