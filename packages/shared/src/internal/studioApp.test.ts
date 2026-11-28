import {
  STUDIO_SERVICE_WORKER_SOURCE,
  STUDIO_START_URL,
  studioAppIconFromQuery,
  studioManifest,
  studioManifestUrl,
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

function fakeCaches(failWrites: boolean) {
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
          if (failWrites) {
            throw new DOMException(
              "The quota has been exceeded.",
              "QuotaExceededError",
            );
          }
          store.set(keyOf(request), response);
        },
        keys: async () => [...store.keys()].map((url) => new Request(url)),
        delete: async (request: Request) => store.delete(request.url),
      };
    },
  };
}

const ORIGIN = "https://site.example";

function load(
  network: (request: Request) => Promise<Response>,
  options: { failWrites?: boolean } = {},
) {
  const listeners: Record<string, (event: FakeFetchEvent) => void> = {};
  const self = {
    // Where the API route serves it: the worker reads the route from here.
    location: { origin: ORIGIN, pathname: "/api/val/studio-sw.js" },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    addEventListener: (
      type: string,
      listener: (event: FakeFetchEvent) => void,
    ) => {
      listeners[type] = listener;
    },
  };
  const caches = fakeCaches(options.failWrites ?? false);
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
    const live = await sw.request(STUDIO_START_URL, { navigate: true });
    expect(await live?.text()).toBe("<html>studio</html>");
    online = false;
    const offline = await sw.request("/val/~/content", {
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
    await sw.request(STUDIO_START_URL, { navigate: true });
    expect(sw.caches.stores.get("val-studio-page")?.size ?? 0).toBe(0);
  });
  test("caches only the Studio's own files, not another response under /static/", async () => {
    const sw = load(async () => immutable("x"));
    expect(
      sw.request("/api/val/modules/~/content/static/1.2.3/page.val.ts"),
    ).toBeNull();
    expect(sw.request("/static/1.2.3/app.js")).toBeNull();
    expect(sw.request("/api/val/static/1.2.3/app")).not.toBeNull();
  });

  test("an older version's file stores without evicting the newer version", async () => {
    // A tab still on the old Studio, fetching a file after the new one loaded.
    const sw = load(async (request) => immutable(request.url));
    await sw.request("/api/val/static/1.10.0/app");
    await sw.request("/api/val/static/1.9.0/chunk.js");
    const store = sw.caches.stores.get("val-studio-static");
    expect([...(store?.keys() ?? [])]).toContain(
      `${ORIGIN}/api/val/static/1.10.0/app`,
    );
  });

  test("a full cache never costs the response the network gave", async () => {
    const sw = load(async () => immutable("app"), { failWrites: true });
    const res = await sw.request("/api/val/static/1.2.3/app");
    expect(await res?.text()).toBe("app");
  });

  test("a page that loaded is served even when it cannot be stored", async () => {
    const sw = load(
      async () =>
        new Response("<html>live</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      { failWrites: true },
    );
    const res = await sw.request(STUDIO_START_URL, { navigate: true });
    expect(await res?.text()).toBe("<html>live</html>");
  });
});

describe("the Studio's manifest", () => {
  test("is the site's Studio: starts and stays at /val, without browser chrome", () => {
    const manifest = studioManifest("www.example.com", "/api/val");
    expect(manifest).toMatchObject({
      id: "/val",
      start_url: "/val/~",
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

describe("the project's icon in the manifest", () => {
  const icon = {
    src: "/val/brand/mark_a1b2c.png",
    type: "image/png",
    sizes: "512x512",
  };

  test("travels on the manifest's URL and back", () => {
    const url = new URL(
      studioManifestUrl("/api/val", icon),
      "https://site.example",
    );
    expect(url.pathname).toBe("/api/val/manifest.webmanifest");
    expect(studioAppIconFromQuery(url.searchParams)).toEqual(icon);
  });

  test("is the only icon, so the browser cannot pick Val's instead", () => {
    expect(studioManifest("site.example", "/api/val", icon).icons).toEqual([
      icon,
    ]);
  });

  test("is refused when it is not an image URL a manifest may name", () => {
    const query = (fields: Record<string, string>) =>
      studioAppIconFromQuery(
        new URLSearchParams({ ...icon, icon: icon.src, ...fields }),
      );
    expect(query({ icon: "//evil.example/x.png" })).toBeNull();
    expect(query({ icon: "http://evil.example/x.png" })).toBeNull();
    expect(query({ icon: "javascript:alert(1)" })).toBeNull();
    expect(query({ type: "text/html" })).toBeNull();
    expect(query({ sizes: "big" })).toBeNull();
    expect(query({ icon: "https://remote.val.build/x.png" })).not.toBeNull();
  });
});
