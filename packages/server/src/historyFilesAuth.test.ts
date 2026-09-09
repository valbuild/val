import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

/**
 * Which of the two file routes asks for a session, and which cannot.
 *
 * They look like the same endpoint and are not, so the difference is pinned
 * here rather than left to be tidied away in either direction:
 *
 *   /files          serves a DRAFT image to the app's own backend during Next
 *                   image optimisation - backend-to-backend, no cookies. It
 *                   cannot require auth without blacking out every unpublished
 *                   image. What stands in for the credential is `patch_id`,
 *                   which is a UUID.
 *
 *   /history/files  serves a file at a COMMIT SHA, which is published - `git
 *                   log`, the GitHub UI, every PR - so it is no substitute for
 *                   a credential. Nothing fetches it server-side either: both
 *                   callers are the Studio in a browser holding the session
 *                   cookie. So it asks.
 *
 * See architecture/media.md, "Why /files has no auth, and /history/files does".
 */
describe("auth on the two file routes", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();

  /*
   * Proxy mode reads these from the environment rather than from options, and
   * refuses to start without them. Nothing here reaches the content service -
   * auth is refused before any request would be made - so the values only have
   * to exist. Restored afterwards so a shared jest worker is left as it was.
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
  /*
   * An HTTP-mode server, which is the only mode where this can be tested at
   * all: `getAuth` returns `{ error: null }` in FS mode by design, because
   * local dev has no login. An `apiKey` + `valSecret` is what puts the server
   * in http mode; nothing here reaches the content service, because auth is
   * refused before any request would be made.
   */
  const makeRoute = () =>
    createValApiRouter(
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
          valSecret: "test-secret",
          project: "test-org/test-project",
          valContentUrl: "http://localhost:9999",
          // Normally read off the installed packages; nothing here depends on
          // the values, only on proxy mode being willing to start at all.
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

  const SESSION = {
    sub: "ada",
    exp: Math.floor(Date.now() / 1000) + 3600,
    token: "test-token",
    org: "test-org",
    project: "test-project",
  };

  const get = (path: string, withSession: boolean) =>
    makeRoute()(
      fakeRequest({
        method: "GET",
        url: new URL(`http://localhost:3000${route}${path}`),
        headers: withSession
          ? new Headers({
              Cookie: `val_session=${encodeJwt(SESSION, "test-secret")}`,
            })
          : new Headers(),
      }),
    );

  const HISTORY_FILE =
    "/history/files?commit_sha=abc123&path=content/page.val.ts";

  test("/history/files refuses a request with no session", async () => {
    const res = await get(HISTORY_FILE, false);
    expect(res.status).toBe(401);
  });

  /*
   * The other half of the claim: it is the SESSION being checked, not the
   * request failing for some unrelated reason that would make the test above
   * pass no matter what. With a session it gets past auth and fails on its
   * merits - fs mode has git rather than a commit archive, so it answers
   * `not-supported-in-fs-mode` - which is any status except 401.
   */
  test("/history/files gets past auth with one", async () => {
    const res = await get(HISTORY_FILE, true);
    expect(res.status).not.toBe(401);
  });

  /*
   * And /files must NOT start asking. If this ever goes red, the Next image
   * optimiser can no longer read draft images and every unpublished image in
   * the Studio goes blank - which is not a symptom anyone would trace back to
   * an auth check.
   */
  test("/files serves a published file without a session", async () => {
    const res = await get("/files/public/val/does-not-exist.png", false);
    expect(res.status).not.toBe(401);
  });
});
