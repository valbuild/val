/**
 * Where the demo's service worker is served, under the API route.
 *
 * `Service-Worker-Allowed: /` on the response is what lets a script at this
 * path control the whole origin: the Studio at `/val` AND the site's pages in
 * its canvas, whose `<img>` and `<video>` ask for the files this relays.
 */
export const DEMO_SERVICE_WORKER_PATH = "/demo-sw.js";

/** The message the worker sends a Studio tab, and what the tab answers. */
export const DEMO_RELAY_MESSAGE = "val-demo-request";

/**
 * What a page sends the worker to be taken under its control now.
 *
 * `clients.claim()` runs when the worker activates, which is once. A page
 * loaded after that with a hard reload (Shift+Reload) is deliberately NOT
 * controlled by an active worker, and nothing would claim it -- so the page
 * asks.
 */
export const DEMO_CLAIM_MESSAGE = "val-demo-claim";

/**
 * The demo's service worker, as the source it is served as.
 *
 * In a demo, Val's server runs in the Studio's tab (`@valbuild/server/browser`)
 * and the Studio's client talks to it directly. Two kinds of request cannot go
 * that way, because the browser makes them itself rather than the client:
 *
 * - an upload, which is an `XMLHttpRequest` to `/api/val/upload/...`
 *   (`createValSystem`, for its progress events);
 * - an unpublished file, which is an `<img>` or `<video>` pointing at
 *   `/api/val/files/...?patch_id=...` -- in the Studio and in the site's pages
 *   in the canvas.
 *
 * This worker catches exactly those two prefixes and hands each request to a
 * Studio tab over `postMessage`, where the same in-tab server answers it. So
 * nothing leaves the browser, and the routes that answer are the real ones --
 * the upload, the `Range` request a video seeks with, the draft HLS playlist
 * rewrite.
 *
 * WHICH tab: a demo's edits are in one tab's memory, and two demo tabs are two
 * demos. A request from a Studio page goes to that page. A request from
 * anywhere else -- the site in a canvas frame -- goes to each Studio tab in
 * turn, and the first that does not answer 404 has it: patch ids are unique,
 * so only the tab that made a file can serve it.
 *
 * Plain source rather than compiled code, because it is served as a file of
 * its own and must not depend on anything a bundler would have provided. Kept
 * small for the same reason; `demoServiceWorker.test.ts` parses it and drives
 * its fetch handler.
 */
export const DEMO_SERVICE_WORKER_SOURCE = `
"use strict";
const RELAYED = ["/api/val/upload/", "/api/val/files/"];
const TIMEOUT_MS = 60000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "${DEMO_CLAIM_MESSAGE}") {
    event.waitUntil(self.clients.claim());
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!RELAYED.some((prefix) => url.pathname.startsWith(prefix))) return;
  event.respondWith(relay(event.request, event.clientId));
});

function isStudio(client) {
  const path = new URL(client.url).pathname;
  return path === "/val" || path.startsWith("/val/");
}

async function studiosFor(clientId) {
  const own = clientId ? await self.clients.get(clientId) : undefined;
  if (own && isStudio(own)) return [own];
  const all = await self.clients.matchAll({ type: "window" });
  return all.filter(isStudio);
}

function ask(client, message, transfer) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    client.postMessage(message, [channel.port2, ...transfer]);
  });
}

function unavailable(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function relay(request, clientId) {
  const studios = await studiosFor(clientId);
  if (studios.length === 0) {
    return unavailable(
      503,
      "The demo's files live in the Studio's tab, and it is not open.",
    );
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : null;
  let last = null;
  for (const studio of studios) {
    // A body can be transferred once, and transferring it detaches it, so
    // every tab is given a copy and the original is never sent.
    const copy = body ? body.slice(0) : null;
    const answer = await ask(
      studio,
      {
        type: "${DEMO_RELAY_MESSAGE}",
        url: request.url,
        method: request.method,
        headers: [...request.headers],
        body: copy,
      },
      copy ? [copy] : [],
    );
    if (answer === null) continue;
    last = answer;
    if (answer.status !== 404) break;
  }
  if (last === null) {
    return unavailable(504, "The Studio's tab did not answer in time.");
  }
  return new Response(last.body, { status: last.status, headers: last.headers });
}
`;
