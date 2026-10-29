import { Internal, initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { fakeRequest } from "./fakeRequest";
import { InMemoryPatchStore } from "./ValOpsMemory";
import { DEFAULT_ANALYTICS_INGEST_URL } from "./analyticsForward";

/**
 * `POST /analytics` outside Val's hosting: it checks what it is sent and
 * counts nothing. The endpoint takes anyone's POST, so the checks are the
 * point -- the hosted loader answers before this does, but it reads the same
 * format.
 *
 * Driven through the router, because how a `text/plain` body reaches the
 * route is part of what is under test.
 */
describe("/analytics", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();

  const post = async (json: unknown) => {
    const handler = createValApiRouter(
      route,
      createValServer(
        modules(config, [
          {
            def: () =>
              Promise.resolve({
                default: c.define("/content/page.val.ts", s.string(), "hello"),
              }),
          },
        ]),
        route,
        {
          disableCache: true,
          sourceFiles: { "/content/page.val.ts": "" },
          patchStore: new InMemoryPatchStore(),
          versions: { core: "0.0.0-test", next: "0.0.0-test" },
        },
        config,
        {
          async isEnabled() {
            return false;
          },
          async onDisable() {},
          async onEnable() {},
        },
      ),
      (res) => res,
    );
    const res = await handler(
      fakeRequest({
        method: "POST",
        url: new URL(`http://localhost:3000${route}/analytics`),
        headers: new Headers({ "Content-Type": "text/plain;charset=UTF-8" }),
        json,
      }),
    );
    return { status: res.status, json: "json" in res ? res.json : undefined };
  };

  const beacon = {
    v: 1,
    route: "/blogs/a",
    view: { device: "desktop" },
    rendered: { "/content/blog.val.ts": ['"a"."title"'] },
    viewed: {},
  };

  test("a valid beacon is answered, and not counted", async () => {
    expect(await post(beacon)).toEqual({
      status: 200,
      json: { counted: false },
    });
  });

  test("a newer format is not an error", async () => {
    expect(await post({ v: 2, anything: true })).toEqual({
      status: 200,
      json: { counted: false },
    });
  });

  test("a body with no version is not a beacon", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post([])).status).toBe(400);
  });

  test("more paths than a beacon may carry is refused", async () => {
    const paths = Array.from({ length: 201 }, (_, i) => `${i}`);
    expect(
      (await post({ ...beacon, rendered: { "/content/list.val.ts": paths } }))
        .status,
    ).toBe(400);
    expect(
      (
        await post({
          ...beacon,
          rendered: { "/content/a.val.ts": paths.slice(0, 101) },
          viewed: { "/content/a.val.ts": paths.slice(0, 100) },
        })
      ).status,
    ).toBe(400);
  });

  test("an over-long path, version or referrer is refused", async () => {
    expect(
      (
        await post({
          ...beacon,
          rendered: { "/content/a.val.ts": ["x".repeat(1025)] },
        })
      ).status,
    ).toBe(400);
    expect((await post({ ...beacon, cv: "c".repeat(129) })).status).toBe(400);
    expect(
      (
        await post({
          ...beacon,
          view: { device: "desktop", ref: "r".repeat(254) },
        })
      ).status,
    ).toBe(400);
  });
});

/**
 * A SELF-HOSTED site: the beacon reaches the app's own Val server, which in
 * http mode holds the project's api key and hands it on to Val's ingest. The
 * ingest is faked at `fetch`, as the content service is in the other http
 * mode route tests.
 */
describe("/analytics, forwarded to the ingest in http mode", () => {
  const route = "/api/val";
  const INGEST = "https://ingest.test/__ingest/analytics";
  const API_KEY = "test-api-key";
  const PROJECT = "acme/site";

  const beacon = {
    v: 1,
    route: "/blogs/$slug",
    view: { device: "desktop" },
    rendered: { "/content/blog.val.ts": ['"a"."title"'] },
    viewed: {},
  };
  const browser = {
    "Content-Type": "text/plain;charset=UTF-8",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15",
  };

  type Ingest = (
    url: string,
    init: RequestInit | undefined,
  ) => Promise<Response>;
  let ingest: Ingest = async () => new Response(null, { status: 204 });
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    ingest = async () => new Response(null, { status: 204 });
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.startsWith(INGEST)) {
          return ingest(url, init);
        }
        return new Response(JSON.stringify({ message: "unexpected" }), {
          status: 404,
        });
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ingestCalls = () =>
    fetchSpy.mock.calls.filter(([input]) => String(input).startsWith(INGEST));

  const serve = (mode: "http" | "fs") => {
    const { c, s, config } = initVal({ project: PROJECT });
    const valModules = modules(config, [
      {
        def: () =>
          Promise.resolve({
            default: c.define("/content/page.val.ts", s.string(), "hello"),
          }),
      },
    ]);
    return createValApiRouter(
      route,
      createValServer(
        valModules,
        route,
        mode === "http"
          ? {
              mode: "proxy",
              apiKey: API_KEY,
              valSecret: "test-secret-at-least-32-chars-long!!",
              valContentUrl: "https://content.test",
              valAnalyticsIngestUrl: INGEST,
              project: PROJECT,
              disableCache: true,
              versions: { core: "1.0.0", next: "1.0.0" },
            }
          : {
              mode: "local",
              valAnalyticsIngestUrl: INGEST,
              disableCache: true,
              versions: { core: "1.0.0", next: "1.0.0" },
            },
        config,
        {
          async isEnabled() {
            return false;
          },
          async onDisable() {},
          async onEnable() {},
        },
      ),
      (res) => res,
    );
  };

  const post = async (
    headers: Record<string, string>,
    options: { mode?: "http" | "fs"; json?: unknown } = {},
  ) => {
    const res = await serve(options.mode ?? "http")(
      fakeRequest({
        method: "POST",
        url: new URL(`https://site.test${route}/analytics`),
        headers: new Headers(headers),
        json: options.json ?? beacon,
      }),
    );
    return { status: res.status, json: "json" in res ? res.json : undefined };
  };

  test("a beacon is forwarded with the project's key, the visitor's User-Agent and the beacon as text", async () => {
    expect(await post(browser)).toEqual({
      status: 200,
      json: { counted: true },
    });
    const calls = ingestCalls();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(String(url)).toBe(INGEST);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("x-val-project")).toBe(PROJECT);
    expect(headers.get("x-val-visitor-user-agent")).toBe(browser["User-Agent"]);
    expect(headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    // No host said where the visitor is, so nothing is guessed.
    expect(headers.has("x-val-visitor-country")).toBe(false);
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(String(init?.body))).toEqual(beacon);
  });

  test("nothing about the visitor but the User-Agent and the country goes on", async () => {
    await post({
      ...browser,
      "X-Forwarded-For": "203.0.113.7",
      "X-Real-IP": "203.0.113.7",
      Cookie: "a=b",
      "X-Vercel-IP-Country": "NO",
    });
    const [, init] = ingestCalls()[0];
    expect([...new Headers(init?.headers).keys()].sort()).toEqual([
      "authorization",
      "content-type",
      "x-val-project",
      "x-val-visitor-country",
      "x-val-visitor-user-agent",
    ]);
  });

  test("the default ingest is Val's own", () => {
    expect(DEFAULT_ANALYTICS_INGEST_URL).toBe(
      "https://platform.valstart.dev/__ingest/analytics",
    );
  });

  test("fs mode counts nothing and forwards nothing, as before", async () => {
    const debug = jest.spyOn(Internal.log, "debug").mockImplementation();
    expect(await post(browser, { mode: "fs" })).toEqual({
      status: 200,
      json: { counted: false },
    });
    expect(ingestCalls()).toHaveLength(0);
    expect(debug).toHaveBeenCalledWith(
      "analytics: /blogs/$slug (page view): 1 rendered, 0 viewed",
    );
  });

  test.each([
    ["cross-site", { ...browser, "Sec-Fetch-Site": "cross-site" }],
    ["same-site", { ...browser, "Sec-Fetch-Site": "same-site" }],
    ["none", { ...browser, "Sec-Fetch-Site": "none" }],
    [
      "absent",
      {
        "Content-Type": browser["Content-Type"],
        "User-Agent": browser["User-Agent"],
      },
    ],
  ])(
    "a beacon whose Sec-Fetch-Site is %s is not forwarded",
    async (_, headers) => {
      expect(await post(headers)).toEqual({
        status: 200,
        json: { counted: false },
      });
      expect(ingestCalls()).toHaveLength(0);
    },
  );

  test("a beacon with no User-Agent is not forwarded", async () => {
    expect(
      await post({
        "Content-Type": browser["Content-Type"],
        "Sec-Fetch-Site": "same-origin",
      }),
    ).toEqual({ status: 200, json: { counted: false } });
    expect(ingestCalls()).toHaveLength(0);
  });

  test("an invalid beacon is refused before anything is forwarded", async () => {
    expect((await post(browser, { json: {} })).status).toBe(400);
    expect(await post(browser, { json: { v: 2, anything: true } })).toEqual({
      status: 200,
      json: { counted: false },
    });
    expect(ingestCalls()).toHaveLength(0);
  });

  const countryOf = async (headers: Record<string, string>) => {
    await post({ ...browser, ...headers });
    const [, init] = ingestCalls()[0];
    return new Headers(init?.headers).get("x-val-visitor-country");
  };

  test.each([
    ["X-Vercel-IP-Country", "NO"],
    ["CF-IPCountry", "SE"],
    ["CloudFront-Viewer-Country", "DK"],
  ])("the country is read from %s", async (name, value) => {
    expect(await countryOf({ [name]: value })).toBe(value);
  });

  test("the first of the three that holds a country wins", async () => {
    expect(
      await countryOf({
        "X-Vercel-IP-Country": "NO",
        "CF-IPCountry": "SE",
        "CloudFront-Viewer-Country": "DK",
      }),
    ).toBe("NO");
  });

  test("a country that is not two letters is skipped for the next one", async () => {
    expect(
      await countryOf({
        "X-Vercel-IP-Country": "Norway",
        "CF-IPCountry": "T1",
        "CloudFront-Viewer-Country": "dk",
      }),
    ).toBe("DK");
  });

  test.each(["", "N", "NOR", "1A", "N0", "XX", "<script>"])(
    "a malformed country (%j) is not forwarded",
    async (value) => {
      expect(await countryOf({ "CF-IPCountry": value })).toBe(null);
    },
  );

  test("the ingest's 204 is counted", async () => {
    ingest = async () => new Response(null, { status: 204 });
    expect(await post(browser)).toEqual({
      status: 200,
      json: { counted: true },
    });
  });

  test("the ingest's 410 is passed on, so the script stops", async () => {
    ingest = async () => new Response(null, { status: 410 });
    const res = await post(browser);
    expect(res.status).toBe(410);
  });

  test("the ingest's 401 is not counted, and warned about once", async () => {
    ingest = async () =>
      new Response(JSON.stringify({ message: "unauthorized" }), {
        status: 401,
      });
    const warn = jest.spyOn(Internal.log, "warn").mockImplementation();
    expect(await post(browser)).toEqual({
      status: 200,
      json: { counted: false },
    });
    expect(await post(browser)).toEqual({
      status: 200,
      json: { counted: false },
    });
    const analyticsWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes("VAL_API_KEY"),
    );
    expect(analyticsWarnings).toHaveLength(1);
    expect(String(analyticsWarnings[0][0])).toContain("VAL_PROJECT");
    expect(String(analyticsWarnings[0][0])).toContain(PROJECT);
    expect(String(analyticsWarnings[0][0])).not.toContain(API_KEY);
  });

  test.each([400, 413, 415, 500])(
    "the ingest's %i is not counted",
    async (status) => {
      ingest = async () => new Response(null, { status });
      expect(await post(browser)).toEqual({
        status: 200,
        json: { counted: false },
      });
    },
  );

  test("a forward that throws is not counted, and does not throw", async () => {
    ingest = async () => {
      throw new TypeError("fetch failed");
    };
    const warn = jest.spyOn(Internal.log, "warn").mockImplementation();
    const debug = jest.spyOn(Internal.log, "debug").mockImplementation();
    expect(await post(browser)).toEqual({
      status: 200,
      json: { counted: false },
    });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("analytics"),
      expect.anything(),
    );
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("could not forward"),
      expect.any(TypeError),
    );
  });
});
