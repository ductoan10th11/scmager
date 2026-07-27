import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const correlationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const candidate = req.header("x-correlation-id");
  const traceId =
    candidate && /^[A-Za-z0-9._-]{8,128}$/.test(candidate)
      ? candidate
      : randomUUID();
  (req as any).traceId = traceId;
  res.setHeader("x-correlation-id", traceId);
  next();
};
