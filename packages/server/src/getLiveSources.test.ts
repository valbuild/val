import { ModuleFilePath, initVal, modules } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import { ResolvedLiveConfig } from "./ValOps";

const { s, c, config } = initVal();
const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
const PAGES = "/content/pages.val.ts" as ModuleFilePath;

function testOps(live?: ResolvedLiveConfig) {
  return new ValOpsHttp(
    "https://content.example.com",
    "org/project",
    "commit1",
    "main",
    { apiKey: "test-api-key" },
    modules(config, [
      {
        def: () =>
          Promise.resolve({
            default: c.define(AUTHORS, s.object({ name: s.string() }), {
              name: "Deployed",
            }),
          }),
      },
      {
        def: () =>
          Promise.resolve({
            default: c.define(PAGES, s.object({ title: s.string() }), {
              title: "Deployed page",
            }),
          }),
      },
    ]),
    { config, live },
  );
}

/** One committed-but-undeployed patch on /content/authors.val.ts */
function livePatch(value: string, patchId = "patch1") {
  return {
    patchId,
    path: AUTHORS,
    patch: [{ op: "replace", path: ["name"], value }],
    baseSha: "base1",
    createdAt: "2024-01-01T00:00:00.000Z",
    authorId: "author1",
    appliedAt: { commitSha: "commit2" },
  };
}

function jsonResponse(
  json: unknown,
  init?: { ok?: boolean; status?: number; headers?: Record<string, string> },
) {
  const headers = init?.headers ?? {};
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => json,
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

function liveResponse(
  patches: ReturnType<typeof livePatch>[],
  overrides?: { headCommitSha?: string | null; baseCommitSha?: string | null },
) {
  return jsonResponse({
    headCommitSha: overrides?.headCommitSha ?? "commit2",
    baseCommitSha:
      overrides && "baseCommitSha" in overrides
        ? overrides.baseCommitSha
        : "commit1",
    patches,
  });
}

describe("getLiveSources", () => {
  let fetchMock: jest.SpyInstance;
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch");
    error = jest.spyOn(console, "error").mockImplementation(() => {});
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockRestore();
    error.mockRestore();
    warn.mockRestore();
  });

  test("applies committed patches and returns only the changed modules", async () => {
    fetchMock.mockResolvedValue(liveResponse([livePatch("Committed")]));

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res.sources).toEqual({ [AUTHORS]: { name: "Committed" } });
    // Unchanged modules stay out of the response - it goes over the wire.
    expect(res.sources[PAGES]).toBeUndefined();
    expect(res.headCommitSha).toBe("commit2");
  });

  test("applies patches in order", async () => {
    fetchMock.mockResolvedValue(
      liveResponse([livePatch("First", "p1"), livePatch("Second", "p2")]),
    );

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res.sources).toEqual({ [AUTHORS]: { name: "Second" } });
  });

  test("requests the branch, commit, base_sha and core_version", async () => {
    fetchMock.mockResolvedValue(liveResponse([]));
    const ops = testOps({ ttl: 60, staleWhileRevalidate: 0 });

    await ops.getLiveSources();

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/org/project/live/patches");
    expect(url.searchParams.get("branch")).toBe("main");
    expect(url.searchParams.get("commit")).toBe("commit1");
    expect(url.searchParams.get("base_sha")).toBe(await ops.getBaseSha());
    expect(url.searchParams.get("core_version")).toBeTruthy();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer test-api-key",
    });
  });

  test("is a no-op when live mode is off", async () => {
    fetchMock.mockResolvedValue(liveResponse([livePatch("Committed")]));

    const res = await testOps().getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("caches within the ttl", async () => {
    fetchMock.mockResolvedValue(liveResponse([livePatch("Committed")]));
    const ops = testOps({ ttl: 60, staleWhileRevalidate: 0 });

    await ops.getLiveSources();
    await ops.getLiveSources();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("ttl 0 refetches every time", async () => {
    fetchMock.mockResolvedValue(liveResponse([livePatch("Committed")]));
    const ops = testOps({ ttl: 0, staleWhileRevalidate: 0 });

    await ops.getLiveSources();
    await ops.getLiveSources();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("sends no-store when ttl is 0 and a revalidate hint otherwise", async () => {
    fetchMock.mockResolvedValue(liveResponse([]));

    await testOps({ ttl: 0, staleWhileRevalidate: 0 }).getLiveSources();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });

    await testOps({ ttl: 60, staleWhileRevalidate: 0 }).getLiveSources();
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      next: { revalidate: 60 },
    });
  });

  test("falls back to the deployed content on an http error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: null });
    expect(error).toHaveBeenCalled();
  });

  test("falls back to the deployed content on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: null });
    expect(error).toHaveBeenCalled();
  });

  test("falls back to the deployed content on an unparseable response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: null });
    expect(error).toHaveBeenCalled();
  });

  test("ignores a response for a different commit", async () => {
    fetchMock.mockResolvedValue(
      liveResponse([livePatch("Committed")], {
        baseCommitSha: "someOtherCommit",
      }),
    );

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: null });
    expect(error).toHaveBeenCalled();
  });

  test("serves stale content when a refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(liveResponse([livePatch("Committed")]));
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const ops = testOps({ ttl: 0, staleWhileRevalidate: 0 });

    expect((await ops.getLiveSources()).sources).toEqual({
      [AUTHORS]: { name: "Committed" },
    });
    expect((await ops.getLiveSources()).sources).toEqual({
      [AUTHORS]: { name: "Committed" },
    });
  });

  test("an empty patch set still reports the head commit", async () => {
    fetchMock.mockResolvedValue(liveResponse([]));

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: "commit2" });
  });

  test("warns but does not fail when Val reports a degraded response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { headCommitSha: "commit9", baseCommitSha: "commit1", patches: [] },
        { headers: { "x-val-live-degraded": "unknown-base" } },
      ),
    );

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: "commit9" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown-base"));
  });

  test("a patch that does not apply degrades to the deployed content", async () => {
    fetchMock.mockResolvedValue(
      liveResponse([
        {
          ...livePatch("Committed"),
          // "name" is a string in the deployed sources, so this path does not exist
          patch: [{ op: "replace", path: ["name", "nested"], value: "x" }],
        },
      ]),
    );

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res.sources[AUTHORS]).toEqual({ name: "Deployed" });
    expect(error).toHaveBeenCalled();
  });

  test("a patch for a module that no longer exists does not fail the render", async () => {
    fetchMock.mockResolvedValue(
      liveResponse([
        {
          ...livePatch("Committed"),
          path: "/content/deleted.val.ts" as ModuleFilePath,
        },
      ]),
    );

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res.sources).toEqual({});
    expect(error).toHaveBeenCalled();
  });

  test("only committed patches are accepted", async () => {
    fetchMock.mockResolvedValue(
      liveResponse([
        // appliedAt is required on this route: an uncommitted patch must never
        // reach anonymous end users.
        { ...livePatch("Draft"), appliedAt: null } as unknown as ReturnType<
          typeof livePatch
        >,
      ]),
    );

    const res = await testOps({
      ttl: 60,
      staleWhileRevalidate: 0,
    }).getLiveSources();

    expect(res).toEqual({ sources: {}, headCommitSha: null });
    expect(error).toHaveBeenCalled();
  });
});
