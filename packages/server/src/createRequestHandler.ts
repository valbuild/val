import { RequestHandler } from "express";
import { ProxyValServer, ProxyValServerOptions } from "./ProxyValServer";
import { LocalValServer, LocalValServerOptions } from "./LocalValServer";

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
  if (options.mode === "proxy") {
    return new ProxyValServer(options).createRouter();
  } else {
    return new LocalValServer(options).createRouter();
  }
}
