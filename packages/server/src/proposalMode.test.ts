import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import type { AuthorId, PreparedCommit } from "./ValOps";
import {
  proposalFromEnv,
  proposalSnapshot,
  proposalSnapshotForReaders,
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

/*
 * A `.jsonValues()` module keeps each entry's content in its own `*.val.json`
 * file, and its Source holds only a marker per entry. A save in a proposal
 * writes the entry's file, which reaches this server as saved text
 * (`files`), not as Source: the snapshot has to carry it, or the proposal's
 * address shows the build's entries -- and the Studio there, none at all.
 */
describe("a .jsonValues() module saved in the proposal", () => {
  const KB = "/app/kb.val.ts" as ModuleFilePath;
  const kbText = `import { c, s } from "../val.config";
export default c.define(
  "/app/kb.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    a: c.json(() => import("./kb/a.val.json")),
    b: c.json(() => import("./kb/b.val.json")),
  },
);
`;
  const kbModules = [
    {
      def: async () => ({
        default: c.define(
          KB,
          s.record(s.object({ title: s.string() })).jsonValues(),
          {
            a: c.json(() =>
              Promise.resolve({ default: { title: "a from the bundle" } }),
            ),
            b: c.json(() =>
              Promise.resolve({ default: { title: "b from the bundle" } }),
            ),
          },
        ),
      }),
    },
  ];
  // As content hands it over: entry `a` was saved, `b` was not.
  const saved: ValProposal = {
    name: NAME,
    branch: `val/p/${NAME}`,
    commit: "save-1",
    modules: { [KB]: { a: { _type: "json" }, b: { _type: "json" } } },
    files: {
      "app/kb/a.val.json": JSON.stringify({ title: "a saved in the proposal" }),
    },
  };
  const projectSource = { "app/kb.val.ts": kbText };

  test("Val's own server keeps the markers: its patching works on them", () => {
    expect(proposalSnapshot(saved)[KB]).toEqual({
      a: { _type: "json" },
      b: { _type: "json" },
    });
  });

  test("the snapshot carries a saved entry's content, and leaves the others to the build", () => {
    const snapshot = proposalSnapshotForReaders(saved, projectSource);
    expect(snapshot[KB]).toEqual({
      a: { title: "a saved in the proposal" },
      b: { _type: "json" },
    });
  });

  test("and finds the entries from the module's saved text when the save rewrote it too", () => {
    const snapshot = proposalSnapshotForReaders({
      ...saved,
      files: { ...saved.files, "app/kb.val.ts": kbText },
    });
    expect(snapshot[KB]).toEqual({
      a: { title: "a saved in the proposal" },
      b: { _type: "json" },
    });
  });

  test("a saved entry whose content is null is that content, not a deleted entry", async () => {
    const NULLABLE = "/app/notes.val.ts" as ModuleFilePath;
    const notesText = `import { c, s } from "../val.config";
export default c.define(
  "/app/notes.val.ts",
  s.record(s.object({ title: s.string() }).nullable()).jsonValues(),
  { a: c.json(() => import("./notes/a.val.json")) },
);
`;
    const o = new ValOpsHttp(
      "https://content.example",
      "org/project",
      null,
      { apiKey: "test" },
      {
        config,
        modules: [
          {
            def: async () => ({
              default: c.define(
                NULLABLE,
                s
                  .record(s.object({ title: s.string() }).nullable())
                  .jsonValues(),
                {
                  a: c.json(() =>
                    Promise.resolve({ default: { title: "from the bundle" } }),
                  ),
                },
              ),
            }),
          },
        ],
      },
      {
        config,
        projectSource: { "app/notes.val.ts": notesText },
        proposal: {
          ...saved,
          modules: { [NULLABLE]: { a: { _type: "json" } } },
          files: { "app/notes/a.val.json": "null" },
        },
      },
    );
    expect(
      await o.getJsonEntry(NULLABLE, "a", { applyPatches: false }),
    ).toEqual({ status: "success", content: null });
  });

  test("the Studio there reads the saved entry, and the build's for the rest", async () => {
    const o = new ValOpsHttp(
      "https://content.example",
      "org/project",
      null,
      { apiKey: "test" },
      { config, modules: kbModules },
      { config, projectSource, proposal: saved },
    );
    expect(await o.getJsonEntry(KB, "a", { applyPatches: false })).toEqual({
      status: "success",
      content: { title: "a saved in the proposal" },
    });
    expect(await o.getJsonEntry(KB, "b", { applyPatches: false })).toEqual({
      status: "success",
      content: { title: "b from the bundle" },
    });
  });

  test("a content version's, on a site with no proposal: the version's entry, and the build's for the rest", async () => {
    const o = new ValOpsHttp(
      "https://content.example",
      "org/project",
      null,
      { apiKey: "test" },
      { config, modules: kbModules },
      {
        config,
        projectSource,
        contentVersion: {
          id: "e".repeat(64),
          job: "J-7",
          commit: null,
          modules: saved.modules,
          files: saved.files,
        },
      },
    );
    expect(await o.getJsonEntry(KB, "a", { applyPatches: false })).toEqual({
      status: "success",
      content: { title: "a saved in the proposal" },
    });
    expect(await o.getJsonEntry(KB, "b", { applyPatches: false })).toEqual({
      status: "success",
      content: { title: "b from the bundle" },
    });
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

  test("staged files are read anywhere, and written and built only by the proposal's own server", async () => {
    const own = ops(proposal("save-2"));
    await own.proposalsApi(`/${NAME}/files`, { method: "GET" }, "p");
    await own.proposalsApi(
      `/${NAME}/files`,
      { method: "POST", body: JSON.stringify({ files: { "src/a.ts": "a" } }) },
      "p",
    );
    await own.proposalsApi(
      `/${NAME}/build`,
      { method: "POST", body: "{}" },
      "p",
    );
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `GET /v1/org/project/proposals/${NAME}/files`,
      `POST /v1/org/project/proposals/${NAME}/files`,
      `POST /v1/org/project/proposals/${NAME}/build`,
    ]);
    sent.length = 0;

    const OTHER = "f".repeat(20);
    for (const [o, path] of [
      [own, `/${OTHER}/files`],
      [own, `/${OTHER}/build`],
      [ops(undefined), `/${NAME}/files`],
      [ops(undefined), `/${NAME}/build`],
    ] as const) {
      const answer = await o.proposalsApi(
        path,
        { method: "POST", body: "{}" },
        "p",
      );
      expect([path, answer.status]).toEqual([path, 403]);
      expect(JSON.parse(answer.body).message).toMatch(/in (a|the) proposal/);
    }
    expect(sent).toEqual([]);
    // Reading another proposal's files is reading it, as GET of it is.
    await ops(undefined).proposalsApi(`/${NAME}/files`, { method: "GET" }, "p");
    expect(sent).toHaveLength(1);
  });

  test("Update from the site is asked by the proposal's own server, and nobody else's", async () => {
    const own = ops(proposal("save-2"));
    await own.proposalsApi(
      `/${NAME}/update-from-site`,
      { method: "POST", body: "{}" },
      "p",
    );
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `POST /v1/org/project/proposals/${NAME}/update-from-site`,
    ]);
    sent.length = 0;
    for (const [o, path] of [
      [own, `/${"f".repeat(20)}/update-from-site`],
      [ops(undefined), `/${NAME}/update-from-site`],
    ] as const) {
      const answer = await o.proposalsApi(
        path,
        { method: "POST", body: "{}" },
        "p",
      );
      expect([path, answer.status]).toEqual([path, 403]);
    }
    expect(sent).toEqual([]);
  });

  test("bringing back the code of a point is asked by the proposal's own server, and nobody else's", async () => {
    // valbuild/home docs/hosted-publishing.md, step 9: the site's Studio opens
    // the proposal, and the Studio at its address stages the code there.
    const own = ops(proposal("save-2"));
    const body = JSON.stringify({ commit: "a".repeat(64) });
    await own.proposalsApi(
      `/${NAME}/restore-code`,
      { method: "POST", body },
      "p",
    );
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `POST /v1/org/project/proposals/${NAME}/restore-code`,
    ]);
    sent.length = 0;
    for (const [o, path] of [
      [own, `/${"f".repeat(20)}/restore-code`],
      [ops(undefined), `/${NAME}/restore-code`],
    ] as const) {
      const answer = await o.proposalsApi(path, { method: "POST", body }, "p");
      expect([path, answer.status]).toEqual([path, 403]);
    }
    expect(sent).toEqual([]);
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

/*
 * Update from the site for a proposal that changes only content
 * (valbuild/home `docs/hosted-publishing.md`, step 8.2, slice 1a): content
 * hands over the three versions of each module the proposal saved, this
 * server merges them under its build's schemas, and content commits it.
 */
describe("Update from the site, content only", () => {
  const PAGE_TEXT = (title: string) =>
    `export default c.define("/app/page.val.ts", s.object({ title: s.string() }), { "title": "${title}" });\n`;
  const inputs = (
    page: { base: string; site: string; proposal: string },
    over: Record<string, unknown> = {},
  ) => ({
    base: "site-1",
    siteHead: "site-2",
    proposalHead: "save-2",
    upToDate: false,
    contentOnly: { ok: true },
    modules: {
      [PAGE]: {
        base: { title: page.base },
        site: { title: page.site },
        proposal: { title: page.proposal },
        text: PAGE_TEXT(page.proposal),
      },
    },
    ...over,
  });
  /** Content: `merge-inputs` answers `given`, and `merge-from-site` commits. */
  const content = (given: unknown) =>
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      sent.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      const body = url.endsWith("/merge-inputs")
        ? given
        : { commit: "merge-1", proposal: { name: NAME } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  const update = (
    o: ValOpsHttp,
    resolutions: unknown[] = [],
    heads: { siteHead?: string | null; proposalHead?: string | null } = {},
  ) =>
    o
      .proposalsApi(
        `/${NAME}/update-content`,
        { method: "POST", body: JSON.stringify({ resolutions, ...heads }) },
        "p",
      )
      .then((a) => ({ status: a.status, json: JSON.parse(a.body) }));

  test("the same field changed on both sides is a conflict, and nothing is written", async () => {
    content(inputs({ base: "Sale", site: "Spring", proposal: "Summer" }));
    const answer = await update(ops(proposal("save-2")));
    expect(answer).toEqual({
      status: 200,
      json: {
        status: "conflicts",
        conflicts: [
          {
            kind: "field",
            moduleFilePath: PAGE,
            path: ["title"],
            base: "Sale",
            site: "Spring",
            proposal: "Summer",
          },
        ],
        siteHead: "site-2",
        proposalHead: "save-2",
      },
    });
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `GET /v1/org/project/proposals/${NAME}/merge-inputs`,
    ]);
    expect(sent[0].headers["x-val-profile-id"]).toBe("p");
  });

  test("with a resolution, the merge is written into the proposal's file and committed with both heads", async () => {
    content(inputs({ base: "Sale", site: "Spring", proposal: "Summer" }));
    const answer = await update(ops(proposal("save-2")), [
      { moduleFilePath: PAGE, path: ["title"], keep: "site" },
    ]);
    expect(answer).toMatchObject({
      status: 200,
      json: { status: "updated", commit: "merge-1" },
    });
    const commit = sent.find((r) => r.url.endsWith("/merge-from-site"));
    expect(commit?.method).toBe("POST");
    expect(commit?.body).toEqual({
      siteHead: "site-2",
      proposalHead: "save-2",
      files: { "app/page.val.ts": expect.stringContaining('"Spring"') },
      modules: {
        [PAGE]: { source: { title: "Spring" }, schema: expect.anything() },
      },
    });
  });

  test("decisions made where the site still is are applied", async () => {
    content(inputs({ base: "Sale", site: "Spring", proposal: "Summer" }));
    const answer = await update(
      ops(proposal("save-2")),
      [{ moduleFilePath: PAGE, path: ["title"], keep: "proposal" }],
      { siteHead: "site-2", proposalHead: "save-2" },
    );
    expect(answer.json.status).toBe("updated");
    const commit = sent.find((r) => r.url.endsWith("/merge-from-site"));
    expect(commit?.body).toMatchObject({
      modules: { [PAGE]: { source: { title: "Summer" } } },
    });
  });

  test("decisions made before the site moved are not applied: the conflict is shown again, as it is now", async () => {
    // The person kept the proposal's title over the site's "Spring"; the
    // site has since published "Autumn", which nobody has seen.
    content(inputs({ base: "Sale", site: "Autumn", proposal: "Summer" }));
    const answer = await update(
      ops(proposal("save-2")),
      [{ moduleFilePath: PAGE, path: ["title"], keep: "proposal" }],
      { siteHead: "site-1b", proposalHead: "save-2" },
    );
    expect(answer).toEqual({
      status: 200,
      json: {
        status: "conflicts",
        conflicts: [
          expect.objectContaining({
            path: ["title"],
            site: "Autumn",
            proposal: "Summer",
          }),
        ],
        siteHead: "site-2",
        proposalHead: "save-2",
      },
    });
    expect(sent.some((r) => r.url.endsWith("/merge-from-site"))).toBe(false);
  });

  test("an answer from content that cannot be read, after it wrote the merge, says the update happened", async () => {
    jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input) =>
        String(input).endsWith("/merge-inputs")
          ? new Response(
              JSON.stringify(
                inputs({ base: "Sale", site: "Sale", proposal: "Summer" }),
              ),
              { status: 200 },
            )
          : new Response("", { status: 200 }),
      );
    const answer = await update(ops(proposal("save-2")));
    expect(answer.status).toBe(502);
    expect(answer.json.message).toMatch(/was updated from the site/);
  });

  test("a site change that does not touch the proposal's fields merges without asking", async () => {
    content(inputs({ base: "Sale", site: "Sale", proposal: "Summer" }));
    expect((await update(ops(proposal("save-2")))).json.status).toBe("updated");
  });

  test("up to date: nothing to merge, nothing written", async () => {
    content(
      inputs(
        { base: "Sale", site: "Sale", proposal: "Summer" },
        {
          upToDate: true,
        },
      ),
    );
    expect((await update(ops(proposal("save-2")))).json).toEqual({
      status: "up-to-date",
    });
    expect(sent).toHaveLength(1);
  });

  test("a proposal that changes code needs a build to update, and says why", async () => {
    content(
      inputs(
        { base: "Sale", site: "Spring", proposal: "Summer" },
        {
          contentOnly: { ok: false, reason: "The proposal changes code." },
        },
      ),
    );
    expect(await update(ops(proposal("save-2")))).toEqual({
      status: 409,
      json: { status: "needs-build", message: "The proposal changes code." },
    });
    expect(sent).toHaveLength(1);
  });

  test("only the proposal's own server updates it: its build's schemas are the ones it merges under", async () => {
    content(inputs({ base: "Sale", site: "Spring", proposal: "Summer" }));
    for (const o of [
      ops(undefined),
      ops({ ...proposal("x"), name: "f".repeat(20) }),
    ]) {
      expect((await update(o)).status).toBe(403);
    }
    expect(sent).toEqual([]);
  });
});

describe("Update from the site, with code", () => {
  const HERO = "src/components/Hero.tsx";
  const FOOTER = "src/components/Footer.tsx";
  /** Content's `merge-trees`: the site changed the footer, the proposal the hero. */
  const trees = (over: Record<string, unknown> = {}) => ({
    base: "site-1",
    siteHead: "site-2",
    proposalHead: "save-2",
    upToDate: false,
    builds: { base: "build-a", site: "build-b" },
    trees: {
      site: { [HERO]: "hero a", [FOOTER]: "footer b" },
      base: { [FOOTER]: "footer a" },
      proposal: { [HERO]: "hero c" },
    },
    modules: {},
    sources: {},
    ...over,
  });
  const content = (given: unknown) =>
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      sent.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      const body = url.endsWith("/merge-trees")
        ? given
        : { commit: "merge-1", proposal: { name: NAME } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  /** What the tab sends: the heads it read, and the (here empty) evaluations. */
  const request = (over: Record<string, unknown> = {}) => ({
    siteHead: "site-2",
    proposalHead: "save-2",
    builds: { base: "build-a", site: "build-b" },
    evaluated: { base: {}, site: {}, proposal: {} },
    resolutions: [],
    ...over,
  });
  const update = (o: ValOpsHttp, body: unknown) =>
    o
      .proposalsApi(
        `/${NAME}/update-code`,
        { method: "POST", body: JSON.stringify(body) },
        "p",
      )
      .then((a) => ({ status: a.status, json: JSON.parse(a.body) }));

  test("the first call answers the merge for the tab to evaluate, and writes nothing", async () => {
    content(trees());
    const answer = await update(ops(proposal("save-2")), request());
    expect(answer).toEqual({
      status: 200,
      json: {
        status: "evaluate",
        id: expect.stringMatching(/^[0-9a-f]{64}$/),
        files: { [HERO]: "hero c" },
        sources: {},
      },
    });
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `GET /v1/org/project/proposals/${NAME}/merge-trees`,
    ]);
  });

  test("the second, with the merge evaluated, commits it over the live build and stages its code", async () => {
    content(trees());
    const first = await update(ops(proposal("save-2")), request());
    sent.length = 0;
    const answer = await update(
      ops(proposal("save-2")),
      request({ merged: { id: first.json.id, evaluated: {} } }),
    );
    expect(answer).toMatchObject({
      status: 200,
      json: { status: "updated", commit: "merge-1" },
    });
    expect(sent.find((r) => r.url.endsWith("/merge-from-site"))?.body).toEqual({
      siteHead: "site-2",
      proposalHead: "save-2",
      files: { [HERO]: "hero c" },
      modules: {},
      code: { build: "build-b", staged: [HERO] },
    });
  });

  test("trees that moved since the tab read them are not merged", async () => {
    content(trees({ siteHead: "site-3" }));
    expect(await update(ops(proposal("save-2")), request())).toEqual({
      status: 409,
      json: {
        status: "moved",
        message: expect.stringMatching(/Update from the site again/),
      },
    });
  });

  test("an evaluation of another merge is not committed", async () => {
    content(trees());
    const answer = await update(
      ops(proposal("save-2")),
      request({ merged: { id: "another", evaluated: {} } }),
    );
    expect(answer.status).toBe(409);
    expect(answer.json.status).toBe("stale");
    expect(sent.some((r) => r.url.endsWith("/merge-from-site"))).toBe(false);
  });

  test("only the proposal's own server updates it", async () => {
    content(trees());
    expect((await update(ops(undefined), request())).status).toBe(403);
    expect(sent).toEqual([]);
  });

  test("the tab reads the trees through the proposals API", async () => {
    content(trees());
    const answer = await ops(proposal("save-2")).proposalsApi(
      `/${NAME}/merge-trees`,
      { method: "GET" },
      "p",
    );
    expect(answer.status).toBe(200);
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
