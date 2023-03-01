import express, { RequestHandler, Router } from "express";
import { ProxyValServer, ProxyValServerOptions } from "./ProxyValServer";
import { LocalValServer, LocalValServerOptions } from "./LocalValServer";
import { ValServer } from "./ValServer";

export type RequestHandlerOptions =
  | ({
      mode: "proxy";
    } & ProxyValServerOptions)
  | ({
      mode: "local";
    } & LocalValServerOptions);

export function createRequestHandler(
  options: RequestHandlerOptions
): RequestHandler {
  const router = Router();
  let valServer: ValServer;
  if (options.mode === "proxy") {
    valServer = new ProxyValServer(options);
  } else {
    valServer = new LocalValServer(options);
  }
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
