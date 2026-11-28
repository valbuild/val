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

/** The scope of the installed app: the Studio's route. */
export const STUDIO_APP_SCOPE = "/val";

/**
 * Where the installed app starts: the Studio's content view, which both
 * framework bindings serve under `/val/`. Not `/val` itself, because the
 * worker's scope is {@link STUDIO_WORKER_SCOPE} and a page is controlled by a
 * worker only when it STARTS inside that scope.
 */
export const STUDIO_START_URL = "/val/~";

/**
 * The worker's scope: `/val/`, with the slash. A scope is a plain prefix, so
 * `/val` would also take `/val-preview` -- the route the Components view
 * renders each component through -- away from the quick preview's worker,
 * which serves those frames their staged code (`quickPreview.ts`).
 */
export const STUDIO_WORKER_SCOPE = "/val/";

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
 * The project's own mark as the app's icon: `s.settings()`'s `theme.logo`,
 * when it can be one (the Studio decides, in `studioAppIconOf`).
 *
 * It reaches the manifest as query parameters on the manifest's URL rather
 * than by the server reading the settings module: the Studio already has the
 * logo resolved, and the manifest is then about the same logo the rail shows.
 */
export type StudioAppIcon = {
  /** Where the browser fetches it: a path on this origin, or `https:`. */
  src: string;
  /** `image/png`, `image/jpeg`, `image/webp` or `image/svg+xml`. */
  type: string;
  /** `"512x512"`, or `"any"` for an SVG. */
  sizes: string;
};

const ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** The manifest's URL, carrying the project's icon when it has one. */
export function studioManifestUrl(
  apiRoute: string,
  icon: StudioAppIcon | null,
): string {
  const base = `${apiRoute}${STUDIO_MANIFEST_PATH}`;
  if (icon === null) return base;
  const params = new URLSearchParams({
    icon: icon.src,
    type: icon.type,
    sizes: icon.sizes,
  });
  return `${base}?${params.toString()}`;
}

/**
 * The icon a manifest URL carries, or `null` when it carries none or one that
 * is not an image URL a manifest may name: anyone can write a query string.
 */
export function studioAppIconFromQuery(
  params: URLSearchParams,
): StudioAppIcon | null {
  const src = params.get("icon");
  const type = params.get("type");
  const sizes = params.get("sizes");
  if (src === null || type === null || sizes === null) return null;
  const sameOrigin = src.startsWith("/") && !src.startsWith("//");
  if (!sameOrigin && !src.startsWith("https://")) return null;
  if (!ICON_TYPES.includes(type)) return null;
  if (!/^(\d{1,5}x\d{1,5}|any)$/.test(sizes)) return null;
  return { src, type, sizes };
}

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

/**
 * The manifest, for a Studio served at `host` with its API at `apiRoute`.
 *
 * `id` is the scope, so reinstalling (or a new Val version) is the same app
 * rather than a second icon.
 *
 * With the project's icon, that icon ALONE: a browser picks whichever listed
 * icon is nearest the size it wants, so listing Val's beside it would put
 * Val's on the home screen about as often as the project's.
 */
export function studioManifest(
  host: string,
  apiRoute: string,
  icon: StudioAppIcon | null = null,
): StudioManifest {
  return {
    id: STUDIO_APP_SCOPE,
    name: `Val · ${host}`,
    short_name: "Val",
    description: `Edit the content of ${host}`,
    start_url: STUDIO_START_URL,
    scope: STUDIO_APP_SCOPE,
    display: "standalone",
    background_color: STUDIO_APP_BACKGROUND,
    theme_color: STUDIO_APP_BACKGROUND,
    icons: icon
      ? [{ src: icon.src, sizes: icon.sizes, type: icon.type }]
      : [
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
          // The mark sits well inside the circle a launcher crops a maskable
          // icon to, so the same file serves both purposes.
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
 *    (the API route read from the worker's own address, and nothing else
 *    that merely contains `/static/`) is what the server already marks
 *    `immutable`, and only a response that says so is stored. A new Val
 *    version is a new path, so nothing is ever stale; storing a file of the
 *    newest version drops older versions' files, and a file of an older one
 *    drops nothing. A path without a version (a dev server's) is never
 *    stored. Cache Storage is best effort throughout.
 * 2. **The Studio's document, network first.** Stored on every successful
 *    load and served only when the FETCH fails (never when storing does), so
 *    an installed Studio opened offline starts and shows its own error with
 *    a way to retry, instead of the browser's.
 *
 * CONTENT IS NEVER CACHED HERE. Sources, patches, schemas and the head go
 * through the Studio's client and its stores, which assume the server's
 * answer is current; a worker answering for them would be a second, older
 * copy of the content that nothing invalidates.
 *
 * Registered only when the Studio runs as the installed app (see
 * `startStudioApp`): a tab's browser cache already keeps the immutable files,
 * and a worker controlling a tab hides its requests from test harnesses.
 *
 * Not registered in a demo: the demo's own worker has scope `/`, and a worker
 * scoped to `/val` would take the Studio's page from it, along with the
 * uploads and files it relays.
 */
export const STUDIO_SERVICE_WORKER_SOURCE = `
"use strict";
const STATIC_CACHE = "val-studio-static";
const PAGE_CACHE = "val-studio-page";
const PAGE_KEY = "${STUDIO_START_URL}";
// Served at <api route>${STUDIO_SERVICE_WORKER_PATH}, so the API route is
// read from the worker's own address rather than assumed.
const STATIC_PREFIX =
  self.location.pathname.slice(0, -"${STUDIO_SERVICE_WORKER_PATH}".length) +
  "/static/";
const VERSION = /^(\\d+)\\.(\\d+)\\.(\\d+)[^/]*$/;

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
  const version = versionOf(url.pathname);
  if (version) {
    event.respondWith(staticFile(request, version));
  }
});

/** The Studio version a path is a file of, or null when it is not one. */
function versionOf(pathname) {
  if (!pathname.startsWith(STATIC_PREFIX)) return null;
  const segment = pathname.slice(STATIC_PREFIX.length).split("/")[0];
  return VERSION.test(segment) ? segment : null;
}

function newer(a, b) {
  const x = a.match(VERSION);
  const y = b.match(VERSION);
  for (let i = 1; i <= 3; i++) {
    if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]);
  }
  return false;
}

// Storage is best effort: a full disk or a refused cache must never cost a
// response the network delivered.
async function staticFile(request, version) {
  try {
    const hit = await (await caches.open(STATIC_CACHE)).match(request);
    if (hit) return hit;
  } catch (error) {
    // read past the cache
  }
  const response = await fetch(request);
  const cacheControl = response.headers.get("Cache-Control") || "";
  if (response.ok && cacheControl.includes("immutable")) {
    try {
      await store(request, response.clone(), version);
    } catch (error) {
      // served uncached
    }
  }
  return response;
}

/**
 * Stored, and older versions dropped -- but only by the newest version. A tab
 * still on an older Studio fetching one of its files must not evict the new
 * one's, so a file of an older version is stored and drops nothing.
 */
async function store(request, response, version) {
  const cache = await caches.open(STATIC_CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  const versions = keys
    .map((key) => versionOf(new URL(key.url).pathname))
    .filter((other) => other !== null);
  if (versions.some((other) => newer(other, version))) return;
  for (const key of keys) {
    const other = versionOf(new URL(key.url).pathname);
    if (other === null || newer(version, other)) await cache.delete(key);
  }
}

async function page(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    // Offline: the last Studio page, if there is one.
    try {
      const hit = await (await caches.open(PAGE_CACHE)).match(PAGE_KEY);
      if (hit) return hit;
    } catch (ignored) {
      // no cache to fall back on
    }
    throw error;
  }
  const type = response.headers.get("Content-Type") || "";
  if (response.ok && !response.redirected && type.includes("text/html")) {
    try {
      await (await caches.open(PAGE_CACHE)).put(PAGE_KEY, response.clone());
    } catch (ignored) {
      // served uncached
    }
  }
  return response;
}
`;
