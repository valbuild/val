import {
  STUDIO_APP_SCOPE,
  STUDIO_SERVICE_WORKER_SOURCE,
  studioManifest,
} from "./studioApp";

/**
 * The Studio's service worker, run against a fake network and Cache Storage.
 *
 * It is served as plain source, so nothing type-checks it: these evaluate it
 * with a `self` the way a browser would (as the demo's worker's tests do) and
 * drive its fetch handler.
 */

type FakeFetchEvent = {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
};

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (request: Request | string) =>
    typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
  return {
    stores,
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        match: async (request: Request | string) =>
          store.get(keyOf(request))?.clone(),
        put: async (request: Request | string, response: Response) => {
          store.set(keyOf(request), response);
        },
        keys: async () => [...store.keys()].map((url) => new Request(url)),
        delete: async (request: Request) => store.delete(request.url),
      };
    },
  };
}

const ORIGIN = "https://site.example";

function load(network: (request: Request) => Promise<Response>) {
  const listeners: Record<string, (event: FakeFetchEvent) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    addEventListener: (
      type: string,
      listener: (event: FakeFetchEvent) => void,
    ) => {
      listeners[type] = listener;
    },
  };
  const caches = fakeCaches();
  const calls: string[] = [];
  const fetch = (request: Request) => {
    calls.push(new URL(request.url).pathname);
    return network(request);
  };
  new Function("self", "caches", "fetch", STUDIO_SERVICE_WORKER_SOURCE)(
    self,
    caches,
    fetch,
  );
  const request = (
    path: string,
    init?: RequestInit & { navigate?: boolean },
  ): Promise<Response> | null => {
    const req = new Request(`${ORIGIN}${path}`, init);
    // `mode` cannot be set to "navigate" through the constructor.
    const request = init?.navigate
      ? new Proxy(req, {
          get: (target, prop) =>
            prop === "mode" ? "navigate" : Reflect.get(target, prop, target),
        })
      : req;
    let responded: Promise<Response> | null = null;
    listeners.fetch?.({
      request,
      respondWith: (response) => {
        responded = response;
      },
    });
    return responded;
  };
  return { request, calls, caches };
}

const immutable = (body: string) =>
  new Response(body, {
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });

describe("the Studio's service worker", () => {
  test("leaves content, patches and everything else to the network", () => {
    const sw = load(async () => new Response("x"));
    expect(sw.request("/api/val/sources/~")).toBeNull();
    expect(sw.request("/api/val/patches", { method: "PUT" })).toBeNull();
    expect(sw.request("/api/val/files/public/val/a.png?patch_id=1")).toBeNull();
    expect(sw.request("/blog/post")).toBeNull();
  });

  test("serves a versioned Studio file from its cache after the first load", async () => {
    const sw = load(async () => immutable("app v1"));
    const first = await sw.request("/api/val/static/1.2.3/app");
    expect(await first?.text()).toBe("app v1");
    const second = await sw.request("/api/val/static/1.2.3/app");
    expect(await second?.text()).toBe("app v1");
    expect(sw.calls).toEqual(["/api/val/static/1.2.3/app"]);
  });

  test("never stores a Studio file the server did not mark immutable", async () => {
    const sw = load(
      async () =>
        new Response("dev", { headers: { "Cache-Control": "max-age=90" } }),
    );
    await sw.request("/api/val/static/1.2.3/other");
    await sw.request("/api/val/static/1.2.3/other");
    expect(sw.calls).toHaveLength(2);
  });

  test("never touches a Studio file without a version: a dev server's", () => {
    const sw = load(async () => immutable("app"));
    expect(sw.request("/api/val/static/app")).toBeNull();
    expect(sw.request("/api/val/static/spa/index.css")).toBeNull();
  });

  test("drops the old version's files when a new version is stored", async () => {
    const sw = load(async (request) => immutable(request.url));
    await sw.request("/api/val/static/1.2.3/app");
    await sw.request("/api/val/static/1.2.3/spa/index.css");
    await sw.request("/api/val/static/1.3.0/app");
    const store = sw.caches.stores.get("val-studio-static");
    expect([...(store?.keys() ?? [])]).toEqual([
      `${ORIGIN}/api/val/static/1.3.0/app`,
    ]);
  });

  test("opens the last Studio page it loaded when the network is gone", async () => {
    let online = true;
    const sw = load(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return new Response("<html>studio</html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
    const live = await sw.request(STUDIO_APP_SCOPE, { navigate: true });
    expect(await live?.text()).toBe("<html>studio</html>");
    online = false;
    const offline = await sw.request(`${STUDIO_APP_SCOPE}/~/content`, {
      navigate: true,
    });
    expect(await offline?.text()).toBe("<html>studio</html>");
  });

  test("never stores a page that was not the Studio: a redirect to sign in", async () => {
    const sw = load(async () => {
      const res = new Response("<html>sign in</html>", {
        headers: { "Content-Type": "text/html" },
      });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    });
    await sw.request(STUDIO_APP_SCOPE, { navigate: true });
    expect(sw.caches.stores.get("val-studio-page")?.size ?? 0).toBe(0);
  });
});

describe("the Studio's manifest", () => {
  test("is the site's Studio: starts and stays at /val, without browser chrome", () => {
    const manifest = studioManifest("www.example.com", "/api/val");
    expect(manifest).toMatchObject({
      id: "/val",
      start_url: "/val",
      scope: "/val",
      display: "standalone",
      name: "Val · www.example.com",
    });
    expect(manifest.icons.map((icon) => icon.sizes)).toContain("512x512");
    expect(
      manifest.icons.every((icon) => icon.src.startsWith("/api/val/")),
    ).toBe(true);
  });
});
