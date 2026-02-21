import path from "node:path";

import type { Express } from "express";

import { FactoryResetRequestSchema, PanicStopRequestSchema, type SystemRecoveryResult } from "../../types";
import type { ApiRouteContext, RouteErrorHandler } from "../context";

const PANIC_STOP_CONFIRMATION = "PANIC STOP";
const FACTORY_RESET_CONFIRMATION = "FACTORY RESET";

export function registerRecoveryRoutes(app: Express, context: ApiRouteContext, routeError: RouteErrorHandler): void {
  app.post("/v1/system/panic-stop", async (req, res) => {
    try {
      const payload = PanicStopRequestSchema.parse(req.body ?? {});
      context.ensureConfirmation(payload.confirmation, PANIC_STOP_CONFIRMATION, "E_PANIC_CONFIRMATION_REQUIRED");
      const requestedReason = context.normalizeReason(payload.reason, "dashboard_panic_stop");
      const requestedAt = new Date().toISOString();

      context.deps.events.publish("system_panic_stop_requested", {
        reason: requestedReason
      });

      const sessionResult = await context.endActiveSessionForRecovery(requestedReason);
      const listener = await context.deps.services.stopListener();
      const bridge = await context.deps.services.stopBridge();
      const clearedRuntimeFiles = await context.clearVolatileRuntimeFiles();

      const errors: string[] = [];
      if (listener.code !== 0) {
        errors.push("listener_stop_failed");
      }
      if (bridge.code !== 0) {
        errors.push("bridge_stop_failed");
      }

      const result: SystemRecoveryResult = {
        schemaVersion: 1,
        action: "panic-stop",
        requestedAt,
        completedAt: new Date().toISOString(),
        confirmationMatched: true,
        endedSessionId: sessionResult.endedSessionId,
        stopRequestWritten: sessionResult.stopRequestWritten,
        dashboardKeptRunning: true,
        archivePath: null,
        clearedRuntimeFiles,
        wipedPaths: [],
        stoppedServices: {
          listener,
          bridge
        },
        notes: ["dashboard_kept_running=true"],
        errors
      };

      context.deps.events.publish("system_panic_stop_completed", {
        ok: errors.length === 0,
        endedSessionId: sessionResult.endedSessionId,
        clearedRuntimeFiles: clearedRuntimeFiles.length,
        errors
      });

      res.status(errors.length === 0 ? 200 : 500).json({
        ok: errors.length === 0,
        result
      });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.post("/v1/system/factory-reset", async (req, res) => {
    try {
      const payload = FactoryResetRequestSchema.parse(req.body ?? {});
      context.ensureConfirmation(
        payload.confirmation,
        FACTORY_RESET_CONFIRMATION,
        "E_FACTORY_RESET_CONFIRMATION_REQUIRED"
      );
      const requestedReason = context.normalizeReason(payload.reason, "dashboard_factory_reset");
      const requestedAt = new Date().toISOString();
      const stamp = requestedAt.replace(/[:.]/g, "-");
      const archivePath = path.join(
        context.recoveryPaths.openclawDir,
        "faye-archives",
        `factory-reset-${stamp}-${process.pid}`
      );

      context.deps.events.publish("system_factory_reset_requested", {
        reason: requestedReason
      });

      const sessionResult = await context.endActiveSessionForRecovery(requestedReason);
      const archivedPaths = await context.archiveDiagnostics(archivePath);
      const wipedPaths = await context.wipeFactoryResetTargets();

      const listener = await context.deps.services.stopListener();
      const bridge = await context.deps.services.stopBridge();
      const dashboard = await context.deps.services.stopDashboard();

      const errors: string[] = [];
      if (listener.code !== 0) {
        errors.push("listener_stop_failed");
      }
      if (bridge.code !== 0) {
        errors.push("bridge_stop_failed");
      }
      if (dashboard.code !== 0) {
        errors.push("dashboard_stop_failed");
      }

      const result: SystemRecoveryResult = {
        schemaVersion: 1,
        action: "factory-reset",
        requestedAt,
        completedAt: new Date().toISOString(),
        confirmationMatched: true,
        endedSessionId: sessionResult.endedSessionId,
        stopRequestWritten: sessionResult.stopRequestWritten,
        dashboardKeptRunning: false,
        archivePath,
        clearedRuntimeFiles: [],
        wipedPaths,
        stoppedServices: {
          listener,
          bridge,
          dashboard
        },
        notes: [`archivedPaths=${archivedPaths.length}`],
        errors
      };

      context.deps.events.publish("system_factory_reset_completed", {
        ok: errors.length === 0,
        archivePath,
        wipedPaths: wipedPaths.length,
        errors
      });

      res.status(errors.length === 0 ? 200 : 500).json({
        ok: errors.length === 0,
        result
      });
    } catch (error) {
      routeError(res, error);
    }
  });
}
