import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

/**
 * `/publish-selected`: the site's half of Publish selected
 * (`docs/plans/remove-patch-groups.md`, Phase 4). The picked changes are
 * prepared over the site's head -- this build, the commits since it, the
 * selection -- moved into a `publish` proposal based on that head, and saved
 * there. Driven over the route, against a content service faked at `fetch`.
 */

const VAL_SECRET = "test-secret-at-least-32-chars-long!!";
const CONTENT = "http://content.test";
const NAME = "0123456789abcdef0123";
const PICKED = "11111111-1111-4111-8111-111111111111";
const LEFT = "22222222-2222-4222-8222-222222222222";
const SINCE = "33333333-3333-4333-8333-333333333333";
const PAGE = "/content/page.val.ts";
const PAGE_SOURCE = `import { c, s } from "../val.config";

export default c.define("/content/page.val.ts", s.object({ title: s.string(), text: s.string(), footer: s.string() }), { title: "Built", text: "Built", footer: "Built" });
`;

function setup(
  options: {
    /** What content answers the create with. */
    create?: { status: number; body: unknown };
    /** `undefined`: a content service that predates `headCommitSha`. */
    headCommitSha?: string | null | "absent";
  } = {},
) {
  const { c, s, config } = initVal({ project: "acme/site" });
  const route = "/api/val";
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const originalFetch = global.fetch;
  const answer = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const change = (
    patchId: string,
    path: string,
    value: string,
    applied?: string,
  ) => ({
    path: PAGE,
    patch: [{ op: "replace", path: [path], value }],
    patchId,
    authorId: "author-1",
    baseSha: "base",
    createdAt: "2026-10-17T00:00:00.000Z",
    applied: applied ? { commitSha: applied } : null,
  });
  const head = options.headCommitSha ?? "commit-2";

  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", url: href, body });
    const path = new URL(href).pathname;
    if (path.endsWith("/applicable/patches")) {
      return answer(200, {
        patches: [
          // Published after this build: the site's head has it, the build not.
          change(SINCE, "footer", "Published since the build", "commit-2"),
          change(PICKED, "title", "Picked"),
          change(LEFT, "text", "Left pending"),
        ],
        commits: [
          {
            commitSha: "commit-2",
            clientCommitSha: null,
            parentCommitSha: "commit-1",
            commitMessage: null,
            branch: "main",
            creator: "author-1",
            createdAt: "2026-10-17T00:00:00.000Z",
          },
        ],
        ...(head === "absent" ? {} : { headCommitSha: head }),
        project: { sourceMode: "managed", branch: "main", publishJobs: true },
      });
    }
    if (path.endsWith("/proposals") && init?.method === "POST") {
      const created = options.create ?? {
        status: 200,
        body: { proposal: { name: NAME }, movedPatchIds: [PICKED] },
      };
      return answer(created.status, created.body);
    }
    if (path.endsWith(`/proposals/${NAME}/save`)) {
      return answer(200, {
        updatedFiles: [],
        commit: "save-1",
        branch: `val/p/${NAME}`,
      });
    }
    return answer(404, { message: `unexpected ${href}` });
  }) as unknown as typeof fetch;

  const handler = createValApiRouter(
    route,
    createValServer(
      modules(config, [
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                PAGE,
                s.object({
                  title: s.string(),
                  text: s.string(),
                  footer: s.string(),
                }),
                { title: "Built", text: "Built", footer: "Built" },
              ),
            }),
        },
      ]),
      route,
      {
        mode: "proxy",
        apiKey: "test-api-key",
        valSecret: VAL_SECRET,
        valContentUrl: CONTENT,
        project: "acme/site",
        disableCache: true,
        versions: { core: "1.0.0", next: "1.0.0" },
        projectSource: { [PAGE.slice(1)]: PAGE_SOURCE },
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
    calls,
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

const request = (url: string, json: unknown) =>
  fakeRequest({
    method: "POST",
    url: new URL(`http://localhost/api/val${url}`),
    headers: new Headers({
      Cookie: `val_session=${encodeURIComponent(session)}`,
    }),
    json,
  });

async function publishSelected(
  handler: ReturnType<typeof setup>["handler"],
  patchIds: string[] = [PICKED],
) {
  // As every Studio does first: the answer says what the project expects.
  await handler(
    request("/stat", { sourcesSha: "s", schemaSha: "s", baseSha: "b" }),
  );
  return handler(
    request("/publish-selected", {
      patchIds,
      displayName: "Published together",
      requestId: "press-1",
    }),
  );
}

const callsTo = (calls: ReturnType<typeof setup>["calls"], suffix: string) =>
  calls.filter(
    (c) => c.method === "POST" && new URL(c.url).pathname.endsWith(suffix),
  );

describe("/publish-selected", () => {
  test("moves the selection into a publish proposal based on the head it was prepared over", async () => {
    const { handler, calls, restore } = setup();
    try {
      const res = await publishSelected(handler);
      expect(res.status).toBe(200);
      expect("json" in res && res.json).toEqual({ proposal: NAME });
      expect(callsTo(calls, "/proposals").map((c) => c.body)).toEqual([
        {
          displayName: "Published together",
          kind: "publish",
          patchIds: [PICKED],
          requestId: "press-1",
          base: "commit-2",
        },
      ]);
    } finally {
      restore();
    }
  });

  test("saves the selection there, over the site's head: what was published since the build, and nothing left pending", async () => {
    const { handler, calls, restore } = setup();
    try {
      expect((await publishSelected(handler)).status).toBe(200);
      const [save] = callsTo(calls, `/proposals/${NAME}/save`);
      const saved = save?.body as {
        appliedPatches: Record<string, string[]>;
        modules: Record<string, { source: unknown }>;
      };
      expect(saved.appliedPatches).toEqual({ [PAGE]: [PICKED] });
      expect(saved.modules[PAGE]?.source).toEqual({
        title: "Picked",
        text: "Built",
        footer: "Published since the build",
      });
    } finally {
      restore();
    }
  });

  test("the site published in between: refused, and nothing is saved", async () => {
    const { handler, calls, restore } = setup({
      create: {
        status: 409,
        body: {
          message:
            "Conflict: the base is not the site's head. A proposal based on an older version of the site is not supported yet.",
        },
      },
    });
    try {
      const res = await publishSelected(handler);
      expect(res.status).toBe(409);
      expect("json" in res && res.json).toEqual({
        message:
          "The site was published while this was being prepared. Nothing was published: publish them again.",
        headMoved: true,
      });
      expect(callsTo(calls, `/proposals/${NAME}/save`)).toEqual([]);
    } finally {
      restore();
    }
  });

  test("any other refusal is content's, in its words, and not marked as one to press again", async () => {
    const { handler, calls, restore } = setup({
      create: {
        status: 409,
        body: { message: "Conflict: these changes are in a proposal already" },
      },
    });
    try {
      const res = await publishSelected(handler);
      expect(res.status).toBe(409);
      expect("json" in res && res.json).toEqual({
        message: "Conflict: these changes are in a proposal already",
      });
      expect(callsTo(calls, `/proposals/${NAME}/save`)).toEqual([]);
    } finally {
      restore();
    }
  });

  test("a content service that cannot say the head is not asked to move anything", async () => {
    const { handler, calls, restore } = setup({ headCommitSha: "absent" });
    try {
      expect((await publishSelected(handler)).status).toBe(409);
      expect(callsTo(calls, "/proposals")).toEqual([]);
    } finally {
      restore();
    }
  });

  test("a selected change that is no longer there is refused before anything moves", async () => {
    const { handler, calls, restore } = setup();
    try {
      const gone = "44444444-4444-4444-8444-444444444444";
      expect((await publishSelected(handler, [PICKED, gone])).status).toBe(409);
      expect(callsTo(calls, "/proposals")).toEqual([]);
    } finally {
      restore();
    }
  });
});
