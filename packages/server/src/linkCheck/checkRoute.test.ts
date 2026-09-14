import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "../ValRouter";
import { encodeJwt } from "../jwt";
import { fakeRequest } from "../fakeRequest";

/**
 * The route around the prober: who may call it, and what it refuses to be
 * asked.
 *
 * The prober's own behaviour — the deny list, redirects, the fallback — is in
 * `addressGuard.test.ts` and `probeUrl.test.ts`. What is left here is the
 * boundary: an endpoint that makes outbound requests on request is one an
 * anonymous caller must not be able to reach, and one that must not accept an
 * unbounded list.
 */
describe("/external-urls/check", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();

  const makeRoute = (options: Record<string, unknown>) =>
    createValApiRouter(
      route,
      createValServer(
        modules(config, [
          {
            def: () =>
              Promise.resolve({
                default: c.define("/content/x.val.ts", s.object({}), {}),
              }),
          },
        ]),
        route,
        { disableCache: true, ...options },
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

  const onRoute = makeRoute({});

  const call = (urls: unknown, session = true) =>
    onRoute(
      fakeRequest({
        method: "POST",
        url: new URL(`http://localhost:3000${route}/external-urls/check`),
        json: { urls },
        headers: new Headers(
          session ? { Cookie: `val_session=${encodeJwt({}, "")}` } : {},
        ),
      }),
    );

  /*
   * An HTTP-mode server, which is the only mode where auth can be tested at
   * all: `getAuth` returns `{ error: null }` in FS mode by design, because
   * local dev has no login — see `historyFilesAuth.test.ts`, which sets up the
   * same pair for the file routes. An `apiKey` + `valSecret` is what puts the
   * server in http mode; nothing here reaches the content service, because
   * auth is refused before any request would be made.
   */
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

  const callInHttpMode = (withSession: boolean) =>
    makeRoute({
      apiKey: "test-api-key",
      valSecret: "test-secret",
      project: "test-org/test-project",
      valContentUrl: "http://localhost:9999",
      versions: { core: "0.0.0-test", next: "0.0.0-test" },
    })(
      fakeRequest({
        method: "POST",
        url: new URL(`http://localhost:3000${route}/external-urls/check`),
        // Loopback, so a bug that let this run would still send nothing.
        json: { urls: ["http://127.0.0.1:1/"] },
        headers: withSession
          ? new Headers({
              Cookie: `val_session=${encodeJwt(
                {
                  sub: "ada",
                  exp: Math.floor(Date.now() / 1000) + 3600,
                  token: "test-token",
                  org: "test-org",
                  project: "test-project",
                },
                "test-secret",
              )}`,
            })
          : new Headers(),
      }),
    );

  test("refuses a caller with no session", async () => {
    expect((await callInHttpMode(false)).status).toBe(401);
  });

  /*
   * The other half of the claim: it is the SESSION being checked, and not the
   * request failing for an unrelated reason that would make the test above
   * pass however the handler behaved.
   */
  test("gets past auth with one", async () => {
    expect((await callInHttpMode(true)).status).not.toBe(401);
  });

  test("refuses an empty list", async () => {
    const res = await call([]);
    expect(res.status).toBe(400);
  });

  test("refuses a list longer than a batch", async () => {
    // Every URL is an outbound connection. A body is not allowed to ask this
    // server to open an unbounded number of them.
    const res = await call(
      Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`),
    );
    expect(res.status).toBe(400);
  });

  test("answers about every URL it was given, keyed as it was given them", async () => {
    // Loopback and a non-URL: neither leaves the machine, so this asserts the
    // wiring without depending on the network.
    const urls = ["http://127.0.0.1:1/", "not-a-url"];
    const res = await call(urls);
    expect(res.status).toBe(200);
    const json =
      "json" in res
        ? (res.json as { results: Record<string, { kind: string }> })
        : null;
    expect(Object.keys(json?.results ?? {})).toEqual(urls);
    expect(json?.results["http://127.0.0.1:1/"].kind).toBe("unreachable");
    expect(json?.results["not-a-url"].kind).toBe("skipped");
  });
});
