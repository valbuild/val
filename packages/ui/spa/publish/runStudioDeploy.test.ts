import type { BuildOutput } from "@valbuild/tanstack-build";
import { StudioPublishClient } from "./publishClient";
import { StudioBuilder } from "./loadBuilder";
import { DeployPhase, runStudioDeploy } from "./runStudioDeploy";

/**
 * The ORDER, and the refusals.
 *
 * Nothing here builds anything -- the builder is a fake, because the real one
 * is 10.9 MB of WebAssembly that cannot load under jest. What is left when the
 * build is a stub is exactly what this module is: a sequence, four things it
 * refuses to start, and a rule that it never throws.
 *
 * The sequence is worth pinning because two of its steps are only correct in
 * one order. The commit has to be baked in BEFORE the build, or the build
 * compiles new content against the previous commit and reads the wrong version
 * of every file back. And the record handed over as `projectSource` has to be
 * the one WITHOUT the generated route tree, or a generated file comes back as
 * content someone wrote.
 */

const target = {
  base: {
    rev: "base-1",
    shellRev: "shell-1",
    rscShellRev: "rsc-1",
    modules: {},
    rscModules: {},
    paths: {
      baseFromProject: "../base/",
      projectVendorDir: "v/",
      rscVendorBase: "rv/",
      rscRuntimeSpecifier: "rt",
      rscRuntimePath: "rt.js",
      flightServer: "fs.js",
      serverFnBase: "sf/",
    },
  },
  project: {
    rev: "layer-1",
    rsc: false,
    modules: {},
    css: {},
    workerOnly: [],
  },
};

const buildOutput: BuildOutput = {
  serverCode: "",
  clientCode: "",
  serverChunks: {},
  clientChunks: {},
  publicFiles: {},
  assetFiles: {},
  cssCode: "",
  linksOwnCss: false,
  hash: "build-hash",
  vendorRev: "base-1",
  timings: { server: 1, client: 1, tailwind: 0, total: 2 },
  warnings: [],
};

/** A project whose pages are data, so no route tree is needed. */
const dataRoutes = {
  "src/val/val.server.ts": "const BUILT_FROM = null;\n",
  "src/app.tsx": "export default {};",
};

/** A project whose pages are files, so one is. */
const fileRoutes = {
  ...dataRoutes,
  "src/routes/index.tsx": "export const Route = {};",
};

function builder(calls: string[] = [], overrides: Partial<StudioBuilder> = {}) {
  const fake = {
    bakedGit: () => ({ commit: "old", branch: "main" }),
    rebakeGit: (files: Record<string, string>) => {
      calls.push("rebakeGit");
      return { ...files, baked: "yes" };
    },
    buildUserApp: async () => {
      calls.push("buildUserApp");
      return buildOutput;
    },
    publishArtifacts: async () => {
      calls.push("publishArtifacts");
      return [{ key: "server", body: "x", sha256: "sha", bytes: 1 }];
    },
    ...overrides,
  };
  // The Studio uses five things out of a package that exports dozens, and a
  // fake of the whole module would be a list nobody maintains. What keeps this
  // honest is the compiler at the CALL site, not here.
  return fake as unknown as StudioBuilder;
}

function client(overrides: Partial<StudioPublishClient> = {}) {
  const base: StudioPublishClient = {
    buildTarget: async () => target,
    projectSource: async () => dataRoutes,
    declare: async () => ({
      publishId: "pub_1",
      state: "awaiting-artifacts",
      project: { publicProjectId: "p", siteUrl: "https://site.test" },
      uploads: [],
      have: [],
    }),
    confirmArtifacts: async () => ({ state: "ready", problems: [] }),
    verify: async () => ({
      state: "verified",
      ok: true,
      problems: [],
      previewUrl: null,
    }),
    promote: async () => ({
      state: "live",
      url: "https://site.test",
      commit: "c",
    }),
    status: async () => ({
      publishId: "pub_1",
      state: "live",
      buildHash: "build-hash",
      missing: [],
      problems: [],
    }),
    upload: async () => undefined,
  };
  return { ...base, ...overrides };
}

const deploy = (
  overrides: Partial<Parameters<typeof runStudioDeploy>[0]> = {},
  phases: DeployPhase[] = [],
) =>
  runStudioDeploy({
    client: client(),
    commit: "c".repeat(40),
    loadBuilder: async () => builder(),
    onPhase: (phase) => phases.push(phase),
    ...overrides,
  });

describe("a publish from the Studio", () => {
  test("goes live", async () => {
    await expect(deploy()).resolves.toEqual({
      status: "live",
      url: "https://site.test",
    });
  });

  test("bakes the commit in before it builds", async () => {
    const calls: string[] = [];
    await deploy({ loadBuilder: async () => builder(calls) });
    expect(calls).toEqual(["rebakeGit", "buildUserApp", "publishArtifacts"]);
  });

  test("hands the build the tree and the project its own files", async () => {
    const handed: Array<{ files: unknown; projectSource: unknown }> = [];
    await deploy({
      client: client({ projectSource: async () => fileRoutes }),
      generateRouteTree: async (files) => ({
        ...files,
        "src/routeTree.gen.ts": "generated",
      }),
      loadBuilder: async () =>
        builder([], {
          buildUserApp: async (input) => {
            handed.push({
              files: input.files,
              projectSource: input.projectSource,
            });
            return buildOutput;
          },
        }),
    });
    // The generated tree is in what gets BUILT and in nothing else: it is
    // derived, and a CMS handed it publishes it back as though someone wrote it.
    expect(handed).toHaveLength(1);
    expect(Object.keys(handed[0].files ?? {})).toContain(
      "src/routeTree.gen.ts",
    );
    expect(Object.keys(handed[0].projectSource ?? {})).not.toContain(
      "src/routeTree.gen.ts",
    );
  });

  test("reads the target and the source together", async () => {
    /*
     * In flight at once, not one after the other. Neither half is useful
     * alone, so waiting for the first before asking for the second buys
     * nothing and costs a round trip.
     *
     * Proved by making the FIRST read finish only once the second has started:
     * in series that never happens, so a sequential version hangs here rather
     * than passing. A test that merely recorded the call order would pass
     * either way -- `Promise.all` invokes them in order too.
     */
    let sourceAsked: () => void = () => undefined;
    const sourceHasBeenAsked = new Promise<void>((resolve) => {
      sourceAsked = resolve;
    });
    const deployed = deploy({
      client: client({
        buildTarget: async () => {
          await sourceHasBeenAsked;
          return target;
        },
        projectSource: async () => {
          sourceAsked();
          return dataRoutes;
        },
      }),
    });
    await expect(
      Promise.race([
        deployed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("read in series")), 500),
        ),
      ]),
    ).resolves.toMatchObject({ status: "live" });
  });

  test("declares what the build actually produced", async () => {
    let declared: unknown = null;
    await deploy({
      client: client({
        declare: async (body) => {
          declared = body;
          return {
            publishId: "pub_1",
            state: "awaiting-artifacts",
            project: { publicProjectId: "p", siteUrl: null },
            uploads: [],
            have: [],
          };
        },
      }),
    });
    expect(declared).toMatchObject({
      buildHash: "build-hash",
      commit: "c".repeat(40),
      branch: "main",
      layerRev: "layer-1",
      linksOwnCss: false,
      artifacts: [{ key: "server", sha256: "sha", bytes: 1 }],
    });
  });
});

describe("the branch comes out of the record", () => {
  /*
   * Not out of the caller, because there is nowhere honest for a caller to
   * get one: neither `/stat` nor `/save` carries a branch, and a branch the
   * browser invented is a branch content would be asked to record a build
   * against on the browser's say-so. The project's own `val.server.ts` is
   * where the last build put it, and it does not move between publishes.
   */
  const declaredBy = async (
    overrides: Partial<Parameters<typeof runStudioDeploy>[0]>,
  ) => {
    let declared: { commit: string | null; branch: string | null } | null =
      null;
    await deploy({
      client: client({
        declare: async (body) => {
          declared = { commit: body.commit, branch: body.branch };
          return {
            publishId: "pub_1",
            state: "awaiting-artifacts",
            project: { publicProjectId: "p", siteUrl: null },
            uploads: [],
            have: [],
          };
        },
      }),
      ...overrides,
    });
    return declared;
  };

  test("the one the last build was wired at", async () => {
    expect(await declaredBy({})).toEqual({
      commit: "c".repeat(40),
      branch: "main",
    });
  });

  test("a record naming no branch declares neither", async () => {
    // A project that has only ever published commitlessly. Content answers
    // from its own chain, which for a project whose content service is the
    // store of record is where the answer always came from -- so sending a
    // commit with no branch to go with it would be worse than sending neither.
    expect(
      await declaredBy({
        loadBuilder: async () => builder([], { bakedGit: () => undefined }),
      }),
    ).toEqual({ commit: null, branch: null });
  });

  test("and bakes exactly what it declares", async () => {
    const baked: Array<unknown> = [];
    await deploy({
      loadBuilder: async () =>
        builder([], {
          rebakeGit: (files, git) => {
            baked.push(git);
            return files;
          },
        }),
    });
    // The bundle and the label have to agree: a declare naming a commit the
    // bundle was not wired at describes a build as something it is not.
    expect(baked).toEqual([{ commit: "c".repeat(40), branch: "main" }]);
  });
});

describe("what it refuses to start", () => {
  test("a project that has never published", async () => {
    const result = await deploy({
      client: client({ projectSource: async () => null }),
    });
    expect(result).toMatchObject({ status: "failed" });
    expect("message" in result && result.message).toMatch(
      /no published source/i,
    );
  });

  test("a project with no dependency layer", async () => {
    const result = await deploy({
      client: client({
        buildTarget: async () => ({
          ...target,
          project: { ...target.project, rev: null },
        }),
      }),
    });
    // Not "the build failed": a layer is built from node_modules by the half
    // of the builder that cannot run here, so no retry and no different edit
    // resolves it, and saying so sends someone looking at their content.
    expect("message" in result && result.message).toMatch(
      /dependency layer[\s\S]*cannot be built/i,
    );
  });

  test("a file-based project with no route generator", async () => {
    const result = await deploy({
      client: client({ projectSource: async () => fileRoutes }),
    });
    expect("message" in result && result.message).toMatch(/src\/routes/);
  });

  test("a file-based project WITH one is fine", async () => {
    await expect(
      deploy({
        client: client({ projectSource: async () => fileRoutes }),
        generateRouteTree: async (files) => files,
      }),
    ).resolves.toMatchObject({ status: "live" });
  });
});

describe("nothing throws", () => {
  /*
   * This runs behind a React handler. A rejection at an await boundary is a
   * spinner nobody can stop, so every way out is a value -- including the ones
   * that come from someone else's code.
   */
  const thrower = (message: string) => () => {
    throw new Error(message);
  };

  test.each([
    ["the builder never loads", { loadBuilder: thrower("no wasm") }, "no wasm"],
    [
      "the reads fail",
      { client: client({ buildTarget: thrower("502") }) },
      "502",
    ],
    [
      "the build fails",
      {
        loadBuilder: async () =>
          builder([], { buildUserApp: thrower("UNRESOLVED_ENTRY") }),
      },
      "UNRESOLVED_ENTRY",
    ],
    [
      "the artifacts cannot be assembled",
      {
        loadBuilder: async () =>
          builder([], { publishArtifacts: thrower("bad key") }),
      },
      "bad key",
    ],
  ])("%s", async (_name, overrides, expected) => {
    const result = await deploy(overrides);
    expect(result).toMatchObject({ status: "failed" });
    // The message alone, never `String(error)`: that prints `Error: ...`, which
    // reads on the page as a stack trace leaking into it.
    expect("message" in result && result.message).toBe(expected);
  });
});

/**
 * What the Save just committed has to be IN the build, and has to go back out
 * with it.
 *
 * The project's stored source is what the LAST build was made from. Found by
 * driving the whole pipeline in a browser: a Studio publish went live and the
 * page showed the old text, because the build never saw the file the save
 * wrote -- and a publish that did not send its source back would have made
 * the next edit's build undo this one.
 */
describe("the commit's own files", () => {
  const edited = "export default 'edited';\n";

  test("are laid over the stored source before it is built", async () => {
    const handed: Array<Record<string, string>> = [];
    await deploy({
      committedFiles: {
        "/src/content.val.ts": edited,
        "/src/gone.val.ts": null,
      },
      client: client({
        projectSource: async () => ({
          ...dataRoutes,
          "src/content.val.ts": "export default 'old';\n",
          "src/gone.val.ts": "export default 'gone';\n",
        }),
      }),
      loadBuilder: async () =>
        builder([], {
          buildUserApp: async (input) => {
            handed.push(input.files);
            return buildOutput;
          },
        }),
    });
    expect(handed).toHaveLength(1);
    expect(handed[0]?.["src/content.val.ts"]).toBe(edited);
    // A leading slash is the same file, not a second one beside it.
    expect(handed[0]?.["/src/content.val.ts"]).toBeUndefined();
    expect(handed[0]).not.toHaveProperty("src/gone.val.ts");
  });

  test("and the source it was built from goes out with the build", async () => {
    const published: Array<Record<string, string> | undefined> = [];
    await deploy({
      committedFiles: { "/src/content.val.ts": edited },
      loadBuilder: async () =>
        builder([], {
          publishArtifacts: async (_build, options) => {
            published.push(options?.projectSource);
            return [{ key: "server", body: "x", sha256: "sha", bytes: 1 }];
          },
        }),
    });
    expect(published[0]?.["src/content.val.ts"]).toBe(edited);
    // Wired at the commit, like the build itself.
    expect(published[0]?.["baked"]).toBe("yes");
  });

  test("a Finish publishing with none still builds and sends its source", async () => {
    const published: Array<Record<string, string> | undefined> = [];
    await deploy({
      committedFiles: null,
      loadBuilder: async () =>
        builder([], {
          publishArtifacts: async (_build, options) => {
            published.push(options?.projectSource);
            return [{ key: "server", body: "x", sha256: "sha", bytes: 1 }];
          },
        }),
    });
    expect(published[0]?.["src/app.tsx"]).toBe(dataRoutes["src/app.tsx"]);
  });
});
