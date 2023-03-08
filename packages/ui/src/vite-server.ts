import type { RequestHandler } from "express";

export function createRequestHandler(): RequestHandler {
  return (_req, _res, next) => {
    // NO-OP
    next();
  };
}
