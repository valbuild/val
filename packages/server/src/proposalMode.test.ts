import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import type { AuthorId, PreparedCommit } from "./ValOps";
import {
  proposalFromEnv,
  proposalSnapshot,
  type ValProposal,
} from "./proposal";

const { s, c, config } = initVal();

/*
 * A proposal's address: valbuild/home `docs/proposals.md`, "Saving".
 *
 * The server there reads and writes the PROPOSAL's branch, never the site's;
 * names the proposal's last save as its position, so that save is not handed
 * back to be applied again; commits a save to the proposal; has no patch
 * groups; and starts every read from the proposal's saved Source -- the
 * snapshot -- instead of the bundle's.
 */

const PAGE = "/app/page.val.ts" as ModuleFilePath;
const FOOTER = "/app/footer.val.ts" as ModuleFilePath;
const modules = [
  {
    def: async () => ({
      default: c.define(PAGE, s.object({ title: s.string() }), {
        title: "From the bundle",
      }),
    }),
  },
  {
    def: async () => ({
      default: c.define(FOOTER, s.object({ text: s.string() }), {
        text: "Footer from the bundle",
      }),
    }),
  },
];

const NAME = "0123456789abcdef0123";
const proposal = (commit: string | null): ValProposal => ({
  name: NAME,
  branch: `val/p/${NAME}`,
  commit,
  modules: { [PAGE]: { title: "Saved in the proposal" } },
  files: {
    "app/page.val.ts": 'export default c.define("/app/page.val.ts", s, {});\n',
  },
});

const sent: Array<{
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}> = [];
beforeEach(() => {
  sent.length = 0;
  jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(JSON.stringify({ message: "stub" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

const ops = (
  p: ValProposal | undefined,
  git: { commit: string; branch: string } | null = null,
) =>
  new ValOpsHttp(
    "https://content.example",
    "org/project",
    git,
    { apiKey: "test" },
    { config, modules },
    {
      config,
      publishJob: "J-1",
      publishBuild: "base-build",
      ...(p !== undefined ? { proposal: p } : {}),
    },
  );

describe("the position a proposal's server names", () => {
  test("its branch and its save -- not a job, whatever the build was made for", async () => {
    const o = ops(proposal("save-2"));
    await o.fetchPatchesInternal({ excludePatchOps: true }).catch(() => {});
    await o.getWebSocketNonce("profile");
    const overlay = new URL(sent[0]!.url);
    expect(overlay.pathname).toContain("/applicable/patches");
    expect(overlay.searchParams.get("branch")).toBe(`val/p/${NAME}`);
    expect(overlay.searchParams.get("commit")).toBe("save-2");
    expect(overlay.searchParams.has("job")).toBe(false);
    expect(sent[1]!.body).toMatchObject({
      profileId: "profile",
      branch: `val/p/${NAME}`,
      commitSha: "save-2",
    });
    expect(sent[1]!.body).not.toHaveProperty("job");
  });

  test("before its first save, its branch alone: everything on it is new", async () => {
    const o = ops(proposal(null));
    await o.fetchPatchesInternal({ excludePatchOps: true }).catch(() => {});
    const overlay = new URL(sent[0]!.url);
    expect(overlay.searchParams.get("branch")).toBe(`val/p/${NAME}`);
    expect(overlay.searchParams.has("commit")).toBe(false);
    expect(overlay.searchParams.has("job")).toBe(false);
  });

  test("even a build of a git commit names the proposal, not the commit", async () => {
    const o = ops(proposal("save-2"), {
      commit: "c".repeat(40),
      branch: "main",
    });
    await o.fetchPatchesInternal({ excludePatchOps: true }).catch(() => {});
    const overlay = new URL(sent[0]!.url);
    expect(overlay.searchParams.get("branch")).toBe(`val/p/${NAME}`);
    expect(overlay.searchParams.get("commit")).toBe("save-2");
  });
});

describe("writing in a proposal", () => {
  test("a patch is filed on the proposal's branch", async () => {
    const o = ops(proposal("save-2"));
    await o
      .createPatch(
        PAGE,
        [{ op: "replace", path: ["title"], value: "Edited" }],
        crypto.randomUUID() as PatchId,
        { type: "head", headBaseSha: await o.getBaseSha() },
        null,
        "author" as AuthorId,
      )
      .catch(() => {});
    const post = sent.find(
      (r) =>
        r.method === "POST" && new URL(r.url).pathname.endsWith("/patches"),
    );
    expect(post?.body).toMatchObject({ branch: `val/p/${NAME}` });
    expect(post?.body).not.toHaveProperty("commit");
  });

  test("a save is a commit on the proposal, at its own route", async () => {
    const o = ops(proposal("save-2"));
    const prepared: PreparedCommit = {
      patchedSourceFiles: {},
      patchedJsonEntries: {},
      previousSourceFiles: {},
      moduleVersions: {},
      partiallyPatchedSourceFiles: {},
      patchedBinaryFilesDescriptors: {},
      appliedPatches: {},
      hasErrors: false,
      sourceFilePatchErrors: {},
      binaryFilePatchErrors: {},
      unappliablePatches: {},
      skippedPatches: {},
      triedPatches: {},
    };
    await o
      .commit(prepared, "Save", "author" as AuthorId, "/public/val")
      .catch(() => {});
    expect(sent.map((r) => new URL(r.url).pathname)).toContain(
      `/v1/org/project/proposals/${NAME}/save`,
    );
    expect(sent.map((r) => new URL(r.url).pathname)).not.toContain(
      "/v1/org/project/commit",
    );
  });

  test("there are no patch groups: the proposal is one unit", async () => {
    const o = ops(proposal("save-2"));
    expect(await o.getPatchGroups({ fresh: true })).toEqual({
      status: "unsupported",
    });
    expect(sent).toHaveLength(0);
    // And Publish is not a publish job here: a proposal's merge is.
    expect(o.publishesAsJobs()).toBe(false);
  });
});

describe("the snapshot", () => {
  test("replaces the bundle's Source for what the proposal saved, and only that", async () => {
    const o = ops(proposal("save-2"));
    const sources = await o.getBaseSources();
    expect(sources[PAGE]).toEqual({ title: "Saved in the proposal" });
    expect(sources[FOOTER]).toEqual({ text: "Footer from the bundle" });
  });

  test("moves the base SHA with it, so nothing takes it for the bundle's", async () => {
    const site = await ops(undefined).getBaseSha();
    const atProposal = await ops(proposal("save-2")).getBaseSha();
    expect(atProposal).not.toBe(site);
  });

  test("keeps the site's Source for what it replaced, to compare the proposal with", async () => {
    const o = ops(proposal("save-2"));
    expect(await o.siteSourcesUnderSnapshot()).toEqual({
      [PAGE]: { title: "From the bundle" },
    });
    expect(await ops(undefined).siteSourcesUnderSnapshot()).toBeNull();
  });

  test("is not the site's: a server with no proposal reads the bundle", async () => {
    const sources = await ops(undefined).getBaseSources();
    expect(sources[PAGE]).toEqual({ title: "From the bundle" });
  });
});

describe("the proposals API, for the Studio", () => {
  test("a proposal's server says which proposal it is; the site's says none", () => {
    expect(ops(proposal(null)).currentProposal()).toEqual({
      name: NAME,
      branch: `val/p/${NAME}`,
    });
    expect(ops(undefined).currentProposal()).toBeNull();
  });

  test("goes to content's proposals, with the person beside the project's key", async () => {
    const o = ops(undefined);
    await o.proposalsApi("", { method: "GET" }, null);
    await o.proposalsApi(
      "",
      { method: "POST", body: JSON.stringify({ displayName: "Spring" }) },
      "profile-1",
    );
    await o.proposalsApi(
      `/${NAME}`,
      { method: "PATCH", body: JSON.stringify({ displayName: "Summer" }) },
      "profile-1",
    );
    await o.proposalsApi(`/${NAME}/close`, { method: "POST" }, "profile-1");
    await o.proposalsApi(`/${NAME}/setup/retry`, { method: "POST" }, "p");
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://content.example/v1/org/project/proposals",
      "POST https://content.example/v1/org/project/proposals",
      `PATCH https://content.example/v1/org/project/proposals/${NAME}`,
      `POST https://content.example/v1/org/project/proposals/${NAME}/close`,
      `POST https://content.example/v1/org/project/proposals/${NAME}/setup/retry`,
    ]);
    expect(sent[0]!.headers).not.toHaveProperty("x-val-profile-id");
    expect(sent[1]!.headers).toMatchObject({
      authorization: "Bearer test",
      "x-val-profile-id": "profile-1",
    });
    expect(sent[1]!.body).toEqual({ displayName: "Spring" });
  });

  test("a proposal's address publishes nothing to the site, and builds nothing for it", async () => {
    const o = ops(proposal("save-2"));
    for (const path of [
      "/publish-requests",
      "/publish-jobs/next",
      "/publish-jobs/J1/prepare",
      "/publish-jobs/J1/discard",
      "/publish/abc/promote",
    ]) {
      const answer = await o.publishApi(path, { method: "POST", body: "{}" });
      expect([path, answer.status]).toEqual([path, 403]);
    }
    expect(sent).toEqual([]);
    // `managed` would make the Studio build and publish after a Save.
    expect(o.sourceMode()).toBeNull();
  });

  test("a proposal's address builds its own merge: the merge's prepare and steps, the build's target and source", async () => {
    const o = ops(proposal("save-2"));
    const refusal = "nothing is published from here";
    for (const [method, path] of [
      ["POST", "/publish-jobs/J7/merge-prepare"],
      ["POST", "/publish-jobs/J7/steps"],
      ["POST", "/publish-jobs/J7/renew"],
      ["GET", "/publish-requests/m1"],
      ["GET", "/build-target"],
      ["GET", "/project-source"],
      ["POST", "/publish"],
      ["POST", "/publish/p1/artifacts"],
    ] as const) {
      const answer = await o.publishApi(path, { method, body: "{}" });
      expect([path, answer.body.includes(refusal)]).toEqual([path, false]);
    }
    for (const [method, path] of [
      ["POST", "/publish-requests/try-again"],
      ["POST", "/publish-requests/m1"],
    ] as const) {
      const answer = await o.publishApi(path, { method, body: "{}" });
      expect([path, answer.status]).toEqual([path, 403]);
    }
  });

  test("Publish in a proposal is pressed, and its checks read, through the proposals API", async () => {
    const o = ops(undefined);
    await o.proposalsApi(`/${NAME}/merge-checks`, { method: "GET" }, "p");
    await o.proposalsApi(`/${NAME}/merge`, { method: "POST", body: "{}" }, "p");
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `GET /v1/org/project/proposals/${NAME}/merge-checks`,
      `POST /v1/org/project/proposals/${NAME}/merge`,
    ]);
  });

  test("reaches nothing else: not a save, not a move, not another route", async () => {
    const o = ops(undefined);
    for (const [method, path] of [
      ["POST", `/${NAME}/save`],
      ["POST", `/${NAME}/patches`],
      ["DELETE", `/${NAME}`],
      ["POST", `/${NAME}`],
      ["GET", `/${NAME}/close`],
      ["GET", "/../commit"],
      ["GET", `/${NAME}?x=1`],
      ["GET", "/NOTAPROPOSAL00000000"],
    ] as const) {
      const answer = await o.proposalsApi(path, { method }, "p");
      expect([method, path, answer.status]).toEqual([method, path, 403]);
    }
    expect(sent).toEqual([]);
  });
});

describe("proposalFromEnv", () => {
  test("names a proposal only with both its name and its branch", () => {
    expect(proposalFromEnv({})).toBeUndefined();
    expect(proposalFromEnv({ VAL_PROPOSAL: NAME })).toBeUndefined();
    expect(
      proposalFromEnv({ VAL_PROPOSAL: NAME, VAL_BRANCH: `val/p/${NAME}` }),
    ).toEqual({
      name: NAME,
      branch: `val/p/${NAME}`,
      commit: null,
      modules: {},
      files: {},
    });
  });

  test("reads the snapshot the platform hands over", () => {
    const p = proposalFromEnv({
      VAL_PROPOSAL: NAME,
      VAL_BRANCH: `val/p/${NAME}`,
      VAL_OVERLAY: JSON.stringify({
        version: 3,
        commit: "save-2",
        modules: { [PAGE]: { title: "Saved" } },
        files: { "app/page.val.ts": "text" },
      }),
    });
    expect(p?.commit).toBe("save-2");
    expect(p?.files).toEqual({ "app/page.val.ts": "text" });
    expect(p && proposalSnapshot(p)).toEqual({ [PAGE]: { title: "Saved" } });
  });

  test("refuses a snapshot it cannot read, rather than serve the base as the proposal", () => {
    expect(() =>
      proposalFromEnv({
        VAL_PROPOSAL: NAME,
        VAL_BRANCH: `val/p/${NAME}`,
        VAL_OVERLAY: "{not json",
      }),
    ).toThrow(/VAL_OVERLAY is not JSON/);
    expect(() =>
      proposalFromEnv({
        VAL_PROPOSAL: NAME,
        VAL_BRANCH: `val/p/${NAME}`,
        VAL_OVERLAY: JSON.stringify({ commit: 7 }),
      }),
    ).toThrow(/commit must be a string or null/);
  });
});
