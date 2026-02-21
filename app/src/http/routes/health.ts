import type { Express } from "express";

import { runDoctor, type DoctorReport } from "../../doctor";
import { metricsSnapshotToPrometheus } from "../../metrics";
import { readBridgeRuntimeStatus } from "../../telegramBridge";
import type { UxKpiReport, VoiceProfile } from "../../types";
import { clearConversationStopRequest, readConversationStopRequest } from "../../utils";
import type { ApiRouteContext, RouteErrorHandler } from "../context";
import { registerRoundTripStatusRoute } from "./roundTripStatus";

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
  const servicesReady =
    args.listener.code === 0 && args.dashboard.code === 0 && (!bridgeRequired || args.bridge.code === 0);
  const apiKeyReady = args.doctor.files.activeApiKey && args.doctor.secretPermissions.activeApiKeyMode === "0600";
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

export function registerHealthRoutes(app: Express, context: ApiRouteContext, routeError: RouteErrorHandler): void {
  app.get("/v1/health", async (_req, res) => {
    try {
      const doctor = await runDoctor(context.deps.store);
      const listener = await context.deps.services.listenerStatus();
      const dashboard = await context.deps.services.dashboardStatus();
      const bridge = await context.deps.services.bridgeStatus();
      const bridgeRuntime = await readBridgeRuntimeStatus();
      const activeProfile = context.deps.store.getActiveProfile();
      const conversationSnapshot = context.conversation.getSnapshot();
      const activeConversation = context.conversation.getActiveSessionSnapshot();
      const stopRequest = await readConversationStopRequest(context.stopRequestPath).catch((error) => {
        context.deps.logger.warn("CONVERSATION_STOP_READ_FAILED", "Failed to read conversation stop request", {
          message: error instanceof Error ? error.message : String(error)
        });
        return null;
      });

      const stopRequested =
        Boolean(stopRequest) &&
        Boolean(activeConversation) &&
        stopRequest?.sessionId.trim() === activeConversation?.sessionId;

      if (stopRequest && !stopRequested) {
        await clearConversationStopRequest(context.stopRequestPath).catch((error) => {
          context.deps.logger.warn("CONVERSATION_STOP_CLEAR_FAILED", "Failed to clear stale conversation stop request", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      }

      const uxReport = await context.uxKpi.getReport().catch((error) => {
        context.deps.logger.warn("UX_KPI_READ_FAILED", "Failed to read UX KPI report", {
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
        roundTrip: context.roundTrip.getSnapshot(),
        metrics: context.metrics.getSnapshot(),
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
      routeError(res, error);
    }
  });

  app.get("/v1/metrics", (req, res) => {
    try {
      const snapshot = context.metrics.getSnapshot();
      const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "";
      if (format === "prom" || format === "prometheus" || format === "text") {
        res.type("text/plain").send(metricsSnapshotToPrometheus(snapshot));
        return;
      }
      res.json(snapshot);
    } catch (error) {
      routeError(res, error);
    }
  });

  registerRoundTripStatusRoute(app, { roundTrip: context.roundTrip });
}
