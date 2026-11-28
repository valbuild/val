import type { ValServerConfig } from "@valbuild/server";
import { CTX, setup } from "./toolsFixture";
import { siteErrorsTool } from "./siteErrors";

/**
 * `get_site_errors`: registered as a read tool, asks Val Build with the
 * project's credential, and turns every way of getting no answer into
 * something an agent can act on. Val Build is a fake `fetch`.
 */

const answer = {
  status: "ok",
  errors: [
    {
      fingerprint: "0123456789abcdef",
      kind: "exception",
      level: "error",
      message: "TypeError: x is undefined",
      stack: null,
      path: "/blog/hello",
      method: "GET",
      status: 500,
      count: 3,
      firstSeen: "2026-10-20T00:00:00.000Z",
      lastSeen: "2026-10-21T00:00:00.000Z",
      firstBuild: "b1",
      lastBuild: "b1",
      proposal: null,
    },
  ],
  retentionDays: 7,
  liveBuild: "b1",
  dropped: false,
};

function valBuild(status: number, body: unknown) {
  const seen: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
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
  return siteErrorsTool(fetchImpl).handler(args, {
    ...deps,
    config: configOf(deps.config),
  });
}

describe("get_site_errors", () => {
  test("is registered, described, and read-only", () => {
    const { tools } = setup();
    const definition = tools.list().find((d) => d.name === "get_site_errors");
    expect(definition?.description).toContain("not-hosted");
    expect(definition?.annotations?.readOnlyHint).toBe(true);
  });

  test("reads the hosted site's errors with the app's API key", async () => {
    const { fetchImpl, seen } = valBuild(200, answer);
    expect(await call(hosted, fetchImpl, { limit: 5 })).toEqual({
      status: "ok",
      data: answer,
    });
    expect(seen[0]?.url).toBe(
      "https://content.example/v1/acme/site/site-errors?limit=5",
    );
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer key-1");
  });

  test("says what to do when the project is not connected, and asks nothing", async () => {
    const { fetchImpl, seen } = valBuild(200, answer);
    // The fixture itself: fs mode, and no `project` in its config.
    expect(await call((base) => base, fetchImpl)).toMatchObject({
      status: "error",
      code: "unsupported",
      message: expect.stringContaining("val.config"),
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
