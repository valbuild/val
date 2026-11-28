import type { ValServerConfig } from "@valbuild/server";
import { CTX, setup } from "./toolsFixture";
import { siteLogsTool } from "./siteLogs";

/**
 * `get_logs`: registered as a read tool, asks Val Build with the project's
 * credential and what the agent narrowed it to, and leaves the chart out of
 * what it hands back. Val Build is a fake `fetch`.
 */

const request = {
  id: "ray1",
  time: "2026-11-26T12:00:00.000Z",
  method: "GET",
  path: "/blog/hello",
  status: 500,
  durationMs: 90,
  cpuMs: 5,
  outcome: "ok",
  build: "b1",
  proposal: null,
  lines: [
    {
      time: "2026-11-26T12:00:00.050Z",
      level: "error",
      message: "Render failed",
      stack: null,
    },
  ],
  errorFingerprint: "0123456789abcdef",
};
const answer = {
  status: "ok",
  requests: [request],
  cursor: "41",
  histogram: {
    start: "2026-11-26T11:00:00.000Z",
    bucketMs: 60_000,
    buckets: [{ error: 1, warn: 0, info: 0 }],
  },
  liveBuild: "b1",
  retentionHours: 1,
  truncated: false,
};

function valBuild(status: number, body: unknown) {
  const seen: { url: URL; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, seen };
}

/** The fixture's project, as a hosted app runs it: http mode, with an API key. */
const hosted = (base: ValServerConfig): ValServerConfig => ({
  route: base.route,
  valContentUrl: "https://content.example",
  mode: "http",
  apiKey: "key-1",
  project: "acme/site",
  config: base.config,
});

async function call(
  configOf: (base: ValServerConfig) => ValServerConfig,
  fetchImpl: typeof fetch,
  args: unknown = {},
) {
  const { depsFor } = setup();
  const deps = await depsFor(CTX);
  return siteLogsTool(fetchImpl).handler(args, {
    ...deps,
    config: configOf(deps.config),
  });
}

describe("get_logs", () => {
  test("is registered, described, and read-only", () => {
    const { tools } = setup();
    const definition = tools.list().find((d) => d.name === "get_logs");
    expect(definition?.description).toContain("status:5xx");
    expect(definition?.annotations?.readOnlyHint).toBe(true);
  });

  test("reads the hosted site's requests with the app's API key, as narrowed, without the chart", async () => {
    const { fetchImpl, seen } = valBuild(200, answer);
    const result = await call(hosted, fetchImpl, {
      search: "status:5xx",
      levels: ["error"],
      minutes: 10,
      limit: 5,
    });
    const { histogram: _histogram, ...listed } = answer;
    expect(result).toEqual({ status: "ok", data: listed });
    const url = seen[0]?.url;
    expect(url?.pathname).toBe("/v1/acme/site/logs");
    expect(url?.searchParams.get("q")).toBe("status:5xx");
    expect(url?.searchParams.get("levels")).toBe("error");
    expect(url?.searchParams.get("limit")).toBe("5");
    expect(url?.searchParams.get("live")).toBeNull();
    const since = Date.parse(url?.searchParams.get("since") ?? "");
    expect(Date.now() - since).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(Date.now() - since).toBeLessThan(10 * 60_000 + 5000);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer key-1");
  });

  test("a site Val Build does not host says so", async () => {
    const { fetchImpl } = valBuild(200, { status: "not-hosted" });
    expect(await call(hosted, fetchImpl)).toEqual({
      status: "ok",
      data: { status: "not-hosted" },
    });
  });

  test("says what to do when the project is not connected, and asks nothing", async () => {
    const { fetchImpl, seen } = valBuild(200, answer);
    expect(await call((base) => base, fetchImpl)).toMatchObject({
      status: "error",
      code: "unsupported",
    });
    expect(seen).toEqual([]);
  });

  test("an outage is an error that says trying again helps", async () => {
    const { fetchImpl } = valBuild(502, { message: "loader down" });
    expect(await call(hosted, fetchImpl)).toMatchObject({
      status: "error",
      code: "internal",
      message: expect.stringContaining("trying again"),
    });
  });
});
