import { createUIRequestHandler } from "@valbuild/ui/server";
import type { ValServerGenericResult } from "@valbuild/shared/internal";
import {
  DEMO_SERVICE_WORKER_PATH,
  DEMO_SERVICE_WORKER_SOURCE,
} from "./demoServiceWorker";

/**
 * The server half of a Val demo: the Studio's own files and the demo's service
 * worker, and nothing else.
 *
 * In a demo the Studio runs Val's API in the visitor's tab
 * (`@valbuild/server/browser`, started by `<ValApp demo>`), so the app has no
 * content or patch endpoint at all -- nothing to authenticate, nothing to
 * abuse. What it still serves is the Studio's scripts and styles, which the
 * page loads from `/api/val/static/...`.
 *
 * Its own entry, `@valbuild/tanstack/demo`, rather than beside
 * `initValServer`: importing Val's server loads all of it -- the TypeScript
 * compiler included -- and a demo's server needs none of it.
 *
 * Mount it where `initValServer`'s handler would go:
 *
 * @example
 * // src/routes/api/val.$.ts
 * import { initValDemoServer } from "@valbuild/tanstack/demo";
 * const { valApiHandler } = initValDemoServer();
 * export const Route = createFileRoute("/api/val/$")({
 *   server: { handlers: { GET: ({ request }) => valApiHandler(request) } },
 * });
 */
export function initValDemoServer(): {
  valApiHandler: (req: Request) => Promise<Response>;
} {
  const route = "/api/val";
  const uiRequestHandler = createUIRequestHandler();
  const valApiHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.startsWith(route)
      ? url.pathname.slice(route.length)
      : null;
    if (path === DEMO_SERVICE_WORKER_PATH) {
      // The worker that relays uploads and files to the Studio's tab. See
      // `DEMO_SERVICE_WORKER_SOURCE`.
      return new Response(DEMO_SERVICE_WORKER_SOURCE, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Service-Worker-Allowed": "/",
          "Cache-Control": "no-cache",
        },
      });
    }
    if (path !== null && path.startsWith("/static")) {
      return toResponse(
        await uiRequestHandler(path.slice("/static".length), url.href),
      );
    }
    return toResponse({
      status: 404,
      json: {
        message:
          "Val's API is not served here: this is a demo, and the Studio runs it in the browser.",
      },
    });
  };
  return { valApiHandler };
}

function toResponse(valRes: ValServerGenericResult): Response {
  const headers = new Headers();
  const valResHeaders = ("headers" in valRes && valRes.headers) || {};
  for (const key in valResHeaders) {
    const value = valResHeaders[key];
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  if ("json" in valRes) {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(valRes.json), {
      headers,
      status: valRes.status,
    });
  }
  return new Response("body" in valRes ? valRes.body : null, {
    headers,
    status: valRes.status,
  });
}
