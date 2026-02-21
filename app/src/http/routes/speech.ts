import type { Express } from "express";

import { SpeakTestInputSchema } from "../../types";
import type { ApiRouteContext, RouteErrorHandler } from "../context";

export function registerSpeechRoutes(app: Express, context: ApiRouteContext, routeError: RouteErrorHandler): void {
  app.post("/v1/speak", async (req, res) => {
    try {
      const parsed = SpeakTestInputSchema.parse(req.body ?? {});
      const played = await context.speakWithProfile(parsed.text, parsed.profileId);
      context.deps.events.publish("speak", { profileId: played.profileId, text: parsed.text });
      res.json({ ok: true, profileId: played.profileId });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.post("/v1/speak/test", async (req, res) => {
    await context.recordUxKpi("voice-test-attempt", async () => {
      await context.uxKpi.recordVoiceTestAttempt();
    });

    try {
      const parsed = SpeakTestInputSchema.parse(req.body ?? {});
      const played = await context.speakWithProfile(parsed.text, parsed.profileId);
      context.deps.events.publish("speak_test", { profileId: played.profileId, text: parsed.text });

      await context.recordUxKpi("voice-test-success", async () => {
        await context.uxKpi.recordVoiceTestSuccess();
      });

      res.json({ ok: true, profileId: played.profileId });
    } catch (error) {
      await context.recordUxKpi("voice-test-failure", async () => {
        await context.uxKpi.recordVoiceTestFailure(error);
      });
      routeError(res, error);
    }
  });

  app.post("/v1/listener/restart", async (_req, res) => {
    await context.recordUxKpi("listener-restart-attempt", async () => {
      await context.uxKpi.recordListenerRestartAttempt();
    });

    try {
      const result = await context.deps.services.restartListener();
      context.deps.events.publish("listener_restarted", { code: result.code });
      if (result.code !== 0) {
        await context.recordUxKpi("listener-restart-failure", async () => {
          await context.uxKpi.recordListenerRestartFailure(result.stderr || result.stdout || "non-zero exit");
        });
      }
      res.json({ result });
    } catch (error) {
      await context.recordUxKpi("listener-restart-failure", async () => {
        await context.uxKpi.recordListenerRestartFailure(error);
      });
      routeError(res, error);
    }
  });

  app.post("/v1/bridge/restart", async (_req, res) => {
    await context.recordUxKpi("bridge-restart-attempt", async () => {
      await context.uxKpi.recordBridgeRestartAttempt();
    });

    try {
      const result = await context.deps.services.restartBridge();
      context.deps.events.publish("bridge_restarted", { code: result.code });
      if (result.code !== 0) {
        await context.recordUxKpi("bridge-restart-failure", async () => {
          await context.uxKpi.recordBridgeRestartFailure(result.stderr || result.stdout || "non-zero exit");
        });
      }
      res.json({ result });
    } catch (error) {
      await context.recordUxKpi("bridge-restart-failure", async () => {
        await context.uxKpi.recordBridgeRestartFailure(error);
      });
      routeError(res, error);
    }
  });
}
