import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";

const ROUTE = "/api/val";

function onLiveSourcesRoute(opts: {
  live?: { ttl: number; staleWhileRevalidate?: number };
  proxy?: boolean;
}) {
  const { c, s, config: baseConfig } = initVal();
  const config = { ...baseConfig, live: opts.live };
  const valModules = modules(config, [
    {
      def: () =>
        Promise.resolve({
          default: c.define(
            "/content/authors.val.ts",
            s.object({ name: s.string() }),
            { name: "Deployed" },
          ),
        }),
    },
  ]);
  return createValApiRouter(
    ROUTE,
    createValServer(
      valModules,
      ROUTE,
      opts.proxy
        ? {
            mode: "proxy",
            apiKey: "test-api-key",
            valSecret: "test-secret",
            project: "org/project",
            gitCommit: "commit1",
            gitBranch: "main",
            versions: { core: "1.0.0", next: "1.0.0" },
            ...config,
          }
        : { disableCache: true, ...config },
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
}

/** No cookies and no auth header: exactly what an anonymous end user sends. */
function anonymousRequest(): Request {
  return {
    method: "GET",
    url: new URL(`http://localhost:3000${ROUTE}/live/sources`),
    headers: new Headers(),
    json: async () => ({}),
  } as unknown as Request;
}

describe("/live/sources", () => {
  let fetchMock: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "",
      json: async () => ({
        headCommitSha: "commit2",
        baseCommitSha: "commit1",
        patches: [
          {
            patchId: "patch1",
            path: "/content/authors.val.ts",
            patch: [{ op: "replace", path: ["name"], value: "Committed" }],
            baseSha: "base1",
            createdAt: "2024-01-01T00:00:00.000Z",
            authorId: "author1",
            appliedAt: { commitSha: "commit2" },
          },
        ],
      }),
      headers: { get: () => null },
    } as unknown as Response);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    warn.mockRestore();
  });

  test("serves live sources to an anonymous request", async () => {
    const res = await onLiveSourcesRoute({
      live: { ttl: 60, staleWhileRevalidate: 300 },
      proxy: true,
    })(anonymousRequest());

    expect(res.status).toBe(200);
    expect("json" in res && res.json).toEqual({
      headCommitSha: "commit2",
      sources: { "/content/authors.val.ts": { name: "Committed" } },
    });
    expect("headers" in res && res.headers).toEqual({
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    });
  });

  test("ttl 0 is served as no-store", async () => {
    const res = await onLiveSourcesRoute({
      live: { ttl: 0 },
      proxy: true,
    })(anonymousRequest());

    expect(res.status).toBe(200);
    expect("headers" in res && res.headers).toEqual({
      "Cache-Control": "no-store",
    });
  });

  test("returns an empty set when live mode is off, not an error", async () => {
    const res = await onLiveSourcesRoute({ proxy: true })(anonymousRequest());

    expect(res.status).toBe(200);
    expect("json" in res && res.json).toEqual({
      headCommitSha: null,
      sources: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns an empty set in fs mode, where live mode does not apply", async () => {
    const res = await onLiveSourcesRoute({ live: { ttl: 60 } })(
      anonymousRequest(),
    );

    expect(res.status).toBe(200);
    expect("json" in res && res.json).toEqual({
      headCommitSha: null,
      sources: {},
    });
  });
});
