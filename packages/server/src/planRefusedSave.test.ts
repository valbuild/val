import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

/**
 * A save Val Build refuses for the project's plan, through this app's proxy.
 *
 * The content service answers `POST /patches` with a 403 that says why as data
 * (`refusalError` in valbuild/home's `billing/projectLimits.ts`). It used to
 * come out of `PUT /patches` as a 400 `patch-error`, which the Studio reads as
 * "this patch is bad" and drops: an edit thrown away over a limit an owner can
 * lift with one click. It has to come out as the 403 it was, with the reason
 * and with what of the batch WAS saved -- the Free week can run out between
 * two patches of one request.
 */

const VAL_SECRET = "test-secret-at-least-32-chars-long!!";
const API_KEY = "test-api-key";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

const REFUSAL = {
  statusCode: 403,
  message:
    "site has used this week's 1,000 changes on the Free plan. Everything saved so far is kept.",
  error: {
    code: "limit:changes",
    fix: "upgrade",
    until: "2026-10-20T10:00:00.000Z",
    billingUrl: "https://admin.val.build/orgs/acme/billing",
  },
};

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: "",
  headers: {
    get: (name: string) =>
      name.toLowerCase() === "content-type" ? "application/json" : null,
  },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function setup() {
  const { c, s, config } = initVal({ project: "acme/site" });
  const route = "/api/val";
  const saved: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL, init?: { body?: string }) => {
    const href = String(url);
    if (href.endsWith("/patches") && init?.body !== undefined) {
      const body: unknown = JSON.parse(init.body);
      const patchId =
        typeof body === "object" && body !== null && "patchId" in body
          ? String(body.patchId)
          : "";
      // The first patch is the week's last change; the second is refused.
      if (saved.length === 0) {
        saved.push(patchId);
        return json(200, { patchId });
      }
      return json(403, REFUSAL);
    }
    return json(200, { patches: [], commits: [] });
  }) as unknown as typeof fetch;

  const handler = createValApiRouter(
    route,
    createValServer(
      modules(config, [
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                "/content/page.val.ts",
                s.object({ title: s.string() }),
                { title: "hello" },
              ),
            }),
        },
      ]),
      route,
      {
        mode: "proxy",
        apiKey: API_KEY,
        valSecret: VAL_SECRET,
        gitCommit: "commit-sha",
        gitBranch: "main",
        project: "acme/site",
        disableCache: true,
        versions: { core: "1.0.0", next: "1.0.0" },
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
  return {
    handler,
    saved,
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}

const session = encodeJwt(
  {
    sub: "author-1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    token: "content-api-token",
    org: "acme",
    project: "acme/site",
  },
  VAL_SECRET,
);

test("a save refused for the plan is a 403 with the reason, not a bad patch", async () => {
  const { handler, saved, restore } = setup();
  try {
    const res = await handler(
      fakeRequest({
        method: "PUT",
        url: new URL("http://localhost/api/val/patches"),
        headers: new Headers({
          Cookie: `val_session=${encodeURIComponent(session)}`,
        }),
        json: {
          parentRef: { type: "head", headBaseSha: "base" },
          patches: [FIRST, SECOND].map((patchId, index) => ({
            path: "/content/page.val.ts",
            patchId,
            patch: [{ op: "replace", path: ["title"], value: `edit ${index}` }],
          })),
        },
      }),
    );

    expect(saved).toEqual([FIRST]);
    expect(res.status).toBe(403);
    expect("json" in res && res.json).toEqual({
      type: "plan-refused",
      message: REFUSAL.message,
      error: REFUSAL.error,
      // The patch the service took before refusing, as a 200 would report it,
      // so the Studio marks it saved and names it as the next parent.
      newPatchIds: [FIRST],
      parentRef: { type: "patch", patchId: FIRST },
    });
  } finally {
    restore();
  }
});
