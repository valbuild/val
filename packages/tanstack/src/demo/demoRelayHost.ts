import {
  DEMO_CLAIM_MESSAGE,
  DEMO_RELAY_MESSAGE,
  DEMO_SERVICE_WORKER_PATH,
} from "./demoServiceWorker";

type InTabFetch = (input: string, init: RequestInit) => Promise<Response>;

/** A request the demo's service worker hands this tab. */
type RelayRequest = {
  type: typeof DEMO_RELAY_MESSAGE;
  url: string;
  method: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
};

function isHeaderList(value: unknown): value is [string, string][] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    )
  );
}

function isRelayRequest(value: unknown): value is RelayRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === DEMO_RELAY_MESSAGE &&
    "url" in value &&
    typeof value.url === "string" &&
    "method" in value &&
    typeof value.method === "string" &&
    "headers" in value &&
    isHeaderList(value.headers) &&
    "body" in value &&
    (value.body === null || value.body instanceof ArrayBuffer)
  );
}

/** Statuses a `Response` may not be given a body with. */
const NO_BODY = new Set([101, 204, 205, 304]);

async function answer(fetch: InTabFetch, request: RelayRequest) {
  const res = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const body = NO_BODY.has(res.status) ? null : await res.arrayBuffer();
  return { status: res.status, headers: [...res.headers], body };
}

/**
 * Make this tab the server for the demo's uploads and unpublished files.
 *
 * Registers the demo's service worker (see `DEMO_SERVICE_WORKER_SOURCE`) and
 * answers what it relays with the same in-tab server the Studio's client
 * uses. Resolves once the worker controls this page -- the Studio must not
 * start before, or the first images it asks for go past it to a server that
 * has none of them.
 *
 * Resolves `false` where a service worker cannot run: an insecure context
 * (plain http on anything but localhost), or a browser without them. Uploads
 * are then off, and the Studio says why.
 */
export async function startDemoRelay(fetch: InTabFetch): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    !window.isSecureContext
  ) {
    return false;
  }
  const container = navigator.serviceWorker;
  container.addEventListener("message", (event: MessageEvent<unknown>) => {
    const port = event.ports[0];
    if (!isRelayRequest(event.data) || !port) return;
    answer(fetch, event.data)
      .then((res) => port.postMessage(res, res.body ? [res.body] : []))
      .catch((err: unknown) => {
        console.error("Val: the demo could not answer a relayed request", err);
        port.postMessage({
          status: 500,
          headers: [["Content-Type", "application/json"]],
          body: new TextEncoder().encode(
            JSON.stringify({ message: "The demo's server failed to answer." }),
          ).buffer,
        });
      });
  });
  // Messages are queued until this is called, when the listener is added with
  // `addEventListener` rather than assigned to `onmessage`.
  container.startMessages();
  try {
    await container.register(`/api/val${DEMO_SERVICE_WORKER_PATH}`, {
      scope: "/",
    });
    const registration = await container.ready;
    if (!container.controller) {
      // Not controlled yet. On a first visit the worker claims this page when
      // it activates. After a hard reload (Shift+Reload) it has activated
      // already and a browser deliberately leaves the page uncontrolled, so
      // the page asks it to claim -- or this would wait out the timeout and
      // start with uploads off.
      const controlled = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        container.addEventListener(
          "controllerchange",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      registration.active?.postMessage({ type: DEMO_CLAIM_MESSAGE });
      await controlled;
    }
    return container.controller !== null;
  } catch (err) {
    console.error("Val: the demo's service worker did not start", err);
    return false;
  }
}
