/**
 * A quick preview: a proposal's page, running the proposal's CLIENT code
 * built in the design tab, without a build being uploaded or served
 * (valbuild/home `docs/design-tab.md`).
 *
 * A full build of a proposal bundles the app for the server and the browser,
 * uploads it, and has the platform render every page before it is served --
 * minutes. Most of what the design tab changes is components and styles,
 * which the browser half alone shows. So the tab bundles the app in its
 * builder worker, and a service worker on the proposal's address hands the
 * page that bundle instead of the served one:
 *
 * 1. The tab sends the files (`/_app/app.js`, its chunks, the stylesheet and
 *    assets) to the page in the preview, over the canvas protocol.
 * 2. The page -- the bridge, which is the only thing at that origin the tab
 *    can talk to -- registers {@link QUICK_PREVIEW_SERVICE_WORKER_SOURCE}
 *    and stores the files in it (Cache Storage, so a worker the browser
 *    stopped still has them).
 * 3. The tab opens the page with `?val_quick=<id>`. The worker serves that
 *    document's `/_app/` requests from the files, and everything else from
 *    the network: the HTML is the last build's, rendered by its server, and
 *    the new code takes it over in the browser.
 *
 * What it cannot show, and the tab says so: anything on the server. Server
 * functions, API routes and loaders that run there are the last build's, as
 * is the page's first render and its `head`. A new dependency is not there
 * either. A build is still what decides, before Publish.
 *
 * Only a document opened with the parameter is served from the files, so a
 * visitor to the proposal's address -- even in the same browser -- is never
 * given them.
 */

/** The parameter a quick preview's page is opened with. */
export const QUICK_PREVIEW_PARAM = "val_quick";

/** Where Val's API serves the worker: under `/api/val`. */
export const QUICK_PREVIEW_SERVICE_WORKER_PATH = "/quick-preview-sw.js";

/** What the page sends the worker to store a preview's files. */
export const QUICK_PREVIEW_STORE_MESSAGE = "val-quick-preview-store";

/**
 * A preview's files, by their path under `/_app/`: `app.js`, `c-<hash>.js`,
 * `app.css`, `a/<hash>.png`. A binary file is base64.
 */
export type QuickPreviewFiles = Record<
  string,
  { body: string; contentType: string; base64?: true }
>;

/**
 * The worker, as the source it is served as: plain, and small, because it is
 * served as a file of its own (`demoServiceWorker.ts` is the same).
 */
export const QUICK_PREVIEW_SERVICE_WORKER_SOURCE = `
"use strict";
const PARAM = "${QUICK_PREVIEW_PARAM}";
const CACHE = "val-quick-preview";
const PREFIX = "/__val_quick/";
const INDEX = PREFIX + "index";
const KEEP = 4;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "${QUICK_PREVIEW_STORE_MESSAGE}") return;
  const port = event.ports && event.ports[0];
  event.waitUntil(
    store(data.id, data.files).then(
      () => port && port.postMessage({ ok: true }),
      (error) =>
        port &&
        port.postMessage({
          ok: false,
          message: String((error && error.message) || error),
        }),
    ),
  );
});

function keyOf(id, path) {
  return PREFIX + id + "/" + path;
}

async function store(id, files) {
  const cache = await caches.open(CACHE);
  for (const path of Object.keys(files)) {
    const file = files[path];
    const body = file.base64
      ? Uint8Array.from(atob(file.body), (c) => c.charCodeAt(0))
      : file.body;
    await cache.put(
      keyOf(id, path),
      new Response(body, {
        headers: { "Content-Type": file.contentType, "Cache-Control": "no-store" },
      }),
    );
  }
  // The newest few previews are kept; older ones are deleted.
  const index = await cache.match(INDEX);
  const ids = [id].concat(
    (index ? await index.json() : []).filter((other) => other !== id),
  );
  const dropped = ids.slice(KEEP);
  if (dropped.length > 0) {
    for (const request of await cache.keys()) {
      const path = new URL(request.url).pathname;
      if (dropped.some((old) => path.startsWith(PREFIX + old + "/"))) {
        await cache.delete(request);
      }
    }
  }
  await cache.put(INDEX, new Response(JSON.stringify(ids.slice(0, KEEP))));
}

/** Which preview a document is: by its id, or by the address it was opened at. */
const byClient = new Map();
async function previewOf(clientId) {
  if (!clientId) return null;
  if (byClient.has(clientId)) return byClient.get(clientId);
  const client = await self.clients.get(clientId);
  const id = client ? new URL(client.url).searchParams.get(PARAM) : null;
  byClient.set(clientId, id);
  return id;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    if (event.resultingClientId) {
      byClient.set(event.resultingClientId, url.searchParams.get(PARAM));
    }
    return;
  }
  if (!url.pathname.startsWith("/_app/")) return;
  event.respondWith(serve(event, url));
});

async function serve(event, url) {
  const id = await previewOf(event.clientId);
  if (id) {
    const hit = await caches.match(keyOf(id, url.pathname.slice(6)), {
      cacheName: CACHE,
    });
    if (hit) return hit;
  }
  return fetch(event.request);
}
`;

/** How long the worker is given to install and store a preview. */
const STORE_TIMEOUT_MS = 30_000;

/**
 * Store a preview's files in the worker, registering it first: what the
 * bridge does when the tab sends `quickPreview`. `swUrl` is the worker's
 * address on this origin (`/api/val` + {@link QUICK_PREVIEW_SERVICE_WORKER_PATH}).
 */
export async function storeQuickPreview(
  id: string,
  files: QuickPreviewFiles,
  options: { swUrl: string; container?: ServiceWorkerContainer },
): Promise<void> {
  const container =
    options.container ??
    (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  if (container === undefined) {
    throw new Error(
      "This browser cannot show a quick preview here: it has no service workers on this address (a private window, or one that is not https).",
    );
  }
  const registration = await container.register(options.swUrl, { scope: "/" });
  const worker = await activeWorker(registration);
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(
      () =>
        reject(
          new Error("The quick preview's worker did not store the files."),
        ),
      STORE_TIMEOUT_MS,
    );
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer);
      const answer = event.data;
      if (
        typeof answer === "object" &&
        answer !== null &&
        "ok" in answer &&
        answer.ok === true
      ) {
        resolve();
      } else {
        reject(
          new Error(
            typeof answer === "object" &&
              answer !== null &&
              "message" in answer &&
              typeof answer.message === "string"
              ? answer.message
              : "The quick preview's worker could not store the files.",
          ),
        );
      }
    };
    worker.postMessage({ type: QUICK_PREVIEW_STORE_MESSAGE, id, files }, [
      channel.port2,
    ]);
  });
}

/** The registration's worker, once it is active. */
function activeWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker> {
  const active = registration.active;
  if (active !== null) return Promise.resolve(active);
  const pending = registration.installing ?? registration.waiting;
  if (pending === null) {
    return Promise.reject(
      new Error("The quick preview's worker did not install."),
    );
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The quick preview's worker did not start.")),
      STORE_TIMEOUT_MS,
    );
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") {
        clearTimeout(timer);
        resolve(pending);
      } else if (pending.state === "redundant") {
        clearTimeout(timer);
        reject(new Error("The quick preview's worker was replaced."));
      }
    });
  });
}

/** The address of a page as a quick preview `id`. */
export function withQuickPreviewParam(url: string, id: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(QUICK_PREVIEW_PARAM, id);
  return parsed.toString();
}

/**
 * The one origin allowed to send this page a quick preview: the site's, where
 * the design tab is, as this page's own Val server says it (the proposals
 * list's `siteUrl`). `null` when it does not say.
 *
 * A quick preview is code that runs on this address, so the bridge takes one
 * only from its parent, and only when that parent is the site: a page that
 * framed this one could otherwise post a script into the worker and open
 * the frame on it.
 */
export async function quickPreviewSiteOrigin(
  api: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetchImpl(`${api.replace(/\/+$/, "")}/proposals-api`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("siteUrl" in body)) {
    return null;
  }
  const siteUrl = body.siteUrl;
  if (typeof siteUrl !== "string") return null;
  try {
    return new URL(siteUrl).origin;
  } catch {
    return null;
  }
}
