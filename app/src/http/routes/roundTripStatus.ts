import type { Express } from "express";

import type { RoundTripCoordinator, RoundTripSessionStatus } from "../../roundTripCoordinator";

export interface RoundTripStatusResponse {
  sessionId: string;
  pending: boolean;
  state: RoundTripSessionStatus["state"];
  retryCount: number;
  updatedAt: string | null;
}

interface RegisterRoundTripStatusDeps {
  roundTrip: RoundTripCoordinator;
}

export function registerRoundTripStatusRoute(
  app: Express,
  deps: RegisterRoundTripStatusDeps
): void {
  app.get("/v1/roundtrip/:sessionId/status", (req, res) => {
    const sessionId = req.params.sessionId.trim();
    if (!sessionId) {
      res.status(400).json({ error: "E_CONVERSATION_ID_REQUIRED" });
      return;
    }

    const status = deps.roundTrip.getSessionStatus(sessionId);
    const response: RoundTripStatusResponse = {
      sessionId: status.sessionId,
      pending: status.pending,
      state: status.state,
      retryCount: status.retryCount,
      updatedAt: status.updatedAt
    };

    res.json(response);
  });
}
