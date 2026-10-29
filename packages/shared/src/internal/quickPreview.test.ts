import {
  QUICK_PREVIEW_RENDER_SCRIPT,
  QUICK_PREVIEW_SERVICE_WORKER_SOURCE,
  QUICK_PREVIEW_STORE_MESSAGE,
  quickPreviewSiteOrigin,
} from "./quickPreview";

/**
 * The quick preview's worker, run against fake clients and a fake cache.
 *
 * It is served as plain source, so nothing type-checks it: these evaluate it
 * the way a browser would and drive its handlers.
 */

const ORIGIN = "https://p1--site.valstart.dev";

/** A page as the last build's server renders it. */
const PAGE =
  '<html><head></head><body><main class="flex-col">Old</main>' +
  '<script>window.$_TSR={}</script><script type="module" src="/_app/app.js"></script></body></html>';

type Listener = (event: Record<string, unknown>) => void;

function load(clients: Array<{ id: string; url: string }>) {
  const listeners: Record<string, Listener> = {};
  const stored = new Map<string, Response>();
  const fakeCaches = {
    open: async () => ({
      put: async (key: string, response: Response) => {
        stored.set(key, response);
      },
      match: async (key: string) => stored.get(key)?.clone(),
      keys: async () =>
        Array.from(stored.keys()).map((key) => new Request(`${ORIGIN}${key}`)),
      delete: async (request: Request) =>
        stored.delete(new URL(request.url).pathname),
    }),
    match: async (key: string) => stored.get(key)?.clone(),
  };
  const fetched: string[] = [];
  const fakeFetch = async (request: Request) => {
    fetched.push(new URL(request.url).pathname);
    if (request.mode === "navigate") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("from the network");
  };
  const self = {
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    clients: {
      claim: async () => undefined,
      get: async (id: string) => clients.find((c) => c.id === id),
    },
  };
  new Function("self", "caches", "fetch", QUICK_PREVIEW_SERVICE_WORKER_SOURCE)(
    self,
    fakeCaches,
    fakeFetch,
  );
  const store = (id: string, files: Record<string, unknown>) =>
    new Promise<unknown>((resolve) => {
      let done: Promise<unknown> = Promise.resolve();
      listeners.message?.({
        data: { type: QUICK_PREVIEW_STORE_MESSAGE, id, files },
        ports: [{ postMessage: resolve }],
        waitUntil: (work: Promise<unknown>) => {
          done = work;
        },
      });
      void done;
    });
  const request = (
    path: string,
    clientId: string,
    mode: RequestMode = "cors",
  ): Promise<Response> | null => {
    let responded: Promise<Response> | null = null;
    listeners.fetch?.({
      request: { url: `${ORIGIN}${path}`, mode },
      clientId,
      resultingClientId: mode === "navigate" ? clientId : "",
      respondWith: (response: Promise<Response>) => {
        responded = response;
      },
    });
    return responded;
  };
  return { store, request, fetched };
}

describe("the quick preview's worker", () => {
  const files = {
    "app.js": {
      body: "export const quick = true;",
      contentType: "text/javascript",
    },
    "c-abc.js": {
      body: "export const chunk = 1;",
      contentType: "text/javascript",
    },
  };

  test("serves a page opened as a quick preview its files, and the rest from the network", async () => {
    const worker = load([{ id: "page", url: `${ORIGIN}/about?val_quick=q1` }]);
    expect(await worker.store("q1", files)).toEqual({ ok: true });

    const app = await worker.request("/_app/app.js?b=abcdef12", "page");
    expect(await app?.text()).toBe("export const quick = true;");
    const chunk = await worker.request("/_app/c-abc.js", "page");
    expect(await chunk?.text()).toBe("export const chunk = 1;");
    // Not in the preview: the build's own.
    const css = await worker.request("/_app/app.css", "page");
    expect(await css?.text()).toBe("from the network");
  });

  test("never gives the files to a page not opened as a preview", async () => {
    const worker = load([{ id: "visitor", url: `${ORIGIN}/about` }]);
    await worker.store("q1", files);
    const app = await worker.request("/_app/app.js", "visitor");
    expect(await app?.text()).toBe("from the network");
  });

  test("knows a preview by its navigation, before the page has an address", async () => {
    const worker = load([]);
    await worker.store("q1", files);
    await worker.request("/about?val_quick=q1", "fresh", "navigate");
    const app = await worker.request("/_app/app.js", "fresh");
    expect(await app?.text()).toBe("export const quick = true;");
  });

  test("has a preview's page rendered by the new code, not hydrated into the old markup", async () => {
    const worker = load([]);
    const page = await worker.request(
      "/about?val_quick=q1",
      "fresh",
      "navigate",
    );
    const html = (await page?.text()) ?? "";
    // Before the app's scripts run, which are deferred: the body's markup
    // goes, its scripts stay
    expect(html).toBe(
      PAGE.replace("</body>", `${QUICK_PREVIEW_RENDER_SCRIPT}</body>`),
    );
  });

  test("leaves a page not opened as a preview to the network, as it is", () => {
    const worker = load([]);
    expect(worker.request("/about", "visitor", "navigate")).toBeNull();
  });

  test("leaves everything outside /_app/ alone", () => {
    const worker = load([{ id: "page", url: `${ORIGIN}/?val_quick=q1` }]);
    expect(worker.request("/api/val/stat", "page")).toBeNull();
    expect(worker.request("/favicon.ico", "page")).toBeNull();
  });
});

describe("who may send a quick preview", () => {
  test("the site's origin, as the proposal's own server names it", async () => {
    const origin = await quickPreviewSiteOrigin("/api/val", async () =>
      Response.json({ proposals: [], siteUrl: "https://www.example.com/" }),
    );
    expect(origin).toBe("https://www.example.com");
  });

  test("nobody, when the server does not say", async () => {
    expect(
      await quickPreviewSiteOrigin(
        "/api/val",
        async () => new Response("", { status: 401 }),
      ),
    ).toBeNull();
    expect(
      await quickPreviewSiteOrigin("/api/val", async () =>
        Response.json({ proposals: [] }),
      ),
    ).toBeNull();
  });
});
