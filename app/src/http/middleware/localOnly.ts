import type { NextFunction, Request, Response } from "express";

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

export function localOnly(req: Request, res: Response, next: NextFunction): void {
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
