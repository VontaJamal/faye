import type { Express } from "express";

import { DEFAULT_ELEVENLABS_KEY_PATH, DEFAULT_TELEGRAM_TOKEN_PATH } from "../../paths";
import { ProfileCreateInputSchema, ProfilePatchInputSchema, SetupInputSchema } from "../../types";
import { writeSecret } from "../../utils";
import type { ApiRouteContext, RouteErrorHandler } from "../context";

export function registerProfileRoutes(app: Express, context: ApiRouteContext, routeError: RouteErrorHandler): void {
  app.get("/v1/profiles", (_req, res) => {
    try {
      const config = context.deps.store.getConfig();
      res.json({
        activeProfileId: config.activeProfileId,
        eventTransport: config.eventTransport,
        profiles: config.profiles
      });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.post("/v1/setup", async (req, res) => {
    await context.recordUxKpi("setup-attempt", async () => {
      await context.uxKpi.recordSetupAttempt();
    });

    try {
      const raw = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const setup = SetupInputSchema.parse({
        ...raw,
        apiKey: context.normalizeOptional(raw.apiKey),
        telegramToken: context.normalizeOptional(raw.telegramToken),
        telegramChatId: context.normalizeOptional(raw.telegramChatId)
      });

      if (setup.apiKey) {
        await writeSecret(DEFAULT_ELEVENLABS_KEY_PATH, setup.apiKey);
      }
      if (setup.telegramToken) {
        await writeSecret(DEFAULT_TELEGRAM_TOKEN_PATH, setup.telegramToken);
      }

      const profile = await context.deps.store.upsertSetupProfile({
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

      await context.deps.store.activateProfile(profile.id);
      await context.deps.store.setEventTransport(setup.eventTransport);
      const restart = await context.deps.services.restartListener();

      context.deps.events.publish("setup_saved", {
        profileId: profile.id,
        profileName: profile.name,
        listenerRestartCode: restart.code
      });

      await context.recordUxKpi("setup-success", async () => {
        await context.uxKpi.recordSetupSuccess();
      });

      res.status(201).json({ profile, listenerRestart: restart });
    } catch (error) {
      await context.recordUxKpi("setup-failure", async () => {
        await context.uxKpi.recordSetupFailure(error);
      });
      routeError(res, error);
    }
  });

  app.post("/v1/profiles", async (req, res) => {
    try {
      const profile = await context.deps.store.createProfile(ProfileCreateInputSchema.parse(req.body));
      context.deps.events.publish("profile_created", { id: profile.id, name: profile.name });
      res.status(201).json({ profile });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.patch("/v1/profiles/:id", async (req, res) => {
    try {
      const profileId = req.params.id;
      const profile = await context.deps.store.updateProfile(profileId, ProfilePatchInputSchema.parse(req.body));
      context.deps.events.publish("profile_updated", { id: profile.id, name: profile.name });
      res.json({ profile });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.delete("/v1/profiles/:id", async (req, res) => {
    try {
      const profileId = req.params.id;
      await context.deps.store.deleteProfile(profileId);
      context.deps.events.publish("profile_deleted", { id: profileId });
      res.status(204).send();
    } catch (error) {
      routeError(res, error);
    }
  });

  app.post("/v1/profiles/:id/activate", async (req, res) => {
    try {
      const profileId = req.params.id;
      const profile = await context.deps.store.activateProfile(profileId);
      const restart = await context.deps.services.restartListener();
      context.deps.events.publish("profile_activated", {
        id: profile.id,
        name: profile.name,
        listenerRestartCode: restart.code
      });
      res.json({ profile, listenerRestart: restart });
    } catch (error) {
      routeError(res, error);
    }
  });
}
