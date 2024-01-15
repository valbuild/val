/*
 * This module is the entrypoint of @valbuild/ui/server until the package is
 * built with Vite. It is used only as a shim during local development, and is
 * actually not part of the build output meant for consumers.
 *
 * After building with Vite, this entrypoint is replaced by ./vite-server.tsx,
 * which is optimized for consumers.
 */

import { ValUIRequestHandler } from "@valbuild/shared/internal";
import { getServerMimeType } from "./serverMimeType";

export function createUIRequestHandler(): ValUIRequestHandler {
  return async (path) => {
    const acceptType = getServerMimeType(path);
    let devPath = path;
    if (path === "/app") {
      devPath = "/src/main.jsx";
    }
    // TODO: believe we can clean up and remove: api/val/static
    const res = await fetch(`http://localhost:5173/api/val/static${devPath}`, {
      headers: acceptType
        ? {
            Accept: acceptType,
          }
        : {},
    }).catch((err) => {
      console.error(
        "Could not fetch from dev server. Make sure you are running npm run dev in the package/ui directory."
      );
      throw err;
    });

    return {
      status: res.status,
      headers: res.headers
        ? Object.fromEntries(Array.from(res.headers.entries()))
        : {},
      body: res.body,
    } as Awaited<ReturnType<ValUIRequestHandler>>;
  };
}
