import express, { RequestHandler, Router } from "express";
import { ProxyValServer, ProxyValServerOptions } from "./ProxyValServer";
import { LocalValServer, LocalValServerOptions } from "./LocalValServer";
import { ValServer } from "./ValServer";

export type RequestHandlerOptions =
  | ({
      /**
       * Mode of operation: proxy means that the Val server is hosted on a different domain than the application.
       * Typically this is used when the application is deployed (i.e. hosted somewhere like Vercel, Netlify, etc.)
       */
      mode: "proxy";
    } & ProxyValServerOptions)
  | ({
      /**
       * Mode of operation: locale means that the Val server locally and will update files directly.
       * Typically this is used when developing locally.
       */
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
