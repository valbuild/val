/*
 * This module is the entrypoint of @valbuild/ui/server until the package is
 * built with Vite. It is used only as a shim during local development, and is
 * actually not part of the build output meant for consumers.
 *
 * After building with Vite, this entrypoint is replaced by ./vite-server.tsx,
 * which is optimized for consumers.
 */

import {
  ValServerGenericResult,
  ValUIRequestHandler,
} from "@valbuild/shared/internal";
import fs from "fs";

type Vite = typeof import("vite");

export function createUIRequestHandler(): ValUIRequestHandler {
  if (typeof window === "undefined") {
    const vite = (async () => {
      const { fileURLToPath, URL: URL_noresolve } = await import("node:url");
      const { createServer } = await (import(
        /* @vite-ignore */ "v" + "ite"
      ) as Promise<Vite>);
      const vite = createServer({
        root: fileURLToPath(new URL_noresolve("..", import.meta.url)),
        configFile: fileURLToPath(
          new URL_noresolve("../vite.config.ts", import.meta.url)
        ),
        server: { middlewareMode: true }, // TODO: check if this is still necessary
      });
      return vite;
    })();
    return async (url): Promise<ValServerGenericResult> => {
      if (url === "/style.css") {
        const styleModule = await (await vite).ssrLoadModule("./src/index.css");
        const style = styleModule.default as string;
        return {
          status: 200,
          headers: {
            "Content-Type": "text/css",
          },
          body: style,
        };
      } else if (url.startsWith("/edit")) {
        const { URL: URL_noresolve } = await import("node:url");
        const html = (await vite).transformIndexHtml(
          url,
          fs.readFileSync(
            new URL_noresolve("../index.html", import.meta.url),
            "utf-8"
          )
        );
        return {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
          body: await html,
        };
      } else {
        try {
          const transformed = await (await vite).transformRequest(url);
          if (transformed) {
            const { code, etag } = transformed;
            return {
              status: 200,
              headers: {
                "Content-Type": "application/javascript",
                ...(etag ? { ETag: etag } : {}),
              },
              body: code,
            };
          } else {
            return {
              status: 404,
              json: {
                message: "Not found",
              },
            };
          }
        } catch (e) {
          if (e instanceof Error) {
            (await vite).ssrFixStacktrace(e);
            return {
              status: 500,
              json: {
                message: e.message,
                details: {
                  stack: e.stack,
                },
              },
            };
          }
          return {
            status: 500,
            json: {
              message: "Unknown error",
            },
          };
        }
      }
    };
  } else {
    throw Error(
      "Val: cannot construct UI in browser. Check if you are using the Val router correctly"
    );
  }
}
