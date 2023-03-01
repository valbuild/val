import type { RequestListener } from "node:http";
import express from "express";
import { createService, ServiceOptions } from "./Service";
import {
  createRequestHandler,
  RequestHandlerOptions,
} from "./createRequestHandler";

type Opts = ValServerOverrides & ServiceOptions;

type ValServerOverrides = Partial<{
  /**
   * The public url this application.
   *
   * This value can also be set using the VAL_PUBLIC_URL env var.
   * If this is not set, it will default to the value of the VERCEL_URL env var.
   *
   * @example "https://foo.vercel.app"
   */
  publicValUrl: string;
  /**
   * Override the Val API key.
   *
   * Typically this is set using VAL_API_KEY env var.
   *
   * NOTE: if this is set you must also set valSecret or VAL_SECRET env var.
   */
  apiKey: string;
  /**
   * Override the Val session key.
   *
   * This can be any randomly generated string.
   * It will be used for authentication between the frontend and val api
   * endpoints in this app.
   *
   * Typically this is set using VAL_SECRET env var.
   *
   * NOTE: if this is set you must also set apiKey or VAL_API_KEY env var.
   */
  valSecret: string;
  /**
   * Override the default the mode of operation.
   *
   * Typically this should not be set.
   *
   * "local" means that changes will be written to the local filesystem,
   * which is what you want when developing locally.
   *
   * "proxy" means that changes will proxied to https://app.val.build
   * and eventually be committed in the Git repository.
   *
   * It will automatically be "proxy" if both VAL_API_KEY env var (or the apiKey property) and VAL_SECRET env var (or the valSecret property)
   * is set.
   *
   * If both is missing, it will default to "local".
   */
  mode: "proxy" | "local";
  /**
   * The base url of Val.
   *
   * Typically this should not be set.
   *
   * Can also be overridden using the VAL_BUILD_URL env var.
   *
   * @example "https://app.val.build"
   */
  valBuildUrl: string;
}>;

async function _createRequestListener(
  route: string,
  opts: Opts
): Promise<RequestListener> {
  const handlerOpts = await initHandlerOptions(route, opts);
  if (handlerOpts.mode === "local" && process.env.NODE_ENV === "production") {
    throw new Error(
      "Val server is running in local mode in production. This is not allowed."
    );
  }
  const reqHandler = createRequestHandler(handlerOpts);
  return express().use(route, reqHandler);
}

async function initHandlerOptions(
  route: string,
  opts: ValServerOverrides & ServiceOptions
): Promise<RequestHandlerOptions> {
  const maybeApiKey = opts.apiKey || process.env.VAL_API_KEY;
  const maybeSessionKey = opts.valSecret || process.env.VAL_SECRET;
  if (
    opts.mode === "proxy" ||
    (opts.mode === undefined && maybeApiKey && maybeSessionKey)
  ) {
    if (!maybeApiKey || !maybeSessionKey) {
      throw new Error(
        "VAL_API_KEY and VAL_SECRET env vars must both be set in proxy mode"
      );
    }
    const publicValApiRoute =
      opts.publicValUrl ||
      process.env.VAL_PUBLIC_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : undefined);
    if (!publicValApiRoute) {
      throw new Error(
        "VAL_PUBLIC_ROUTE or VERCEL_URL env vars must be set when using VAL_API_KEY and VAL_SECRET"
      );
    }
    return {
      mode: "proxy",
      apiKey: maybeApiKey,
      sessionKey: maybeSessionKey,
      publicValApiRoute: `${publicValApiRoute}${route}`,
      valBuildUrl:
        opts.valBuildUrl ||
        process.env.VAL_BUILD_URL ||
        "https://app.val.build",
    };
  } else if (opts.mode === undefined && (maybeApiKey || maybeSessionKey)) {
    throw new Error(
      "VAL_API_KEY and VAL_SECRET env vars must both be set when using VAL_API_KEY and VAL_SECRET"
    );
  } else {
    const service = await createService(process.cwd(), opts);
    return {
      mode: "local",
      service,
    };
  }
}

// TODO: rename to createValApiHandlers?
export function createRequestListener(
  route: string,
  opts: Opts
): RequestListener {
  const handler = _createRequestListener(route, opts);
  return async (req, res) => {
    try {
      return (await handler)(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.write(e instanceof Error ? e.message : "Unknown error");
      res.end();
      return;
    }
  };
}
