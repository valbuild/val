import {
  DEMO_CLAIM_MESSAGE,
  DEMO_RELAY_MESSAGE,
  DEMO_SERVICE_WORKER_SOURCE,
} from "./demoServiceWorker";

/**
 * The demo's service worker, run against fake clients.
 *
 * It is served as plain source, so nothing type-checks it. These run it the
 * way a browser would -- evaluated with a `self` -- and drive its fetch
 * handler: what it relays, which tab it asks, and what it answers when no
 * Studio is open.
 */

type FakeClient = {
  id: string;
  url: string;
  postMessage: (message: unknown, transfer: unknown[]) => void;
};

type FetchEvent = {
  request: Request;
  clientId: string;
  respondWith: (response: Promise<Response>) => void;
};

function studio(
  id: string,
  path: string,
  answer: (message: { url: string; method: string; body: string | null }) => {
    status: number;
    body: string | null;
  },
): FakeClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    id,
    url: `https://demo.example${path}`,
    asked,
    postMessage: (sent, transfer) => {
      // Received the way a browser delivers it: a structured clone, with the
      // buffers in the transfer list moved rather than copied -- which
      // detaches them on the sending side. (The port is used as it is: a
      // browser hands it over as `event.ports`, not inside the message.)
      const message: unknown = structuredClone(sent, {
        transfer: transfer.filter(
          (t): t is ArrayBuffer => t instanceof ArrayBuffer,
        ),
      });
      if (
        typeof message !== "object" ||
        message === null ||
        !("url" in message) ||
        typeof message.url !== "string" ||
        !("method" in message) ||
        typeof message.method !== "string"
      ) {
        throw new Error("unexpected message");
      }
      asked.push(message.url);
      const port = transfer[0];
      if (!(port instanceof MessagePort)) throw new Error("no port");
      const received =
        "body" in message && message.body instanceof ArrayBuffer
          ? new TextDecoder().decode(message.body)
          : null;
      const res = answer({
        url: message.url,
        method: message.method,
        body: received,
      });
      const body =
        res.body === null ? null : new TextEncoder().encode(res.body).buffer;
      port.postMessage({
        status: res.status,
        headers: [["Content-Type", "text/plain"]],
        body,
      });
    },
  };
}

function load(clients: FakeClient[]) {
  const listeners: Record<string, (event: FetchEvent) => void> = {};
  const self = {
    location: { origin: "https://demo.example" },
    skipWaiting: () => undefined,
    addEventListener: (type: string, listener: (event: FetchEvent) => void) => {
      listeners[type] = listener;
    },
    clients: {
      claim: async () => undefined,
      get: async (id: string) => clients.find((c) => c.id === id),
      matchAll: async () => clients,
    },
  };
  new Function("self", DEMO_SERVICE_WORKER_SOURCE)(self);
  return (
    url: string,
    clientId: string,
    init?: RequestInit,
  ): Promise<Response> | null => {
    let responded: Promise<Response> | null = null;
    listeners.fetch?.({
      request: new Request(`https://demo.example${url}`, init),
      clientId,
      respondWith: (response) => {
        responded = response;
      },
    });
    return responded;
  };
}

describe("the demo's service worker", () => {
  test("names the message the Studio tab listens for", () => {
    expect(DEMO_SERVICE_WORKER_SOURCE).toContain(`"${DEMO_RELAY_MESSAGE}"`);
  });

  test("leaves everything but uploads and files alone", () => {
    const fetch = load([]);
    expect(fetch("/journal", "c")).toBeNull();
    expect(fetch("/api/val/static/1.0.0/app", "c")).toBeNull();
    expect(fetch("/val/images/hero.jpg", "c")).toBeNull();
  });

  test("asks the Studio page a request came from", async () => {
    const own = studio("a", "/val/~/x", () => ({ status: 200, body: "mine" }));
    const other = studio("b", "/val", () => ({ status: 200, body: "theirs" }));
    const fetch = load([own, other]);
    const res = await fetch("/api/val/files/public/val/a.png?patch_id=1", "a");
    expect(await res?.text()).toBe("mine");
    expect(other.asked).toEqual([]);
  });

  test("from a canvas frame, the Studio tab that has the file answers", async () => {
    const without = studio("a", "/val", () => ({ status: 404, body: null }));
    const withIt = studio("b", "/val/~/y", () => ({ status: 200, body: "it" }));
    const frame: FakeClient = {
      id: "frame",
      url: "https://demo.example/journal?val_canvas=1",
      postMessage: () => {
        throw new Error("a frame is never asked");
      },
    };
    const fetch = load([frame, without, withIt]);
    const res = await fetch(
      "/api/val/files/public/val/a.png?patch_id=1",
      "frame",
    );
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("it");
    expect(without.asked).toHaveLength(1);
  });

  test("passes an upload's body and method through", async () => {
    let seen = "";
    const tab = studio("a", "/val", ({ method }) => {
      seen = method;
      return { status: 200, body: "{}" };
    });
    const fetch = load([tab]);
    const res = await fetch("/api/val/upload/patches/p/files", "a", {
      method: "POST",
      body: JSON.stringify({ data: "x" }),
    });
    expect(res?.status).toBe(200);
    expect(seen).toBe("POST");
  });

  test("from a canvas frame, an upload's body reaches every Studio tab it is offered to", async () => {
    // A body can be transferred once. Every tab after the first has to get a
    // copy taken BEFORE the first transfer, or the copy throws on a detached
    // buffer and the upload never reaches the tab that has the patch.
    const without = studio("a", "/val", () => ({ status: 404, body: null }));
    let seen: string | null = null;
    const withIt = studio("b", "/val/~/y", ({ body }) => {
      seen = body;
      return { status: 200, body: "{}" };
    });
    const frame: FakeClient = {
      id: "frame",
      url: "https://demo.example/journal?val_canvas=1",
      postMessage: () => {
        throw new Error("a frame is never asked");
      },
    };
    const fetch = load([frame, without, withIt]);
    const res = await fetch("/api/val/upload/patches/p/files", "frame", {
      method: "POST",
      body: "the bytes",
    });
    expect(res?.status).toBe(200);
    expect(seen).toBe("the bytes");
  });

  test("takes a page under its control when the page asks: a hard reload is not", async () => {
    let claims = 0;
    let onMessage:
      | ((event: {
          data: unknown;
          waitUntil: (work: Promise<unknown>) => void;
        }) => void)
      | undefined;
    const self = {
      location: { origin: "https://demo.example" },
      skipWaiting: () => undefined,
      addEventListener: (type: string, listener: never) => {
        if (type === "message") onMessage = listener;
      },
      clients: {
        claim: async () => {
          claims++;
        },
      },
    };
    new Function("self", DEMO_SERVICE_WORKER_SOURCE)(self);
    const waited: Promise<unknown>[] = [];
    onMessage?.({
      data: { type: "unrelated" },
      waitUntil: (w) => waited.push(w),
    });
    expect(claims).toBe(0);
    onMessage?.({
      data: { type: DEMO_CLAIM_MESSAGE },
      waitUntil: (w) => waited.push(w),
    });
    await Promise.all(waited);
    expect(claims).toBe(1);
  });

  test("says the Studio is not open, rather than hanging, when it is not", async () => {
    const fetch = load([]);
    const res = await fetch("/api/val/files/public/val/a.png?patch_id=1", "x");
    expect(res?.status).toBe(503);
  });
});
