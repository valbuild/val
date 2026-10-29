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
 * 4. It takes it over by RENDERING it, not by hydrating it. Hydration keeps
 *    the markup the server sent wherever only an attribute differs -- React
 *    mends text, never a `className` -- so a change to classes and props,
 *    which is most of what the design tab changes, hydrated into the old
 *    page and showed nothing. The worker adds a script to the end of that
 *    document's `<body>` ({@link QUICK_PREVIEW_RENDER_SCRIPT}) that takes the
 *    server's markup out before the app's scripts run, so hydration finds
 *    nothing to keep and React renders the page with the new code.
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

/**
 * What a quick preview's document runs before the app's scripts: the
 * server's markup out of `<body>`, every script left where it is -- the
 * router's dehydrated state and the app's entry are among them. Hydration
 * then finds the body empty and React renders the page, with the new code's
 * attributes and classes, where it would have kept the old ones.
 */
export const QUICK_PREVIEW_RENDER_SCRIPT =
  "<script>(function(){var b=document.body;if(!b)return;" +
  "Array.prototype.slice.call(b.childNodes).forEach(function(n){" +
  'if(n.nodeName!=="SCRIPT")b.removeChild(n)})})()</script>';

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
 * The files of a quick preview: paths under `/_app/` with no way out of it,
 * each a string body and a type.
 */
export function isQuickPreviewFiles(
  value: unknown,
): value is QuickPreviewFiles {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).every(
    ([path, file]: [string, unknown]) =>
      /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(path) &&
      !path.includes("..") &&
      typeof file === "object" &&
      file !== null &&
      typeof (file as Record<string, unknown>).body === "string" &&
      typeof (file as Record<string, unknown>).contentType === "string",
  );
}

/**
 * The worker, as the source it is served as: plain, and small, because it is
 * served as a file of its own (`demoServiceWorker.ts` is the same).
 */
export const QUICK_PREVIEW_SERVICE_WORKER_SOURCE = `
"use strict";
const PARAM = "${QUICK_PREVIEW_PARAM}";
const RENDER = ${JSON.stringify(QUICK_PREVIEW_RENDER_SCRIPT)};
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
    const id = url.searchParams.get(PARAM);
    if (event.resultingClientId) byClient.set(event.resultingClientId, id);
    if (id) event.respondWith(rendered(event.request));
    return;
  }
  if (!url.pathname.startsWith("/_app/")) return;
  event.respondWith(serve(event, url));
});

/** A quick preview's document, with the script that has it rendered, not hydrated. */
async function rendered(request) {
  const response = await fetch(request);
  const type = response.headers.get("Content-Type") || "";
  if (!response.ok || !type.includes("text/html")) return response;
  const html = await response.text();
  const at = html.lastIndexOf("</body>");
  if (at === -1) return new Response(html, response);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return new Response(html.slice(0, at) + RENDER + html.slice(at), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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

/** The site's origin, as this page's server named it: asked once per page. */
let siteOriginOnce: Promise<string | null> | null = null;

/**
 * Whether `origin` may ask this page for what only the design tab should
 * have -- what is on it (`readPage`), or code to run (`quickPreview`): this
 * page's own origin (the Studio's canvas), or the site's, where the design
 * tab is ({@link quickPreviewSiteOrigin}). Asked of the server once, and
 * again only while it has not said.
 */
export async function isDesignTabOrigin(
  origin: string,
  options: { api: string; own: string; fetchImpl?: typeof fetch },
): Promise<boolean> {
  if (origin === options.own) return true;
  siteOriginOnce ??= quickPreviewSiteOrigin(
    options.api,
    options.fetchImpl,
  ).catch(() => null);
  const site = await siteOriginOnce;
  if (site === null) siteOriginOnce = null;
  return site !== null && site === origin;
}
