import type { Express } from "express";

import { writeConversationStopRequest } from "../../utils";
import type { ApiRouteContext, RouteErrorHandler } from "../context";

export function registerConversationRoutes(
  app: Express,
  context: ApiRouteContext,
  routeError: RouteErrorHandler
): void {
  app.get("/v1/conversation/active", (_req, res) => {
    try {
      const session = context.conversation.getActiveSessionSnapshot();
      res.json({ session });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get("/v1/conversation/:sessionId/context", (req, res) => {
    try {
      const sessionId = req.params.sessionId.trim();
      if (!sessionId) {
        res.status(400).json({ error: "E_CONVERSATION_ID_REQUIRED" });
        return;
      }

      const ctx = context.conversation.getContext(sessionId, {
        limit: context.parseContextLimit(req.query.limit),
        includePending: context.parseIncludePending(req.query.includePending)
      });

      if (!ctx) {
        res.status(404).json({ error: "E_CONVERSATION_NOT_FOUND" });
        return;
      }

      res.json({ context: ctx });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get("/v1/conversation/:sessionId", (req, res) => {
    try {
      const sessionId = req.params.sessionId.trim();
      if (!sessionId) {
        res.status(400).json({ error: "E_CONVERSATION_ID_REQUIRED" });
        return;
      }

      const session = context.conversation.getSessionSnapshot(sessionId);
      if (!session) {
        res.status(404).json({ error: "E_CONVERSATION_NOT_FOUND" });
        return;
      }

      res.json({ session });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.post("/v1/conversation/:sessionId/end", async (req, res) => {
    try {
      const sessionId = req.params.sessionId.trim();
      if (!sessionId) {
        res.status(400).json({ error: "E_CONVERSATION_ID_REQUIRED" });
        return;
      }

      const requestedReason = context.normalizeReason((req.body ?? {})["reason"], "manual_terminated");
      const endReason = "external_stop";
      const session = context.conversation.endSession(sessionId, endReason);
      if (!session) {
        res.status(404).json({ error: "E_CONVERSATION_NOT_FOUND" });
        return;
      }

      await writeConversationStopRequest(context.stopRequestPath, {
        sessionId,
        reason: requestedReason,
        requestedAt: new Date().toISOString()
      });

      context.deps.events.publish("conversation_ended", {
        session_id: sessionId,
        reason: endReason,
        requested_reason: requestedReason
      });

      res.json({ session, endReason, requestedReason });
    } catch (error) {
      routeError(res, error);
    }
  });
}
