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
  router
    .post<{ 0: string }>(
      "/patches/*",
      express.json({
        type: "application/json",
        limit: "10mb",
      }),
      valServer.postPatches.bind(valServer)
    )
    .get("/patches/*", valServer.getPatches.bind(valServer));
  router.post("/commit", valServer.commit.bind(valServer));
  router.get("/enable", valServer.enable.bind(valServer));
  router.get("/disable", valServer.disable.bind(valServer));
  router.get("/tree/*", valServer.getTree.bind(valServer));
  router.get("/files/*", valServer.getFiles.bind(valServer));
  return router;
}
