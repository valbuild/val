import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

/**
 * `/publish-job-prepare`: the Val server's half of a publish job's prepare
 * (valbuild/home, docs/app-mode.md, "Publishing is a queued job").
 *
 * The tab asks it to render the job's changes into sources, and it hands
 * content the job's archive. Driven here over the route, against a content
 * service faked at `fetch`, in both source modes -- because the pure splitter
 * `jobPrepare.test.ts` covers is the smallest part of what can go wrong: which
 * patches are fetched, in which order, what reaches content's prepare, and
 * what the tab is told when content refuses it.
 */

const VAL_SECRET = "test-secret-at-least-32-chars-long!!";
const CONTENT = "http://content.test";
const PATCH_A = "11111111-1111-4111-8111-111111111111";
const PATCH_B = "22222222-2222-4222-8222-222222222222";
const PAGE = "/content/page.val.ts";
const PAGE_SOURCE = `import { c, s } from "../val.config";

export default c.define("/content/page.val.ts", s.string(), "hello");
`;

type Mode = "managed" | "connected";

function setup(options: {
  mode: Mode;
  /** The chain content answers with. */
  patches: Array<{ patchId: string; applied?: string }>;
  /** What content answers the prepare with. */
  prepare?: { status: number; body: unknown };
}) {
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

  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", url: href, body });
    if (href.includes("/applicable/patches")) {
      const wanted = new URL(href).searchParams.getAll("patch_id");
      return answer(200, {
        patches: options.patches
          .filter((p) => wanted.length === 0 || wanted.includes(p.patchId))
          .map((p) => ({
            path: PAGE,
            patch: [{ op: "replace", path: [], value: `v-${p.patchId}` }],
            patchId: p.patchId,
            authorId: "author-1",
            baseSha: "base",
            createdAt: "2026-09-30T00:00:00.000Z",
            applied: p.applied ? { commitSha: p.applied } : null,
          })),
        commits: [],
        project: {
          sourceMode: options.mode,
          branch: "main",
          publishJobs: true,
        },
      });
    }
    if (href.endsWith("/publish-token")) {
      return answer(200, {
        token: "val_pt_test",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    if (href.includes("/publish-jobs/") && href.endsWith("/prepare")) {
      const prepared = options.prepare ?? {
        status: 200,
        body: {
          job: { id: "J1", step: "build", base: null, patches: [PATCH_A] },
        },
      };
      return answer(prepared.status, prepared.body);
    }
    if (href.includes("/files?")) {
      // A connected project's committed source, read from content.
      return answer(200, {
        files: [
          {
            filePath: PAGE,
            location: "repo",
            commitSha: "deployed-sha",
            value: Buffer.from(PAGE_SOURCE).toString("base64"),
          },
        ],
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
              default: c.define(PAGE, s.string(), "hello"),
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
        ...(options.mode === "connected"
          ? { gitCommit: "deployed-sha", gitBranch: "main" }
          : { projectSource: { [PAGE.slice(1)]: PAGE_SOURCE } }),
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

const request = (url: string, json?: unknown) =>
  fakeRequest({
    method: json === undefined ? "GET" : "POST",
    url: new URL(`http://localhost/api/val${url}`),
    headers: new Headers({
      Cookie: `val_session=${encodeURIComponent(session)}`,
    }),
    ...(json === undefined ? {} : { json }),
  });

/**
 * Prepare the job, after one read of the patches: the route asks what the
 * project expects of its publisher from the answer every poll already got.
 */
async function prepare(
  handler: ReturnType<typeof setup>["handler"],
  patchIds: string[],
) {
  await handler(
    request("/stat", { sourcesSha: "s", schemaSha: "s", baseSha: "b" }),
  );
  return handler(
    request("/publish-job-prepare", { jobId: "J1", tab: "ada", patchIds }),
  );
}

const prepareCalls = (calls: ReturnType<typeof setup>["calls"]) =>
  calls.filter((c) => c.url.endsWith("/prepare"));

describe.each<Mode>(["managed", "connected"])("%s", (mode) => {
  test("hands content the job's archive, and the tab what to build", async () => {
    const { handler, calls, restore } = setup({
      mode,
      patches: [{ patchId: PATCH_A }],
    });
    try {
      const res = await prepare(handler, [PATCH_A]);
      expect(res.status).toBe(200);
      const [sent] = prepareCalls(calls);
      expect(sent?.url).toBe(`${CONTENT}/v1/publish-jobs/J1/prepare`);
      expect(sent?.body).toMatchObject({ tab: "ada" });
      // The job's change, rendered into the module's source: what content
      // archives, and -- connected -- what it pushes.
      const archived = (
        sent?.body as { patchedSourceFiles?: Record<string, string | null> }
      ).patchedSourceFiles;
      expect(Object.values(archived ?? {}).join("")).toContain(`v-${PATCH_A}`);
      if (mode === "connected") {
        // Content pushes the job on top of the branch; the build is CI's.
        expect(sent?.body).toMatchObject({ gitCommit: "deployed-sha" });
      }
    } finally {
      restore();
    }
  });

  test("a change that is no longer there is refused before content is asked", async () => {
    const { handler, calls, restore } = setup({
      mode,
      patches: [{ patchId: PATCH_A }],
    });
    try {
      const res = await prepare(handler, [PATCH_A, PATCH_B]);
      expect(res.status).toBe(409);
      expect(prepareCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test("content refusing the prepare reaches the tab as content's answer", async () => {
    const { handler, restore } = setup({
      mode,
      patches: [{ patchId: PATCH_A }],
      prepare: {
        status: 409,
        body: { message: "A push changed this site's content files." },
      },
    });
    try {
      const res = await prepare(handler, [PATCH_A]);
      expect(res.status).toBe(409);
      expect(JSON.stringify(res)).toContain(
        "A push changed this site's content files.",
      );
    } finally {
      restore();
    }
  });

  test("content failing the prepare is a 502, which the tab reads as counted", async () => {
    const { handler, restore } = setup({
      mode,
      patches: [{ patchId: PATCH_A }],
      prepare: { status: 500, body: { message: "database down" } },
    });
    try {
      const res = await prepare(handler, [PATCH_A]);
      expect(res.status).toBe(502);
    } finally {
      restore();
    }
  });
});
