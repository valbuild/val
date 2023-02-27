import type { RequestListener } from "node:http";
import express from "express";
import { createService, ServiceOptions } from "./Service";
import {
  createRequestHandler,
  RequestHandlerOptions,
} from "./createRequestHandler";

async function _createRequestListener(
  route: string,
  opts: ServiceOptions
): Promise<RequestListener> {
  const reqHandler = createRequestHandler(
    await initHandlerOptions(route, opts)
  );
  return express().use(route, reqHandler);
}

async function initHandlerOptions(
  route: string,
  opts: ServiceOptions
): Promise<RequestHandlerOptions> {
  const maybeApiKey = process.env.VAL_API_KEY;
  const maybeSessionKey = process.env.VAL_SESSION_KEY;
  if (maybeApiKey && maybeSessionKey) {
    const publicValApiRoute =
      process.env.VAL_PUBLIC_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : undefined);
    if (!publicValApiRoute) {
      throw new Error(
        "VAL_PUBLIC_ROUTE or VERCEL_URL env vars must be set when using VAL_API_KEY and VAL_SESSION_KEY"
      );
    }
    return {
      mode: "proxy",
      apiKey: maybeApiKey,
      sessionKey: maybeSessionKey,
      publicValApiRoute: `${publicValApiRoute}${route}`,
      valBuildUrl: process.env.VAL_BUILD_URL || "https://val.build",
    };
  } else if (maybeApiKey || maybeSessionKey) {
    throw new Error(
      "VAL_API_KEY and VAL_SESSION_KEY env vars must both be set when using VAL_API_KEY and VAL_SESSION_KEY"
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
  opts: ServiceOptions
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
