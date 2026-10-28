import {
  buildProposal,
  CODE_TOOLS,
  isCodeTool,
  proposalProject,
  runCodeTool,
  type BuildReport,
  type CodeToolDeps,
  type ProposalBuildControl,
  type ProposalBuildOutcome,
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
/** A build the tools reach, answering `start` and reporting `report`. */
const control = (
  start: () => Promise<ProposalBuildOutcome>,
  over: Partial<ProposalBuildControl> = {},
): ProposalBuildControl => ({
  start,
  running: () => null,
  report: (): BuildReport => ({ status: "idle", last: null }),
  cancel: () => false,
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

  test("a cancel ends it at once, and a build stopped mid-deploy is never served", async () => {
    const controller = new AbortController();
    const serveBuild = jest.fn();
    let deploySignal: AbortSignal | undefined;
    const building = buildProposal({
      name: NAME,
      client: {
        files: async () => ({ files: OWN, staged: staged() }),
        buildTarget: siteTarget,
        get: notRead,
        serveBuild,
      },
      // A deploy that never answers: an upload that hangs.
      deploy: (_files, _target, signal) => {
        deploySignal = signal;
        return new Promise(() => {});
      },
      canBuildHere: () => true,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await building).toEqual({
      status: "failed",
      message: "The build was cancelled.",
      cancelled: true,
    });
    // The deploy was handed the signal, to stop what it was doing.
    expect(deploySignal?.aborted).toBe(true);
    expect(serveBuild).not.toHaveBeenCalled();
  });

  test("stopped with an error of its own -- a stall -- it fails with that error", async () => {
    const controller = new AbortController();
    const building = buildProposal({
      name: NAME,
      client: {
        files: () => new Promise(() => {}),
        buildTarget: siteTarget,
        get: notRead,
        serveBuild: notRead,
      },
      deploy: async () => ({ status: "uploaded", publishId: "p-1" }),
      canBuildHere: () => true,
      signal: controller.signal,
    });
    controller.abort(new Error("Stalled while reading the proposal."));
    expect(await building).toEqual({
      status: "failed",
      message: "Stalled while reading the proposal.",
    });
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
    patched: unknown[];
    formatted: unknown[];
    offered: number;
  } => {
    const record = {
      staged: [] as unknown[],
      patched: [] as unknown[],
      formatted: [] as unknown[],
      offered: 0,
    };
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
        patchFile: async (
          name: string,
          moduleFilePath: string,
          patch: unknown[],
          message?: string,
        ) => {
          record.patched.push([name, moduleFilePath, patch, message]);
          return {
            commit: "c2",
            staged: staged({ files: [moduleFilePath.slice(1)] }),
          };
        },
      },
      // Stands in for prettier: collapses runs of spaces.
      formatCode: async (text: string, path: string) => {
        record.formatted.push(path);
        return {
          status: "formatted" as const,
          text: text.replace(/ {2,}/g, " "),
        };
      },
      typecheck: async () => ({ status: "nothing-staged" as const }),
      siteSource: async () => SITE,
      build: control(async () => ({
        status: "built" as const,
        hash: "b1",
        proposal: proposal("b1"),
      })),
      offerProposal: () => {
        record.offered++;
      },
      ...over,
    });
  };

  test("are ten, and known by name", () => {
    expect(CODE_TOOLS.map((tool) => tool.name)).toEqual([
      "list_files",
      "read_file",
      "search_code",
      "write_files",
      "format_files",
      "typecheck",
      "build_proposal",
      "build_status",
      "cancel_build",
      "wait",
    ]);
    expect(isCodeTool("write_files")).toBe(true);
    // The Studio's create_patch is a content tool; the design tab's is
    // dispatched as code by the tab, not by name.
    expect(isCodeTool("create_patch")).toBe(false);
  });

  test("search the project as grep would: every matching line, where it is", async () => {
    const d = deps({
      siteSource: async () => ({
        ...SITE,
        "src/app.tsx": "import { Hero } from './components/Hero';\n<Hero />\n",
        "pnpm-lock.yaml": "Hero: 1.0.0",
      }),
    });
    const found = await runCodeTool("search_code", { query: "Hero" }, d);
    expect(found).toEqual({
      result: {
        matches: [
          {
            path: "src/app.tsx",
            line: 1,
            text: "import { Hero } from './components/Hero';",
          },
          { path: "src/app.tsx", line: 2, text: "<Hero />" },
        ],
        total: 2,
      },
      isError: false,
    });
    // The proposal's copy, case aside, by a regular expression, narrowed.
    const own = await runCodeTool(
      "search_code",
      {
        query: "^NEW",
        regex: true,
        ignore_case: true,
        prefix: "src/components/",
      },
      d,
    );
    expect(own.result).toEqual({
      matches: [{ path: "src/components/Hero.tsx", line: 1, text: "new hero" }],
      total: 1,
    });
    const capped = await runCodeTool(
      "search_code",
      { query: "Hero", max_results: 1 },
      d,
    );
    expect(capped.result).toMatchObject({
      total: 2,
      truncated: expect.any(String),
    });
    expect(
      (await runCodeTool("search_code", { query: "(", regex: true }, d))
        .isError,
    ).toBe(true);
  });

  test("create_patch writes content into the module's file in the proposal, staged with its code", async () => {
    const d = deps();
    const patch = [{ op: "replace", path: ["title"], value: "Worn for years" }];
    const answer = await runCodeTool(
      "create_patch",
      { module_file_path: "/content/home.val.ts", patch, message: "Title" },
      d,
    );
    expect(d.patched).toEqual([[NAME, "/content/home.val.ts", patch, "Title"]]);
    expect(answer).toMatchObject({
      result: { success: true, staged: ["content/home.val.ts"] },
      isError: false,
    });
    expect(
      (await runCodeTool("create_patch", { module_file_path: "/a.val.ts" }, d))
        .isError,
    ).toBe(true);
  });

  test("format_files formats what the proposal stages as the project does, and stages what changed", async () => {
    const d = deps({
      client: {
        files: async () => ({
          files: {
            "src/components/Hero.tsx": "const  hero =  1;",
            "src/tidy.ts": "ok",
          },
          staged: staged({ files: ["src/components/Hero.tsx", "src/tidy.ts"] }),
        }),
        stageFiles: async (name, files, message) => {
          d.staged.push([name, files, message]);
          return { commit: "c3", staged: staged() };
        },
        patchFile: async () => ({ commit: "c4", staged: staged() }),
      },
    });
    const answer = await runCodeTool("format_files", {}, d);
    expect(d.formatted).toEqual(["src/components/Hero.tsx", "src/tidy.ts"]);
    expect(answer).toEqual({
      result: {
        success: true,
        files: [
          { path: "src/components/Hero.tsx", status: "changed" },
          { path: "src/tidy.ts", status: "unchanged" },
        ],
        next: "The changed files are staged, formatted.",
      },
      isError: false,
    });
    expect(d.staged).toEqual([
      [NAME, { "src/components/Hero.tsx": "const hero = 1;" }, "Format"],
    ]);
  });

  test("format_files without write only reports, and says what it cannot format", async () => {
    const d = deps({
      formatCode: async (_text, path) =>
        path === "src/components/Hero.tsx"
          ? { status: "formatted", text: "changed" }
          : {
              status: "unsupported",
              message: "Prettier does not format it here.",
            },
    });
    const answer = await runCodeTool(
      "format_files",
      {
        paths: ["src/components/Hero.tsx", "src/app.tsx", "src/nope.ts"],
        write: false,
      },
      d,
    );
    expect(answer.result).toMatchObject({
      files: [
        { path: "src/components/Hero.tsx", status: "changed" },
        {
          path: "src/app.tsx",
          status: "unsupported",
          message: "Prettier does not format it here.",
        },
        { path: "src/nope.ts", status: "missing" },
      ],
      next: "Call format_files again with write: true to stage these formatted.",
    });
    expect(d.staged).toEqual([]);
    expect(
      (await runCodeTool("format_files", { paths: "src/app.tsx" }, d)).isError,
    ).toBe(true);
    expect(
      (await runCodeTool("format_files", {}, deps({ proposal: null }))).isError,
    ).toBe(true);
  });

  test("typecheck answers the errors the proposal adds, and what to do next", async () => {
    const error = {
      file: "src/components/Hero.tsx",
      line: 3,
      column: 7,
      code: 2322,
      message: "Type 'number' is not assignable to type 'string'.",
    };
    const failing = await runCodeTool(
      "typecheck",
      {},
      deps({ typecheck: async () => ({ status: "done", errors: [error] }) }),
    );
    expect(failing).toEqual({
      result: {
        success: true,
        newErrors: 1,
        errors: [error],
        next: "Fix these in the files, then typecheck again.",
      },
      isError: false,
    });
    const clean = await runCodeTool(
      "typecheck",
      {},
      deps({ typecheck: async () => ({ status: "done", errors: [] }) }),
    );
    expect(clean.result).toMatchObject({ newErrors: 0 });
    const broken = await runCodeTool(
      "typecheck",
      {},
      deps({
        typecheck: async () => ({ status: "failed", message: "adept is down" }),
      }),
    );
    expect(broken.isError).toBe(true);
    expect(
      (await runCodeTool("typecheck", {}, deps({ proposal: null }))).isError,
    ).toBe(true);
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
        build: control(async () => ({
          status: "failed",
          message: "Could not build: x",
        })),
      }),
    );
    expect(failed).toEqual({
      result: { success: false, error: "Could not build: x" },
      isError: true,
    });
  });

  test("build_proposal answers with each step's time once the build ends", async () => {
    const last = {
      status: "built" as const,
      seconds: 31.5,
      steps: [
        { step: "Building", seconds: 12.1 },
        { step: "Serving the build at the proposal's address", seconds: 19.4 },
      ],
      ended_seconds_ago: 0,
    };
    const answer = await runCodeTool(
      "build_proposal",
      {},
      deps({
        build: control(
          async () => ({
            status: "built",
            hash: "b1",
            proposal: proposal("b1"),
          }),
          { report: () => ({ status: "idle", last }) },
        ),
      }),
    );
    expect(answer.result).toEqual({
      success: true,
      status: "built",
      hash: "b1",
      seconds: 31.5,
      steps: last.steps,
    });
  });

  test("build_proposal does not hold the turn past wait_seconds: the build goes on", async () => {
    const building: BuildReport = {
      status: "building",
      step: "Uploading",
      elapsed_seconds: 30,
      steps: [{ step: "Building", seconds: 20 }],
    };
    const waited: number[] = [];
    const answer = await runCodeTool(
      "build_proposal",
      { wait_seconds: 30 },
      deps({
        build: control(() => new Promise<ProposalBuildOutcome>(() => {}), {
          report: () => building,
        }),
        sleep: async (ms) => {
          waited.push(ms);
        },
      }),
    );
    expect(waited).toEqual([30_000]);
    expect(answer.isError).toBe(false);
    expect(answer.result).toMatchObject({
      success: true,
      status: "building",
      step: "Uploading",
    });
  });

  test("wait ends when the running build does, and answers its status", async () => {
    let report: BuildReport = {
      status: "building",
      step: "Building",
      elapsed_seconds: 1,
      steps: [],
    };
    let finish: (outcome: ProposalBuildOutcome) => void = () => {};
    const running = new Promise<ProposalBuildOutcome>((resolve) => {
      finish = resolve;
    });
    const waiting = runCodeTool(
      "wait",
      { seconds: 120 },
      deps({
        build: control(() => running, {
          running: () => running,
          report: () => report,
        }),
        // Never ends on its own: only the build can end the wait.
        sleep: () => new Promise<void>(() => {}),
      }),
    );
    report = { status: "idle", last: null };
    finish({ status: "built", hash: "b2", proposal: proposal("b2") });
    const answer = await waiting;
    expect(answer.result).toMatchObject({
      build: { status: "idle" },
    });
  });

  test("wait refuses a duration it cannot wait", async () => {
    const answer = await runCodeTool("wait", { seconds: "soon" }, deps());
    expect(answer.isError).toBe(true);
  });

  test("cancel_build stops the running build, and says when there was none", async () => {
    let cancels = 0;
    const d = deps({
      build: control(async () => ({ status: "nothing-staged" }), {
        cancel: () => {
          cancels++;
          return cancels === 1;
        },
      }),
    });
    expect((await runCodeTool("cancel_build", {}, d)).result).toMatchObject({
      cancelled: true,
    });
    expect((await runCodeTool("cancel_build", {}, d)).result).toMatchObject({
      cancelled: false,
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
