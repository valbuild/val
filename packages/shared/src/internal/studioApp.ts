/**
 * The Studio as an app: what lets an editor put `/val` on their home screen
 * and open it without the browser's address bar, and what makes it open fast.
 *
 * Three files, all served by Val's API route (`ValRouterCore`), so a project
 * gets them by upgrading and writes nothing:
 *
 * - the web app manifest ({@link STUDIO_MANIFEST_PATH}), which names the app,
 *   says it starts at `/val`, stays inside `/val` and has no browser chrome;
 * - its icons ({@link STUDIO_ICON_PATHS}): PNG, because iOS takes nothing else
 *   for `apple-touch-icon`;
 * - a service worker ({@link STUDIO_SERVICE_WORKER_PATH}) scoped to `/val`.
 *
 * The Studio links the manifest and registers the worker itself when it starts
 * (`studioApp.ts` in `@valbuild/ui`), which is what keeps this the same for
 * every framework binding.
 *
 * ONE APP PER SITE, not one Val app. The Studio lives on the customer's own
 * origin, and so does its session cookie, so an installed Studio is that
 * site's Studio. The manifest is named after the host for that reason: two
 * projects on one phone are two icons that can be told apart.
 */

/** The scope and start of the installed app: the Studio's route. */
export const STUDIO_APP_SCOPE = "/val";

/** Where Val's API serves the manifest: under `/api/val`. */
export const STUDIO_MANIFEST_PATH = "/manifest.webmanifest";

/** Where Val's API serves the Studio's service worker: under `/api/val`. */
export const STUDIO_SERVICE_WORKER_PATH = "/studio-sw.js";

/** The icons, by size, under `/api/val`. */
export const STUDIO_ICON_PATHS: Record<180 | 192 | 512, string> = {
  180: "/icons/val-180.png",
  192: "/icons/val-192.png",
  512: "/icons/val-512.png",
};

/**
 * The colour behind the app while it starts, and of the status bar above it:
 * `--bg-canvas`, dark, which is what the Studio's loading screen draws (see
 * `fallbackColors.ts` in the framework packages). A copy, for the same reason
 * those are: it is used before the stylesheet that defines it exists.
 */
export const STUDIO_APP_BACKGROUND = "#08080a";

/**
 * The manifest, for a Studio served at `host` with its API at `apiRoute`.
 *
 * `id` is the scope, so reinstalling (or a new Val version) is the same app
 * rather than a second icon.
 */
export type StudioManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: "maskable" }[];
};

export function studioManifest(host: string, apiRoute: string): StudioManifest {
  return {
    id: STUDIO_APP_SCOPE,
    name: `Val · ${host}`,
    short_name: "Val",
    description: `Edit the content of ${host}`,
    start_url: STUDIO_APP_SCOPE,
    scope: STUDIO_APP_SCOPE,
    display: "standalone",
    background_color: STUDIO_APP_BACKGROUND,
    theme_color: STUDIO_APP_BACKGROUND,
    icons: [
      {
        src: `${apiRoute}${STUDIO_ICON_PATHS[192]}`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: `${apiRoute}${STUDIO_ICON_PATHS[512]}`,
        sizes: "512x512",
        type: "image/png",
      },
      // The mark sits well inside the circle a launcher crops a maskable icon
      // to, so the same file serves both purposes.
      {
        src: `${apiRoute}${STUDIO_ICON_PATHS[512]}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

/**
 * The Studio's service worker, as the source it is served as: plain, and
 * small, because it is a file of its own (as `demoServiceWorker.ts` and
 * `quickPreview.ts` are).
 *
 * It does two things, and deliberately nothing else:
 *
 * 1. **The Studio's own files, cache first.** `/api/val/static/<version>/...`
 *    is what the server already marks `immutable`, and only a response that
 *    says so is stored. A new Val version is a new path, so nothing is ever
 *    stale; when a file of a new version is stored, every other version's is
 *    deleted. A path without a version (a dev server's) is never stored.
 * 2. **The `/val` document, network first.** Stored on every successful load
 *    and served only when the network fails, so an installed Studio opened
 *    offline starts and shows its own error with a way to retry, instead of
 *    the browser's.
 *
 * CONTENT IS NEVER CACHED HERE. Sources, patches, schemas and the head go
 * through the Studio's client and its stores, which assume the server's
 * answer is current; a worker answering for them would be a second, older
 * copy of the content that nothing invalidates.
 *
 * Not registered in a demo: the demo's own worker has scope `/`, and a worker
 * scoped to `/val` would take the Studio's page from it, along with the
 * uploads and files it relays.
 */
export const STUDIO_SERVICE_WORKER_SOURCE = `
"use strict";
const STATIC_CACHE = "val-studio-static";
const PAGE_CACHE = "val-studio-page";
const STATIC = /\\/static\\/(\\d+\\.\\d+\\.\\d+[^/]*)\\//;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }
  const version = url.pathname.match(STATIC);
  if (version) {
    event.respondWith(staticFile(request, version[1]));
  }
});

async function staticFile(request, version) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  const cacheControl = response.headers.get("Cache-Control") || "";
  if (response.ok && cacheControl.includes("immutable")) {
    await cache.put(request, response.clone());
    for (const key of await cache.keys()) {
      const other = new URL(key.url).pathname.match(STATIC);
      if (!other || other[1] !== version) await cache.delete(key);
    }
  }
  return response;
}

async function page(request) {
  try {
    const response = await fetch(request);
    const type = response.headers.get("Content-Type") || "";
    if (response.ok && !response.redirected && type.includes("text/html")) {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put("${STUDIO_APP_SCOPE}", response.clone());
    }
    return response;
  } catch (error) {
    const cache = await caches.open(PAGE_CACHE);
    const hit = await cache.match("${STUDIO_APP_SCOPE}");
    if (hit) return hit;
    throw error;
  }
}
`;
