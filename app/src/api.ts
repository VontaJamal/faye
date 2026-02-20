import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import { playAudioFile } from "./audio";
import { runDoctor } from "./doctor";
import type { EventHub } from "./events";
import { ElevenLabsClient } from "./elevenlabs";
import type { Logger } from "./logger";
import { DASHBOARD_PUBLIC_DIR, DEFAULT_ELEVENLABS_KEY_PATH, DEFAULT_TELEGRAM_TOKEN_PATH } from "./paths";
import { ServiceControl } from "./service-control";
import type { ConfigStore } from "./store";
import {
  LocalIngestEventSchema,
  ProfileCreateInputSchema,
  ProfilePatchInputSchema,
  SetupInputSchema,
  SpeakTestInputSchema
} from "./types";
import { writeSecret } from "./utils";

interface ApiDependencies {
  store: ConfigStore;
  events: EventHub;
  logger: Logger;
  elevenLabs: ElevenLabsClient;
  services: ServiceControl;
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

export function createApiServer(deps: ApiDependencies): express.Express {
  const app = express();

  const normalizeOptional = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
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
      res.json({
        ok: doctor.ok,
        doctor,
        services: {
          listener,
          dashboard,
          bridge
        }
      });
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

      res.status(201).json({ profile, listenerRestart: restart });
    } catch (error) {
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
    try {
      const parsed = SpeakTestInputSchema.parse(req.body ?? {});
      const played = await speakWithProfile(parsed.text, parsed.profileId);
      deps.events.publish("speak_test", { profileId: played.profileId, text: parsed.text });
      res.json({ ok: true, profileId: played.profileId });
    } catch (error) {
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
    try {
      const result = await deps.services.restartListener();
      deps.events.publish("listener_restarted", { code: result.code });
      res.json({ result });
    } catch (error) {
      routeError(deps.logger, res, error);
    }
  });

  app.post("/v1/bridge/restart", async (_req, res) => {
    try {
      const result = await deps.services.restartBridge();
      deps.events.publish("bridge_restarted", { code: result.code });
      res.json({ result });
    } catch (error) {
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
