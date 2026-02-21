import type { Express } from "express";

import { LocalIngestEventSchema } from "../../types";
import type { ApiRouteContext, RouteErrorHandler } from "../context";

export function registerEventRoutes(app: Express, context: ApiRouteContext, routeError: RouteErrorHandler): void {
  app.get("/v1/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    for (const event of context.deps.events.recentEvents()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const unsubscribe = context.deps.events.subscribe((event) => {
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

  app.post("/v1/internal/listener-event", (req, res) => {
    try {
      const token = req.header("x-faye-local-token") ?? "";
      if (token !== context.deps.store.getLocalEventToken()) {
        res.status(401).json({ error: "E_UNAUTHORIZED" });
        return;
      }

      const event = LocalIngestEventSchema.parse(req.body ?? {});
      context.deps.events.publish(event.type, event.payload);
      res.status(202).json({ accepted: true });
    } catch (error) {
      routeError(res, error);
    }
  });
}
