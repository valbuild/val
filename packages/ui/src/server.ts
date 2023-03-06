/*
 * This module is the entrypoint of @valbuild/ui/server until the package is
 * built with Vite. It is used only as a shim during local development, and is
 * actually not part of the build output meant for consumers.
 *
 * After building with Vite, this entrypoint is replaced by ./vite-server.tsx,
 * which is optimized for consumers.
 */

import type { RequestHandler } from "express";

export function createRequestHandler(): RequestHandler {
  if (typeof window === "undefined") {
    const vite = (async () => {
      const { fileURLToPath, URL: URL_noresolve } = await import("node:url");
      const { createServer } = await import(/* @vite-ignore */ "v" + "ite");
      const vite = await createServer({
        root: fileURLToPath(new URL_noresolve("..", import.meta.url)),
        configFile: fileURLToPath(
          new URL_noresolve("../vite.config.ts", import.meta.url)
        ),
        server: { middlewareMode: true },
      });

      return vite;
    })();
    return async (req, res, next) => {
      if (req.url === "/style.css") {
        const styleModule = await (await vite).ssrLoadModule("./src/index.css");
        const style = styleModule.default as string;
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/css");
        return res.end(style);
      } else {
        return next();
      }
    };
  } else {
    throw Error("Cannot get middleware in browser");
  }
}
