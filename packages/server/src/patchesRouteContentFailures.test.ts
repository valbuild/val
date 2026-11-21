import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

/**
 * What `/patches` tells the Studio when the content service behind it fails
 * part of the way.
 *
 * Two answers here used to say something false, and the Studio believed both:
 *
 * - A `DELETE` whose call to the content service FAILED answered 200 with
 *   every id as deleted. The Studio forgot patches that still existed: a
 *   reload brought the change back, and the next publish shipped it.
 * - A `PUT` batch is one content-service write per patch, so another writer's
 *   patch can land between two of ours. The 409 for the second said nothing
 *   about the first, which WAS saved, so the Studio sent it again -- and the
 *   content service refuses a patch id it already has, so that retry could
 *   never succeed and the edit after it was never saved.
 *
 * Driven through the real router in http mode, with only `fetch` faked: the
 * content service is the edge.
 */
describe("/patches when the content service fails part of the way", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();
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
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

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
  const session = () =>
    new Headers({
      Cookie: `val_session=${encodeJwt(SESSION, "test-secret")}`,
    });

  /** The content service answers the n-th request with `answers[n]`. */
  function contentAnswers(answers: { status: number; body: unknown }[]) {
    let n = 0;
    const content: typeof fetch = async () => {
      const answer = answers[Math.min(n++, answers.length - 1)];
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "Content-Type": "application/json" },
      });
    };
    global.fetch = content;
  }

  const FIRST = "11111111-1111-4111-8111-111111111111";
  const SECOND = "22222222-2222-4222-8222-222222222222";
  const HEAD = "33333333-3333-4333-8333-333333333333";

  describe("DELETE", () => {
    const discard = () => {
      const url = new URL(`http://localhost:3000${route}/patches`);
      url.searchParams.append("id", FIRST);
      return makeRoute()(
        fakeRequest({
          method: "DELETE",
          url,
          headers: session(),
          json: { reportHeadVersion: true },
        }),
      );
    };

    test("a content service that answers 503 deleted nothing", async () => {
      contentAnswers([
        { status: 503, body: { message: "Service Unavailable" } },
      ]);
      const res = await discard();
      expect(res.status).toBe(502);
      expect(JSON.stringify("json" in res ? res.json : null)).not.toContain(
        "deleted",
      );
    });

    test("a content service that cannot be reached deleted nothing", async () => {
      const unreachable: typeof fetch = async () => {
        throw new TypeError("fetch failed");
      };
      global.fetch = unreachable;
      const res = await discard();
      expect(res.status).toBe(502);
    });

    test("a delete the content service did is still a 200", async () => {
      contentAnswers([
        { status: 200, body: { deleted: [FIRST], headVersions: { main: 4 } } },
      ]);
      const res = await discard();
      expect(res.status).toBe(200);
      expect("json" in res ? res.json : null).toEqual({
        deleted: [FIRST],
        headVersion: 4,
      });
    });
  });

  describe("PUT", () => {
    test("a 409 on the second patch reports the first as saved", async () => {
      contentAnswers([
        {
          status: 200,
          body: {
            patchId: FIRST,
            createdAt: "2026-11-21T00:00:00.000Z",
            headVersion: 7,
          },
        },
        {
          status: 409,
          body: {
            statusCode: 409,
            message: "Conflict: parent patch is not the head of the chain",
          },
        },
      ]);
      const res = await makeRoute()(
        fakeRequest({
          method: "PUT",
          url: new URL(`http://localhost:3000${route}/patches`),
          headers: session(),
          json: {
            patches: [FIRST, SECOND].map((patchId) => ({
              path: "/content/page.val.ts",
              patchId,
              patch: [{ op: "replace", path: [], value: patchId }],
            })),
            parentRef: { type: "patch", patchId: HEAD },
          },
        }),
      );
      expect(res.status).toBe(409);
      expect("json" in res ? res.json : null).toMatchObject({
        type: "patch-head-conflict",
        newPatchIds: [FIRST],
        parentRef: { type: "patch", patchId: FIRST },
        headVersion: 7,
      });
    });
  });
});
