/*
 * This module is the entrypoint of @valbuild/ui/server until the package is
 * built with Vite. It is used only as a shim during local development, and is
 * actually not part of the build output meant for consumers.
 *
 * After building with Vite, this entrypoint is replaced by ./vite-server.tsx,
 * which is optimized for consumers.
 */

import { ValUIRequestHandler } from "@valbuild/shared/internal";
import { getServerMimeType } from "../spa/serverMimeType";
import { VAL_APP_PATH, VAL_CSS_PATH } from "./constants";
import { VERSION } from ".";
import { devServerFetch } from "./devServerFetch";

export function createUIRequestHandler(): ValUIRequestHandler {
  return async (path) => {
    const acceptType = getServerMimeType(path);
    let devPath = path;
    if (path === `${VERSION ? `/${VERSION}` : ""}${VAL_APP_PATH}`) {
      devPath = "/spa/main.jsx";
    } else if (path === `${VERSION ? `/${VERSION}` : ""}${VAL_CSS_PATH}`) {
      devPath = "/spa/index.css";
    }
    // TODO: believe we can clean up and remove: api/val/static
    // Retried rather than fetched once: a dropped connection here serves the
    // Studio without its JavaScript, and the failure then surfaces wherever the
    // page is being waited on instead of here. See `devServerFetch`.
    const res = await devServerFetch(
      `http://localhost:5173/api/val/static${devPath}`,
      acceptType ? { Accept: acceptType } : {},
    );
    const headersObj: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    return {
      status: res.status,
      headers: headersObj,
      body: res.body,
    } as Awaited<ReturnType<ValUIRequestHandler>>;
  };
}
