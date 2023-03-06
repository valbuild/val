import express, { RequestHandler, Router } from "express";
import { ValServer } from "./ValServer";
import { createRequestHandler as createUIRequestHandler } from "@valbuild/ui/server";

export function createRequestHandler(valServer: ValServer): RequestHandler {
  const router = Router();

  router.use("/static", createUIRequestHandler());
  router.get("/session", valServer.session.bind(valServer));
  router.get("/authorize", valServer.authorize.bind(valServer));
  router.get("/callback", valServer.callback.bind(valServer));
  router.get("/logout", valServer.logout.bind(valServer));
  router.get<{ 0: string }>("/ids/*", valServer.getIds.bind(valServer));
  router.patch<{ 0: string }>(
    "/ids/*",
    express.json({
      type: "application/json-patch+json",
    }),
    valServer.patchIds.bind(valServer)
  );
  return router;
}
