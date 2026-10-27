import {
  buildProposal,
  CODE_TOOLS,
  isCodeTool,
  proposalProject,
  runCodeTool,
  type CodeToolDeps,
} from "./proposalCode";
import {
  ProposalsApiError,
  type ProposalBuildTarget,
  type ProposalJson,
  type ProposalStaged,
} from "./proposalsClient";

const NAME = "0123456789abcdef0123";
const INPUTS = "a".repeat(64);
const staged = (over: Partial<ProposalStaged> = {}): ProposalStaged => ({
  files: ["src/components/Hero.tsx"],
  inputs: INPUTS,
  buildRequired: true,
  ...over,
});
/** For a build whose serving answers: nothing reads the proposal back. */
const notRead = async (): Promise<ProposalJson> => {
  throw new Error("the proposal is not read back in this test");
};
const proposal = (built: string | null): ProposalJson => ({
  name: NAME,
  branch: `val/p/${NAME}`,
  displayName: "Spring",
  status: "open",
  updatedAt: "2026-10-14T10:00:00.000Z",
  built: built === null ? null : { hash: built, inputs: INPUTS },
});

/** A build target, as content answers one; what is in it is the deploy's. */
const TARGET: ProposalBuildTarget["target"] = {
  base: {
    rev: "set-0123456789abcdef01234567",
    shellRev: "s",
    rscShellRev: "r",
    modules: {},
    rscModules: {},
    paths: {
      baseFromProject: "../vendor",
      projectVendorDir: "pvendor",
      rscVendorBase: "rsc",
      rscRuntimeSpecifier: "rsc",
      rscRuntimePath: "rsc",
      flightServer: "flight",
      serverFnBase: "/_serverFn",
    },
  },
  project: {
    rev: "proposal-layer",
    rsc: false,
    modules: { zod: "zod" },
    css: {},
    workerOnly: [],
  },
};
/** A proposal that changed no dependencies: it builds on the site's layer. */
const siteTarget = async (): Promise<ProposalBuildTarget> => ({
  target: TARGET,
  layer: "site",
});

const SITE = {
  "src/components/Hero.tsx": "site hero",
  "src/old.ts": "old",
  "src/app.tsx": "app",
};
const OWN = { "src/components/Hero.tsx": "new hero", "src/old.ts": null };

describe("the proposal's project", () => {
  test("is the site's files with the proposal's laid over, deletes included", () => {
    expect(proposalProject(SITE, OWN)).toEqual({
      "src/components/Hero.tsx": "new hero",
      "src/app.tsx": "app",
    });
  });
});

describe("buildProposal", () => {
  test("builds the proposal's files, stops once uploaded, and serves that build for the inputs it was made of", async () => {
    const deployed: unknown[] = [];
    const served: unknown[] = [];
    const outcome = await buildProposal({
      name: NAME,
      client: {
        files: async () => ({ files: OWN, staged: staged() }),
        buildTarget: siteTarget,
        get: notRead,
        serveBuild: async (name, build) => {
          served.push([name, build]);
          return proposal("b1");
        },
      },
      deploy: async (files) => {
        deployed.push(files);
        return { status: "uploaded", publishId: "p-1" };
      },
      canBuildHere: () => true,
    });
    expect(deployed).toEqual([OWN]);
    expect(served).toEqual([[NAME, { publishId: "p-1", inputs: INPUTS }]]);
    expect(outcome).toMatchObject({ status: "built", hash: "b1" });
  });

  test("builds nothing when nothing is staged, or its build is already of them", async () => {
    const deploy = jest.fn();
    const serveBuild = jest.fn();
    expect(
      await buildProposal({
        name: NAME,
        client: {
          files: async () => ({
            files: {},
            staged: staged({ inputs: null, files: [], buildRequired: false }),
          }),
          buildTarget: siteTarget,
          get: notRead,
          serveBuild,
        },
        deploy,
        canBuildHere: () => true,
      }),
    ).toEqual({ status: "nothing-staged" });
    expect(
      await buildProposal({
        name: NAME,
        client: {
          files: async () => ({
            files: OWN,
            staged: staged({ buildRequired: false }),
          }),
          buildTarget: siteTarget,
          get: notRead,
          serveBuild,
        },
        deploy,
        canBuildHere: () => true,
      }),
    ).toEqual({ status: "already-built", hash: null });
    expect(deploy).not.toHaveBeenCalled();
    expect(serveBuild).not.toHaveBeenCalled();
  });

  test("says why when the build or serving it fails, and serves nothing that did not upload", async () => {
    const serveBuild = jest.fn();
    expect(
      await buildProposal({
        name: NAME,
        client: {
          files: async () => ({ files: OWN, staged: staged() }),
          buildTarget: siteTarget,
          get: notRead,
          serveBuild,
        },
        deploy: async () => ({
          status: "failed",
          message: "Could not build: x",
          problems: [],
        }),
        canBuildHere: () => true,
      }),
    ).toEqual({ status: "failed", message: "Could not build: x" });
    expect(serveBuild).not.toHaveBeenCalled();
    expect(
      await buildProposal({
        name: NAME,
        client: {
          files: async () => ({ files: OWN, staged: staged() }),
          buildTarget: siteTarget,
          get: notRead,
          serveBuild: async () => {
            throw new Error(
              "The proposal's files changed while it was being built. Build it again.",
            );
          },
        },
        deploy: async () => ({ status: "uploaded", publishId: "p-1" }),
        canBuildHere: () => true,
      }),
    ).toEqual({
      status: "failed",
      message:
        "The proposal's files changed while it was being built. Build it again.",
    });
  });
});

describe("buildProposal, and what it builds against", () => {
  const build = (
    buildTarget: () => Promise<ProposalBuildTarget>,
    deployed: unknown[],
  ) =>
    buildProposal({
      name: NAME,
      client: {
        files: async () => ({ files: OWN, staged: staged() }),
        buildTarget,
        get: notRead,
        serveBuild: async () => proposal("b1"),
      },
      deploy: async (_files, target) => {
        deployed.push(target);
        return { status: "uploaded", publishId: "p-1" };
      },
      canBuildHere: () => true,
    });

  test("its own layer, when it changed the dependencies", async () => {
    const deployed: unknown[] = [];
    const outcome = await build(
      async () => ({ target: TARGET, layer: "own" }),
      deployed,
    );
    expect(deployed).toEqual([TARGET]);
    expect(outcome.status).toBe("built");
  });

  test("the site's otherwise, read by the deploy as every build reads it", async () => {
    const deployed: unknown[] = [];
    await build(siteTarget, deployed);
    expect(deployed).toEqual([undefined]);
  });

  test("nothing while its dependencies are being built, or could not be: content says which", async () => {
    const deployed: unknown[] = [];
    const outcome = await build(async () => {
      throw new ProposalsApiError(
        409,
        "This proposal changed its dependencies, and they are being built. It can be built once they are.",
        { details: { layer: "pending" } },
      );
    }, deployed);
    expect(outcome).toEqual({
      status: "failed",
      message:
        "This proposal changed its dependencies, and they are being built. It can be built once they are.",
    });
    expect(deployed).toEqual([]);
  });

  test("the site's, from a content service that predates proposals' own targets", async () => {
    const deployed: unknown[] = [];
    const outcome = await build(async () => {
      throw new ProposalsApiError(404, "Not found", undefined);
    }, deployed);
    expect(deployed).toEqual([undefined]);
    expect(outcome.status).toBe("built");
  });
});

describe("buildProposal, where the browser cannot build", () => {
  test("says so, and which browsers can, before reading or building anything", async () => {
    const files = jest.fn();
    const deploy = jest.fn();
    const outcome = await buildProposal({
      name: NAME,
      client: {
        files,
        buildTarget: siteTarget,
        get: notRead,
        serveBuild: jest.fn(),
      },
      deploy,
      canBuildHere: () => false,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.message).toMatch(/Chrome/);
    expect(files).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });
});

describe("the code tools", () => {
  const deps = (
    over: Partial<CodeToolDeps> = {},
  ): CodeToolDeps & {
    staged: unknown[];
    offered: number;
  } => {
    const record = { staged: [] as unknown[], offered: 0 };
    return Object.assign(record, {
      proposal: { name: NAME },
      client: {
        files: async () => ({ files: OWN, staged: staged() }),
        stageFiles: async (
          name: string,
          files: Record<string, string | null>,
          message?: string,
        ) => {
          record.staged.push([name, files, message]);
          return {
            commit: "c1",
            staged: staged({ files: Object.keys(files).sort() }),
          };
        },
      },
      siteSource: async () => SITE,
      build: async () => ({
        status: "built" as const,
        hash: "b1",
        proposal: proposal("b1"),
      }),
      offerProposal: () => {
        record.offered++;
      },
      ...over,
    });
  };

  test("are four, and known by name", () => {
    expect(CODE_TOOLS.map((tool) => tool.name)).toEqual([
      "list_files",
      "read_file",
      "write_files",
      "build_proposal",
    ]);
    expect(isCodeTool("write_files")).toBe(true);
    expect(isCodeTool("create_patch")).toBe(false);
  });

  test("in a proposal, list and read its project, and say what is staged", async () => {
    const d = deps();
    const listed = await runCodeTool("list_files", { prefix: "src/" }, d);
    expect(listed).toEqual({
      result: {
        files: ["src/app.tsx", "src/components/Hero.tsx"],
        staged: ["src/components/Hero.tsx"],
      },
      isError: false,
    });
    const read = await runCodeTool(
      "read_file",
      { path: "src/components/Hero.tsx" },
      d,
    );
    expect(read.result).toEqual({
      path: "src/components/Hero.tsx",
      text: "new hero",
      staged: true,
    });
    const gone = await runCodeTool("read_file", { path: "src/old.ts" }, d);
    expect(gone.isError).toBe(true);
  });

  test("on the site, read the site's files", async () => {
    const d = deps({ proposal: null });
    const read = await runCodeTool("read_file", { path: "src/old.ts" }, d);
    expect(read.result).toEqual({ path: "src/old.ts", text: "old" });
  });

  test("write_files stages in the proposal the Studio is open in", async () => {
    const d = deps();
    const written = await runCodeTool(
      "write_files",
      { files: { "src/a.ts": "a", "src/b.ts": null }, message: "Add a" },
      d,
    );
    expect(written.isError).toBe(false);
    expect(d.staged).toEqual([
      [NAME, { "src/a.ts": "a", "src/b.ts": null }, "Add a"],
    ]);
    expect(written.result).toMatchObject({
      success: true,
      buildRequired: true,
    });
  });

  test("ON THE SITE, NOTHING IS WRITTEN OR BUILT, and the person is offered a proposal", async () => {
    const d = deps({ proposal: null });
    const written = await runCodeTool(
      "write_files",
      { files: { "src/a.ts": "a" } },
      d,
    );
    expect(written.isError).toBe(true);
    expect(JSON.stringify(written.result)).toMatch(/proposal/);
    const built = await runCodeTool("build_proposal", {}, d);
    expect(built.isError).toBe(true);
    expect(d.staged).toEqual([]);
    expect(d.offered).toBe(2);
  });

  test("a write that is not text is refused before anything is staged", async () => {
    const d = deps();
    expect(
      (await runCodeTool("write_files", { files: { "src/a.ts": 1 } }, d))
        .isError,
    ).toBe(true);
    expect((await runCodeTool("write_files", { files: {} }, d)).isError).toBe(
      true,
    );
    expect(d.staged).toEqual([]);
  });

  test("build_proposal reports the build, and a failure as an error", async () => {
    expect(await runCodeTool("build_proposal", {}, deps())).toEqual({
      result: { success: true, status: "built", hash: "b1" },
      isError: false,
    });
    const failed = await runCodeTool(
      "build_proposal",
      {},
      deps({
        build: async () => ({
          status: "failed",
          message: "Could not build: x",
        }),
      }),
    );
    expect(failed).toEqual({
      result: { success: false, error: "Could not build: x" },
      isError: true,
    });
  });
});

describe("buildProposal, serving the build", () => {
  /** A clock the waits move, so a four-minute wait takes no time. */
  const clock = () => {
    let at = 0;
    return {
      now: () => at,
      sleep: async (ms: number) => {
        at += ms;
      },
    };
  };
  const servedProposal = (): ProposalJson => ({
    ...proposal("b1"),
    staged: {
      files: ["src/components/Hero.tsx"],
      inputs: INPUTS,
      buildRequired: false,
    },
  });
  const notServed = (): ProposalJson => ({
    ...proposal(null),
    staged: {
      files: ["src/components/Hero.tsx"],
      inputs: INPUTS,
      buildRequired: true,
    },
  });
  const timedOut = () =>
    new ProposalsApiError(524, "The proposals API answered 524.", undefined);

  test("builds without the lockfiles, so a merge finds the build by name", async () => {
    const deployed: unknown[] = [];
    await buildProposal({
      name: NAME,
      client: {
        files: async () => ({
          files: {
            ...OWN,
            "package.json": "{}",
            "pnpm-lock.yaml": "lockfileVersion: '9.0'",
            "pnpm-workspace.yaml": "packages: []",
            "packages/a/yarn.lock": "",
          },
          staged: staged(),
        }),
        buildTarget: siteTarget,
        get: notRead,
        serveBuild: async () => proposal("b1"),
      },
      deploy: async (files) => {
        deployed.push(files);
        return { status: "uploaded", publishId: "p-1" };
      },
      canBuildHere: () => true,
    });
    expect(deployed).toEqual([{ ...OWN, "package.json": "{}" }]);
  });

  test("a gateway that gives up is not a failure: the proposal is read until it is built", async () => {
    const { now, sleep } = clock();
    const serveBuild = jest.fn().mockRejectedValue(timedOut());
    const reads = [notServed(), notServed(), servedProposal()];
    const steps: string[] = [];
    const outcome = await buildProposal({
      name: NAME,
      client: {
        files: async () => ({ files: OWN, staged: staged() }),
        buildTarget: siteTarget,
        get: async () => reads.shift() ?? servedProposal(),
        serveBuild,
      },
      deploy: async () => ({ status: "uploaded", publishId: "p-1" }),
      canBuildHere: () => true,
      onStep: (step) => steps.push(step.kind),
      now,
      sleep,
    });
    expect(outcome).toMatchObject({ status: "built", hash: "b1" });
    expect(serveBuild).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["reading", "deploying", "serving", "waiting"]);
  });

  test("a proposal never said to be built is served once more, and that answer stands", async () => {
    const { now, sleep } = clock();
    const serveBuild = jest
      .fn()
      .mockRejectedValueOnce(timedOut())
      .mockResolvedValueOnce(proposal("b2"));
    const outcome = await buildProposal({
      name: NAME,
      client: {
        files: async () => ({ files: OWN, staged: staged() }),
        buildTarget: siteTarget,
        get: async () => notServed(),
        serveBuild,
      },
      deploy: async () => ({ status: "uploaded", publishId: "p-1" }),
      canBuildHere: () => true,
      now,
      sleep,
    });
    expect(serveBuild).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ status: "built", hash: "b2" });
  });

  test("content refusing the build fails at once, in its words", async () => {
    const get = jest.fn();
    const outcome = await buildProposal({
      name: NAME,
      client: {
        files: async () => ({ files: OWN, staged: staged() }),
        buildTarget: siteTarget,
        get,
        serveBuild: async () => {
          throw new ProposalsApiError(
            409,
            "The proposal's files changed while it was being built. Build it again.",
            undefined,
          );
        },
      },
      deploy: async () => ({ status: "uploaded", publishId: "p-1" }),
      canBuildHere: () => true,
    });
    expect(outcome).toEqual({
      status: "failed",
      message:
        "The proposal's files changed while it was being built. Build it again.",
    });
    expect(get).not.toHaveBeenCalled();
  });
});
