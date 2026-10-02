import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";
import { studioApiUrl } from "./adminProxy";

/**
 * `/admin/proxy/*`: the web components' way to Val Build, with the editor's
 * token attached here because the browser cannot reach it.
 *
 * Most of what is pinned is what it REFUSES. It holds a credential for
 * everything the editor can do on Val Build, so the tests that matter are the
 * ones where it must not be aimed elsewhere, must not be driven from another
 * site, and must not run without a session.
 */

const VAL_BUILD = "https://admin.example";

describe("studioApiUrl", () => {
  test("puts the path and query under /api/studio/v1/ on Val Build", () => {
    expect(
      studioApiUrl(VAL_BUILD, "/projects/overview", "?current=acme%2Fsite"),
    ).toBe(`${VAL_BUILD}/api/studio/v1/projects/overview?current=acme%2Fsite`);
    expect(studioApiUrl(`${VAL_BUILD}/`, "/projects/search", "")).toBe(
      `${VAL_BUILD}/api/studio/v1/projects/search`,
    );
  });

  test.each([
    ["/../../val/auth/token", ""],
    ["/%2e%2e/%2e%2e/val/auth/token", ""],
    ["/..\\..\\val/auth/token", ""],
    ["/projects/../../../oauth/token", ""],
    ["projects/overview", ""],
    ["/projects/overview", "current=x"],
  ])("refuses %p %p, which would leave the prefix", (path, query) => {
    expect(studioApiUrl(VAL_BUILD, path, query)).toBeNull();
  });

  test("cannot be pointed at another host", () => {
    const url = studioApiUrl(VAL_BUILD, "//evil.example/x", "");
    expect(url === null || new URL(url).origin === VAL_BUILD).toBe(true);
  });
});

describe("the /admin/proxy route", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();
  const SECRET = "test-secret";

  // Proxy mode reads these from the environment, and refuses to start
  // without them. See historyFilesAuth.test.ts.
  const previousEnv = {
    commit: process.env["VAL_GIT_COMMIT"],
    branch: process.env["VAL_GIT_BRANCH"],
  };
  beforeAll(() => {
    process.env["VAL_GIT_COMMIT"] = "0000000000000000000000000000000000000000";
    process.env["VAL_GIT_BRANCH"] = "main";
  });
  afterAll(() => {
    if (previousEnv.commit === undefined) delete process.env["VAL_GIT_COMMIT"];
    else process.env["VAL_GIT_COMMIT"] = previousEnv.commit;
    if (previousEnv.branch === undefined) delete process.env["VAL_GIT_BRANCH"];
    else process.env["VAL_GIT_BRANCH"] = previousEnv.branch;
  });

  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ results: [] }, { status: 200 }),
      );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const router = createValApiRouter(
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
        apiKey: "test-api-key",
        valSecret: SECRET,
        project: "acme/site",
        valContentUrl: "http://localhost:9999",
        valBuildUrl: VAL_BUILD,
        versions: { core: "0.0.0-test", next: "0.0.0-test" },
      },
      config,
      {
        async isEnabled() {
          return true;
        },
        async onDisable() {},
        async onEnable() {},
      },
    ),
    (res) => res,
  );

  const session = (overrides: Record<string, unknown> = {}) =>
    encodeJwt(
      {
        sub: "ada",
        exp: Math.floor(Date.now() / 1000) + 3600,
        token: "editors-val-build-token",
        org: "acme",
        project: "site",
        ...overrides,
      },
      SECRET,
    );

  const call = ({
    method = "GET",
    path,
    cookie = session(),
    studioHeader = true,
    body,
  }: {
    method?: string;
    path: string;
    cookie?: string | null;
    studioHeader?: boolean;
    body?: unknown;
  }) => {
    const headers = new Headers();
    if (cookie !== null) {
      headers.set("Cookie", `val_session=${encodeURIComponent(cookie)}`);
    }
    if (studioHeader) {
      headers.set("x-val-studio", "1");
    }
    return router(
      fakeRequest({
        method,
        url: new URL(`http://localhost:3000${route}/admin/proxy${path}`),
        headers,
        json: body,
      }),
    );
  };

  test("forwards the path and query with the editor's token, and nothing else", async () => {
    const res = await call({ path: "/projects/search?q=camp&limit=20" });
    expect(res).toEqual({ status: 200, json: { results: [] } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `${VAL_BUILD}/api/studio/v1/projects/search?q=camp&limit=20`,
    );
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    // The app's cookies stay here: only the token goes.
    expect(init.headers).toEqual({
      authorization: "Bearer editors-val-build-token",
      accept: "application/json",
    });
    expect(init.body).toBeUndefined();
  });

  test("forwards a JSON body on PUT and POST", async () => {
    await call({
      method: "POST",
      path: "/projects/opened?project=acme%2Fsite",
      body: { a: 1 },
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers["content-type"]).toBe("application/json");
  });

  test("passes Val Build's code through, so the component can act on it", async () => {
    fetchSpy.mockImplementation(async () =>
      Response.json(
        { code: "not-found", message: "No such project." },
        { status: 404 },
      ),
    );
    expect(await call({ method: "PUT", path: "/projects/x/pin" })).toEqual({
      status: 404,
      json: { code: "not-found", message: "No such project." },
    });
  });

  test("refuses a request without the x-val-studio header, before calling out", async () => {
    const res = await call({ path: "/projects/overview", studioHeader: false });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("answers unauthenticated without a session, and for an expired one", async () => {
    for (const cookie of [
      null,
      session({ exp: Math.floor(Date.now() / 1000) - 3600 }),
      "garbage",
    ]) {
      const res = await call({ path: "/projects/overview", cookie });
      expect(res.status).toBe(401);
      expect(res).toMatchObject({ json: { code: "unauthenticated" } });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("refuses a path that would leave /api/studio/v1/, before calling out", async () => {
    const res = await call({ path: "/%2e%2e/%2e%2e/val/auth/token" });
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an unreachable Val Build is a 500 the component reads as an outage", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const res = await call({ path: "/projects/overview" });
    expect(res.status).toBe(500);
  });
});

describe("the /admin/proxy route in fs mode", () => {
  test("is not-connected: local dev has no Val Build session to borrow", async () => {
    const route = "/api/val";
    const { c, s, config } = initVal();
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    try {
      const router = createValApiRouter(
        route,
        createValServer(
          modules(config, [
            {
              def: () =>
                Promise.resolve({
                  default: c.define("/content/page.val.ts", s.string(), "hi"),
                }),
            },
          ]),
          route,
          { disableCache: true, versions: { core: "0.0.0-test" } },
          config,
          {
            async isEnabled() {
              return true;
            },
            async onDisable() {},
            async onEnable() {},
          },
        ),
        (res) => res,
      );
      const res = await router(
        fakeRequest({
          method: "GET",
          url: new URL(
            `http://localhost:3000${route}/admin/proxy/projects/overview`,
          ),
          headers: new Headers({ "x-val-studio": "1" }),
        }),
      );
      expect(res).toMatchObject({
        status: 404,
        json: { code: "not-connected" },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
