import type { RequestListener } from "node:http";
import express from "express";
import { createService, ServiceOptions } from "./Service";
import { ValModuleResolver } from "./ValModuleResolver";
import { createRequestHandler } from "./ValServer";

async function _createDevRequestListener(
  route: string,
  opts: ServiceOptions
): Promise<RequestListener> {
  const resolver = new ValModuleResolver(process.cwd());
  const service = await createService(resolver, opts);
  const reqHandler = createRequestHandler(service);
  return express().use(route, reqHandler);
}

export function createDevRequestListener(
  route: string,
  opts: ServiceOptions
): RequestListener {
  const handler = _createDevRequestListener(route, opts);
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
