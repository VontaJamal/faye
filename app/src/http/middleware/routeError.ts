import type { Response } from "express";
import { ZodError } from "zod";

import type { Logger } from "../../logger";

export function routeError(logger: Logger, res: Response, error: unknown): void {
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
