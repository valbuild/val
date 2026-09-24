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
    publicFiles: async () => ({ carried: [] }),
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

/*
 * The loader stores public files PER BUILD, so a build that names none serves
 * none. These pin that a Studio publish keeps the site's images, adds the ones
 * the save uploaded, and refuses rather than guess when it cannot know.
 */
describe("the site's public files", () => {
  const live = [
    { key: "public/favicon.ico", sha256: "fav", bytes: 10 },
    { key: "public/val/old.png", sha256: "old", bytes: 20 },
    { key: "public/val/gone.png", sha256: "gone", bytes: 30 },
  ];

  const declaredKeys = async (
    overrides: Partial<Parameters<typeof runStudioDeploy>[0]>,
    built: Array<{
      key: string;
      body: string;
      sha256: string;
      bytes: number;
    }> = [{ key: "server", body: "x", sha256: "sha", bytes: 1 }],
  ) => {
    const declared: string[][] = [];
    const result = await deploy({
      client: client({
        publicFiles: async () => ({ carried: live }),
        declare: async (body) => {
          declared.push(body.artifacts.map(({ key }) => key));
          return {
            publishId: "pub_1",
            state: "awaiting-artifacts",
            project: { publicProjectId: "p", siteUrl: "https://site.test" },
            uploads: [],
            have: [],
          };
        },
      }),
      loadBuilder: async () =>
        builder([], { publishArtifacts: async () => built }),
      ...overrides,
    });
    return { result, declared: declared[0] ?? [] };
  };

  test("the live build's are declared again, so the site keeps them", async () => {
    const { result, declared } = await declaredKeys({});
    expect(result.status).toBe("live");
    expect(declared).toEqual([
      "server",
      "public/favicon.ico",
      "public/val/old.png",
      "public/val/gone.png",
    ]);
  });

  test("one the commit deleted is not", async () => {
    const { declared } = await declaredKeys({
      committedFiles: { "/public/val/gone.png": null },
    });
    expect(declared).not.toContain("public/val/gone.png");
    expect(declared).toContain("public/val/old.png");
  });

  test("one this build produced is declared once, as built", async () => {
    const { declared } = await declaredKeys({}, [
      { key: "server", body: "x", sha256: "sha", bytes: 1 },
      { key: "public/val/old.png", body: "new", sha256: "new", bytes: 3 },
    ]);
    expect(declared.filter((key) => key === "public/val/old.png")).toHaveLength(
      1,
    );
  });

  test("the images the save committed go into the build", async () => {
    const inputs: Array<{
      publicFiles?: Record<string, string>;
      assets?: Record<string, string>;
    }> = [];
    await deploy({
      committedBinaryFiles: {
        files: {
          "/public/val/new_a1b2c.png": "UE5H",
          "/src/assets/logo.svg": "PHN2Zz4=",
        },
        unread: [],
      },
      loadBuilder: async () =>
        builder([], {
          buildUserApp: async (input) => {
            inputs.push({
              publicFiles: input.publicFiles,
              assets: input.assets,
            });
            return buildOutput;
          },
        }),
    });
    expect(inputs[0]?.publicFiles).toEqual({
      "public/val/new_a1b2c.png": "UE5H",
    });
    expect(inputs[0]?.assets).toEqual({ "src/assets/logo.svg": "PHN2Zz4=" });
  });

  test("when content cannot say what the site serves, nothing is published", async () => {
    const calls: string[] = [];
    const result = await deploy({
      client: client({ publicFiles: async () => null }),
      loadBuilder: async () => builder(calls),
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.message).toMatch(
      /cannot tell which images/,
    );
    expect(calls).not.toContain("buildUserApp");
  });

  test("a committed file the server could not read stops the build", async () => {
    const calls: string[] = [];
    const result = await deploy({
      committedBinaryFiles: { files: {}, unread: ["/public/val/x.png"] },
      loadBuilder: async () => builder(calls),
    });
    expect(result.status === "failed" && result.message).toMatch(
      /\/public\/val\/x\.png could not be read/,
    );
    expect(calls).not.toContain("buildUserApp");
  });
});

/*
 * A project cloned from a template seed: content has no record of its live
 * build, but the loader knows the paths, and the Studio is on the site.
 */
describe("public files content has no record of", () => {
  const inputsOf = async (
    overrides: Partial<Parameters<typeof runStudioDeploy>[0]>,
  ) => {
    const inputs: Array<Record<string, string> | undefined> = [];
    const result = await deploy({
      client: client({
        publicFiles: async () => ({ paths: ["favicon.ico", "val/old.png"] }),
      }),
      loadBuilder: async () =>
        builder([], {
          buildUserApp: async (input) => {
            inputs.push(input.publicFiles);
            return buildOutput;
          },
        }),
      ...overrides,
    });
    return { result, publicFiles: inputs[0] };
  };

  test("are fetched from the site and built with", async () => {
    const asked: string[] = [];
    const { result, publicFiles } = await inputsOf({
      fetchPublicFile: async (path) => {
        asked.push(path);
        return `bytes-of-${path}`;
      },
    });
    expect(result.status).toBe("live");
    expect(asked).toEqual(["favicon.ico", "val/old.png"]);
    expect(publicFiles).toEqual({
      "public/favicon.ico": "bytes-of-favicon.ico",
      "public/val/old.png": "bytes-of-val/old.png",
    });
  });

  test("the commit's own bytes win over the site's, and a deletion stays deleted", async () => {
    const { publicFiles } = await inputsOf({
      fetchPublicFile: async (path) => `site-${path}`,
      committedFiles: { "/public/favicon.ico": null },
      committedBinaryFiles: {
        files: { "/public/val/old.png": "committed" },
        unread: [],
      },
    });
    expect(publicFiles).toEqual({ "public/val/old.png": "committed" });
  });

  test("one that cannot be fetched fails the publish by name", async () => {
    const { result, publicFiles } = await inputsOf({
      fetchPublicFile: async (path) => {
        if (path === "val/old.png") throw new Error("404");
        return "x";
      },
    });
    expect(result.status === "failed" && result.message).toMatch(
      /\/val\/old\.png could not be read/,
    );
    expect(publicFiles).toBeUndefined();
  });

  test("without a way to fetch them, nothing is published", async () => {
    const { result, publicFiles } = await inputsOf({});
    expect(result.status === "failed" && result.message).toMatch(
      /cannot tell which images/,
    );
    expect(publicFiles).toBeUndefined();
  });
});

describe("the branch a build is made at", () => {
  const declaredBranch = async (
    overrides: Partial<Parameters<typeof runStudioDeploy>[0]>,
    baked: { commit: string; branch: string } | undefined,
  ) => {
    const branches: Array<string | null> = [];
    await deploy({
      client: client({
        declare: async (body) => {
          branches.push(body.branch);
          return {
            publishId: "pub_1",
            state: "awaiting-artifacts",
            project: { publicProjectId: "p", siteUrl: "https://site.test" },
            uploads: [],
            have: [],
          };
        },
      }),
      loadBuilder: async () => builder([], { bakedGit: () => baked }),
      ...overrides,
    });
    return branches[0];
  };

  test("is the project's, as the server had it", async () => {
    await expect(
      declaredBranch({ branch: "main" }, { commit: "old", branch: "stale" }),
    ).resolves.toBe("main");
  });

  test("for a seed wired at no commit, the project's is what makes it one", async () => {
    // The template seed is published commitless, so a cloned project's
    // val.server.ts names no branch -- and a branchless publish is refused by
    // a loader whose pointer follows one.
    await expect(declaredBranch({ branch: "main" }, undefined)).resolves.toBe(
      "main",
    );
  });

  test("falls back to the one the last build was wired at", async () => {
    await expect(
      declaredBranch({ branch: null }, { commit: "old", branch: "main" }),
    ).resolves.toBe("main");
  });
});

/*
 * Edits committed since the live build, which this save did not write: one
 * whose own publish failed, or the first edit of a project copied from a
 * template. They are in content and in no stored source.
 */
describe("the edits saved since the live build", () => {
  const earlier = "export default 'saved before, never published';\n";
  const now = "export default 'this save';\n";

  const handedFiles = async (
    overrides: Partial<Parameters<typeof runStudioDeploy>[0]>,
  ) => {
    const handed: Array<Record<string, string>> = [];
    const result = await deploy({
      client: client({
        projectSource: async () => ({
          ...dataRoutes,
          "src/earlier.val.ts": "export default 'as the live build has it';\n",
          "src/now.val.ts": "export default 'as the live build has it';\n",
        }),
      }),
      loadBuilder: async () =>
        builder([], {
          buildUserApp: async (input) => {
            handed.push(input.files);
            return buildOutput;
          },
        }),
      ...overrides,
    });
    return { result, handed };
  };

  test("are built, beside the files this save wrote", async () => {
    const { handed } = await handedFiles({
      committedFiles: { "/src/now.val.ts": now },
      builtSource: async () => ({
        "/src/earlier.val.ts": earlier,
        "/src/now.val.ts": now,
      }),
    });
    expect(handed[0]?.["src/earlier.val.ts"]).toBe(earlier);
    expect(handed[0]?.["src/now.val.ts"]).toBe(now);
  });

  test("including by a Finish publishing, which saved nothing", async () => {
    const { handed } = await handedFiles({
      committedFiles: null,
      builtSource: async () => ({ "/src/earlier.val.ts": earlier }),
    });
    expect(handed[0]?.["src/earlier.val.ts"]).toBe(earlier);
  });

  test("a server with none to give builds this save's files alone", async () => {
    const { result, handed } = await handedFiles({
      committedFiles: { "/src/now.val.ts": now },
      builtSource: async () => null,
    });
    expect(result.status).toBe("live");
    expect(handed[0]?.["src/now.val.ts"]).toBe(now);
  });

  test("one that cannot be read stops the build", async () => {
    const { result, handed } = await handedFiles({
      committedFiles: { "/src/now.val.ts": now },
      builtSource: async () => {
        throw new Error(
          "The edits saved since the live build could not be read: 500",
        );
      },
    });
    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringContaining("could not be read"),
    });
    expect(handed).toHaveLength(0);
  });
});

describe("the stylesheet", () => {
  const cssOf = async (built: string, live: string) => {
    const published: string[] = [];
    await deploy({
      liveStylesheet: async () => live,
      loadBuilder: async () =>
        builder([], {
          buildUserApp: async () => ({ ...buildOutput, cssCode: built }),
          publishArtifacts: async (build) => {
            published.push(build.cssCode);
            return [{ key: "server", body: "x", sha256: "sha", bytes: 1 }];
          },
        }),
    });
    return published[0];
  };

  test("is the live site's when the tab compiled none", async () => {
    expect(await cssOf("", ".flex{display:flex}")).toBe(".flex{display:flex}");
  });

  test("is the build's own when the tab compiled one", async () => {
    expect(await cssOf(".mine{}", ".flex{display:flex}")).toBe(".mine{}");
  });

  test("is none when neither has one", async () => {
    expect(await cssOf("", "")).toBe("");
  });
});

describe("after it is live", () => {
  test("it waits for the site to serve the build, and says whether it does", async () => {
    const phases: DeployPhase[] = [];
    const asked: string[] = [];
    const result = await deploy(
      {
        waitUntilServed: async (hash) => {
          asked.push(hash);
          return false;
        },
      },
      phases,
    );
    expect(asked).toEqual(["build-hash"]);
    expect(phases.at(-1)).toEqual({ kind: "propagating" });
    expect(result).toEqual({
      status: "live",
      url: "https://site.test",
      visible: false,
    });
  });

  test("a site that cannot say is still a live publish", async () => {
    const result = await deploy({
      waitUntilServed: async () => {
        throw new Error("offline");
      },
    });
    expect(result).toEqual({ status: "live", url: "https://site.test" });
  });

  test("a failed publish does not wait", async () => {
    const asked: string[] = [];
    await deploy({
      client: client({
        promote: async () => {
          throw new Error("refused");
        },
      }),
      waitUntilServed: async (hash) => {
        asked.push(hash);
        return true;
      },
    });
    expect(asked).toEqual([]);
  });
});
