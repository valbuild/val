import {
  buildProposal,
  buildProposalOnServer,
  CODE_TOOLS,
  editText,
  isCodeTool,
  MAX_PROJECT_INSTRUCTIONS_CHARS,
  projectInstructionsPromptSection,
  proposalProject,
  readLines,
  readProjectInstructions,
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
    formatted: unknown[];
    offered: number;
  } => {
    const record = {
      staged: [] as unknown[],
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

  test("are thirteen, and known by name", () => {
    expect(CODE_TOOLS.map((tool) => tool.name)).toEqual([
      "list_files",
      "read_file",
      "search_code",
      "edit_file",
      "write_files",
      "format_files",
      "lint",
      "typecheck",
      "typecheck_status",
      "build_proposal",
      "build_status",
      "cancel_build",
      "wait",
    ]);
    expect(isCodeTool("write_files")).toBe(true);
    // create_patch is a content tool.
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

  describe("lint, with Val's own rules", () => {
    const MODULES = `export default modules(config, [
  { def: () => import("./src/content/home.val") },
]);`;
    const lintDeps = (files: Record<string, string>, stagedFiles: string[]) => {
      const d = deps({
        siteSource: async () => ({}),
        client: {
          files: async () => ({
            files,
            staged: staged({ files: stagedFiles }),
          }),
          stageFiles: async (name, written, message) => {
            d.staged.push([name, written, message]);
            return { commit: "c5", staged: staged() };
          },
        },
      });
      return d;
    };

    test("reports what the rules find in the staged files, and that a module path can be fixed", async () => {
      const d = lintDeps(
        {
          "val.modules.ts": MODULES,
          "src/content/home.val.ts": `import { c, s } from "../../val.config";
import { Hero } from "../components/Hero";
const content = "Hello";
export default c.define("/src/content/start.val.ts", s.string(), content);`,
          "src/components/Hero.tsx": "export const Hero = () => null;",
        },
        ["src/content/home.val.ts", "src/components/Hero.tsx"],
      );
      const answer = await runCodeTool("lint", {}, d);
      expect(answer.isError).toBe(false);
      expect(answer.result).toMatchObject({
        success: true,
        linted: 2,
        next: "Fix these: the fixable ones with lint and fix: true, the rest in the files. Then lint again.",
      });
      const problems = (
        answer.result as {
          problems: { rule: string; path: string; fixable: boolean }[];
        }
      ).problems;
      expect(
        problems.map(({ path, rule, fixable }) => [path, rule, fixable]),
      ).toEqual([
        ["src/content/home.val.ts", "no-illegal-imports", false],
        ["src/content/home.val.ts", "no-illegal-module-paths", true],
        ["src/content/home.val.ts", "no-define-with-variable", false],
      ]);
      expect(d.staged).toEqual([]);
    });

    test("with fix, stages what the rules can fix", async () => {
      const d = lintDeps(
        {
          "val.modules.ts": MODULES,
          "src/content/home.val.ts": `import { c, s } from "../../val.config";
export default c.define("/src/content/start.val.ts", s.string(), "Hello");`,
        },
        ["src/content/home.val.ts"],
      );
      const answer = await runCodeTool("lint", { fix: true }, d);
      expect(answer.result).toMatchObject({
        success: true,
        problems: [],
        fixedAndStaged: ["src/content/home.val.ts"],
        next: "No problems.",
      });
      expect(d.staged).toEqual([
        [
          NAME,
          {
            "src/content/home.val.ts": `import { c, s } from "../../val.config";
export default c.define("/src/content/home.val.ts", s.string(), "Hello");`,
          },
          "Lint fixes",
        ],
      ]);
    });

    test("a module val.modules.ts no longer registers is found, though its file did not change", async () => {
      const d = lintDeps(
        {
          "val.modules.ts": "export default modules(config, []);",
          "src/content/home.val.ts": `import { c, s } from "../../val.config";
export default c.define("/src/content/home.val.ts", s.string(), "Hello");`,
        },
        ["val.modules.ts"],
      );
      const answer = await runCodeTool("lint", {}, d);
      expect(answer.result).toMatchObject({
        linted: 2,
        problems: [
          {
            path: "src/content/home.val.ts",
            line: 2,
            rule: "module-in-val-modules",
          },
        ],
      });
    });

    test("a file that does not parse says so, rather than passing", async () => {
      const d = lintDeps({ "src/broken.ts": "export const = ;" }, [
        "src/broken.ts",
      ]);
      const answer = await runCodeTool("lint", {}, d);
      expect(answer.result).toMatchObject({
        problems: [{ path: "src/broken.ts", rule: null }],
      });
    });

    test("is refused on the site", async () => {
      const answer = await runCodeTool("lint", {}, deps({ proposal: null }));
      expect(answer.isError).toBe(true);
    });
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

  test("typecheck_status says where the background typecheck is, without starting one", async () => {
    const error = {
      file: "src/components/Hero.tsx",
      line: 3,
      column: 7,
      code: 2322,
      message: "Type 'number' is not assignable to type 'string'.",
    };
    const running = await runCodeTool(
      "typecheck_status",
      {},
      deps({
        typecheckStatus: async () => ({ status: "running", step: "reading" }),
      }),
    );
    expect(running.result).toEqual({ status: "running", step: "reading" });
    const stale = await runCodeTool(
      "typecheck_status",
      {},
      deps({
        typecheckStatus: async () => ({
          status: "done",
          errors: [error],
          current: false,
        }),
      }),
    );
    expect(stale.result).toMatchObject({
      status: "done",
      current: false,
      newErrors: 1,
      errors: [error],
    });
    expect(
      (await runCodeTool("typecheck_status", {}, deps({ proposal: null })))
        .isError,
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

  test("with code mode off, the tools that change code refuse, naming who turned it off, and write nothing", async () => {
    const d = deps({
      codeMode: async () => ({
        on: false,
        by: "Kari Nordmann",
        ago: "5 minutes ago",
      }),
    });
    const written = await runCodeTool(
      "write_files",
      { files: { "src/a.ts": "a" } },
      d,
    );
    expect(written).toEqual({
      isError: true,
      result: {
        success: false,
        error: expect.stringMatching(
          /^Code mode is off in this proposal: Kari Nordmann turned it off 5 minutes ago, so its code cannot be changed now\. .*request_code_mode/,
        ),
      },
    });
    expect((await runCodeTool("format_files", {}, d)).isError).toBe(true);
    expect((await runCodeTool("lint", { fix: true }, d)).isError).toBe(true);
    expect(d.staged).toEqual([]);
    // Reading the code changes nothing, and is not refused.
    expect(
      (await runCodeTool("read_file", { path: "src/components/Hero.tsx" }, d))
        .isError,
    ).toBe(false);
  });

  test("with code mode on, write_files stages", async () => {
    const d = deps({ codeMode: async () => ({ on: true }) });
    const written = await runCodeTool(
      "write_files",
      { files: { "src/a.ts": "a" } },
      d,
    );
    expect(written.isError).toBe(false);
    expect(d.staged).toHaveLength(1);
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

  describe("edit_file", () => {
    const HERO = [
      "export function Hero() {",
      "  return <h1>Hi</h1>;",
      "}",
      "export function Footer() {",
      "  return <p>Hi</p>;",
      "}",
      "",
    ].join("\n");
    const withHero = (over: Partial<CodeToolDeps> = {}) =>
      deps({
        client: {
          files: async () => ({
            files: { ...OWN, "src/components/Hero.tsx": HERO },
            staged: staged(),
          }),
          stageFiles: async () => ({ commit: "c1", staged: staged() }),
        },
        ...over,
      });

    test("replaces the one match, and stages the file's whole new text as write_files does", async () => {
      const stagedFiles: unknown[] = [];
      const evaluated: string[] = [];
      const d = withHero({
        client: {
          files: async () => ({
            files: { ...OWN, "src/components/Hero.tsx": HERO },
            staged: staged(),
          }),
          stageFiles: async (name, files, message) => {
            stagedFiles.push([name, files, message]);
            return { commit: "c1", staged: staged() };
          },
        },
        // write_files' staging evaluates val.modules after it: so does this.
        evaluateStaged: async () => {
          evaluated.push("evaluated");
          return { status: "not-here" };
        },
      });
      const edited = await runCodeTool(
        "edit_file",
        {
          path: "/src/components/Hero.tsx",
          old_string: "<h1>Hi</h1>",
          new_string: "<h1>Hello</h1>",
          message: "Greet",
        },
        d,
      );
      expect(edited.isError).toBe(false);
      expect(stagedFiles).toEqual([
        [
          NAME,
          {
            "src/components/Hero.tsx": HERO.replace(
              "<h1>Hi</h1>",
              "<h1>Hello</h1>",
            ),
          },
          "Greet",
        ],
      ]);
      expect(evaluated).toEqual(["evaluated"]);
      expect(edited.result).toMatchObject({
        success: true,
        buildRequired: true,
        replaced: 1,
        line: 2,
      });
    });

    test("a match that is not there says to copy it from read_file, and where its first line is", async () => {
      const d = withHero();
      const edited = await runCodeTool(
        "edit_file",
        {
          path: "src/components/Hero.tsx",
          old_string: "export function Footer() {\n    return <p>Hi</p>;",
          new_string: "x",
        },
        d,
      );
      expect(edited.isError).toBe(true);
      expect(JSON.stringify(edited.result)).toMatch(/read_file/);
      expect(JSON.stringify(edited.result)).toMatch(/on line 4/);
    });

    test("several matches name their lines and the two ways on, and change nothing", async () => {
      const staging: unknown[] = [];
      const d = withHero({
        client: {
          files: async () => ({
            files: { ...OWN, "src/components/Hero.tsx": HERO },
            staged: staged(),
          }),
          stageFiles: async (_name, files) => {
            staging.push(files);
            return { commit: "c1", staged: staged() };
          },
        },
      });
      const twice = await runCodeTool(
        "edit_file",
        { path: "src/components/Hero.tsx", old_string: "Hi", new_string: "Yo" },
        d,
      );
      expect(twice.isError).toBe(true);
      expect(JSON.stringify(twice.result)).toMatch(
        /matches 2 times \(lines 2, 5\).*replace_all/,
      );
      expect(staging).toEqual([]);
      const all = await runCodeTool(
        "edit_file",
        {
          path: "src/components/Hero.tsx",
          old_string: "Hi",
          new_string: "Yo",
          replace_all: true,
        },
        d,
      );
      expect(all.result).toMatchObject({ success: true, replaced: 2 });
      expect(staging).toEqual([
        { "src/components/Hero.tsx": HERO.replace(/Hi/g, "Yo") },
      ]);
    });

    test("a staging content refuses is answered in content's words, as write_files' is", async () => {
      const refusing = (over: Partial<CodeToolDeps> = {}) =>
        withHero({
          client: {
            files: async () => ({
              files: { ...OWN, "src/components/Hero.tsx": HERO },
              staged: staged(),
            }),
            stageFiles: async () => {
              throw new Error("Build the proposal, then save.");
            },
          },
          ...over,
        });
      for (const [tool, input] of [
        [
          "edit_file",
          {
            path: "src/components/Hero.tsx",
            old_string: "<h1>Hi</h1>",
            new_string: "<h1>Yo</h1>",
          },
        ],
        ["write_files", { files: { "src/a.ts": "a" } }],
      ] as const) {
        expect(await runCodeTool(tool, input, refusing())).toEqual({
          isError: true,
          result: { success: false, error: "Build the proposal, then save." },
        });
      }
    });

    test("two edits of one file started together both land: code changes run one at a time", async () => {
      // A proposal whose staging takes a moment, as content's does: both
      // calls of one model reply arrive at once, and each must read what the
      // one before it staged.
      let files: Record<string, string | null> = {
        ...OWN,
        "src/components/Hero.tsx": HERO,
      };
      const d = withHero({
        proposal: { name: "parallel-edits" },
        client: {
          files: async () => ({ files: { ...files }, staged: staged() }),
          stageFiles: async (_name, written) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            files = { ...files, ...written };
            return { commit: "c1", staged: staged() };
          },
        },
      });
      const [first, second, read] = await Promise.all([
        runCodeTool(
          "edit_file",
          {
            path: "src/components/Hero.tsx",
            old_string: "<h1>Hi</h1>",
            new_string: "<h1>Hello</h1>",
          },
          d,
        ),
        runCodeTool(
          "edit_file",
          {
            path: "src/components/Hero.tsx",
            old_string: "<p>Hi</p>",
            new_string: "<p>Bye</p>",
          },
          d,
        ),
        // Reading does not wait for the writes.
        runCodeTool("list_files", {}, d),
      ]);
      expect(first.isError).toBe(false);
      expect(second.isError).toBe(false);
      expect(read.isError).toBe(false);
      expect(files["src/components/Hero.tsx"]).toBe(
        HERO.replace("<h1>Hi</h1>", "<h1>Hello</h1>").replace(
          "<p>Hi</p>",
          "<p>Bye</p>",
        ),
      );
    });

    test("a write that fails does not stop the ones after it", async () => {
      let calls = 0;
      const d = withHero({
        proposal: { name: "failing-then-fine" },
        client: {
          files: async () => ({
            files: { ...OWN, "src/components/Hero.tsx": HERO },
            staged: staged(),
          }),
          stageFiles: async () => {
            calls++;
            if (calls === 1) throw new Error("refused");
            return { commit: "c1", staged: staged() };
          },
        },
      });
      const [failed, written] = await Promise.all([
        runCodeTool("write_files", { files: { "src/a.ts": "a" } }, d),
        runCodeTool("write_files", { files: { "src/b.ts": "b" } }, d),
      ]);
      expect(failed.isError).toBe(true);
      expect(written.isError).toBe(false);
    });

    test("a file that does not exist is written with write_files", async () => {
      const edited = await runCodeTool(
        "edit_file",
        { path: "src/new.ts", old_string: "a", new_string: "b" },
        withHero(),
      );
      expect(edited.isError).toBe(true);
      expect(JSON.stringify(edited.result)).toMatch(/write_files/);
    });

    test("ON THE SITE, NOTHING IS WRITTEN, and the person is offered a proposal", async () => {
      const d = deps({ proposal: null });
      const edited = await runCodeTool(
        "edit_file",
        { path: "src/old.ts", old_string: "old", new_string: "new" },
        d,
      );
      expect(edited.isError).toBe(true);
      expect(d.staged).toEqual([]);
      expect(d.offered).toBe(1);
    });

    test("with code mode off, it refuses as write_files does", async () => {
      const d = deps({
        codeMode: async () => ({ on: false, by: null, ago: null }),
      });
      const edited = await runCodeTool(
        "edit_file",
        {
          path: "src/components/Hero.tsx",
          old_string: "new",
          new_string: "newer",
        },
        d,
      );
      expect(edited.isError).toBe(true);
      expect(JSON.stringify(edited.result)).toMatch(/request_code_mode/);
      expect(d.staged).toEqual([]);
    });

    test("input that is not text is refused before anything is read", async () => {
      const d = deps();
      for (const input of [
        { path: "src/a.ts", old_string: 1, new_string: "b" },
        { path: 2, old_string: "a", new_string: "b" },
        {
          path: "src/a.ts",
          old_string: "a",
          new_string: "b",
          replace_all: "yes",
        },
      ]) {
        expect((await runCodeTool("edit_file", input, d)).isError).toBe(true);
      }
      expect(d.staged).toEqual([]);
    });
  });

  describe("editText", () => {
    test("an empty or unchanged old_string is refused", () => {
      expect(editText("abc", "", "x", false).status).toBe("refused");
      expect(editText("abc", "b", "b", false).status).toBe("refused");
    });

    test("$ in the replacement is text, not a pattern", () => {
      expect(editText("a b", "b", "$&$1", false)).toEqual({
        status: "edited",
        text: "a $&$1",
        replaced: 1,
        line: 1,
      });
    });

    test("a file with Windows line breaks is matched by text written with \\n, and keeps them", () => {
      const text = "one\r\ntwo\r\nthree\r\n";
      expect(editText(text, "one\ntwo", "1\n2", false)).toMatchObject({
        status: "edited",
        text: "1\r\n2\r\nthree\r\n",
      });
    });
  });

  describe("editText, reviewed", () => {
    test("in a file with Windows line breaks, a new_string of several lines is written with them", () => {
      expect(
        editText("one\r\ntwo\r\n", "two", "two\nthree", false),
      ).toMatchObject({ status: "edited", text: "one\r\ntwo\r\nthree\r\n" });
    });

    test("a file with Unix line breaks keeps them", () => {
      expect(editText("one\ntwo\n", "two", "two\nthree", false)).toMatchObject({
        status: "edited",
        text: "one\ntwo\nthree\n",
      });
    });

    test("overlapping matches count: 'aa' in 'aaa' is two places, not one", () => {
      const edit = editText("aaa", "aa", "b", false);
      expect(edit).toMatchObject({
        status: "refused",
        message: expect.stringMatching(/matches 2 times \(line 1\)/),
      });
      expect(editText("aaa", "aa", "b", true)).toMatchObject({
        status: "edited",
        text: "ba",
        replaced: 1,
      });
    });
  });

  describe("read_file with a range", () => {
    const FILE = "one\ntwo\nthree\nfour\n";
    const withFile = (text: string) =>
      deps({
        client: {
          files: async () => ({
            files: { ...OWN, "src/f.ts": text },
            staged: staged(),
          }),
          stageFiles: async () => ({ commit: "c1", staged: staged() }),
        },
      });

    test("answers those lines exactly as in the file, with where they are", async () => {
      const read = await runCodeTool(
        "read_file",
        { path: "src/f.ts", offset: 2, limit: 2 },
        withFile(FILE),
      );
      expect(read.result).toEqual({
        path: "src/f.ts",
        text: "two\nthree\n",
        startLine: 2,
        endLine: 3,
        totalLines: 4,
        staged: false,
      });
    });

    test("offset alone reads to the end; the last line keeps having no line break", async () => {
      const read = await runCodeTool(
        "read_file",
        { path: "src/f.ts", offset: 3 },
        withFile("one\ntwo\nthree"),
      );
      expect(read.result).toMatchObject({
        text: "three",
        startLine: 3,
        endLine: 3,
        totalLines: 3,
      });
    });

    test("a range past the end, or not a line number, is refused", async () => {
      const d = withFile(FILE);
      const past = await runCodeTool(
        "read_file",
        { path: "src/f.ts", offset: 9 },
        d,
      );
      expect(past.isError).toBe(true);
      expect(JSON.stringify(past.result)).toMatch(/has 4 lines/);
      for (const range of [{ offset: 0 }, { limit: 1.5 }, { offset: "2" }]) {
        expect(
          (await runCodeTool("read_file", { path: "src/f.ts", ...range }, d))
            .isError,
        ).toBe(true);
      }
    });

    test("a file too long for one answer is cut at a line's end, and says where to read on", async () => {
      const line = "x".repeat(999) + "\n";
      const long = line.repeat(300);
      const read = await runCodeTool(
        "read_file",
        { path: "src/f.ts" },
        withFile(long),
      );
      const result = read.result;
      expect(result).toMatchObject({
        path: "src/f.ts",
        text: line.repeat(200),
        truncated: expect.stringMatching(/Lines 1-200 of 300.*offset: 201/),
      });
    });
  });

  test("readLines: every part of a file, put back together, is the file", () => {
    const text = "a\n\nb\r\nc";
    const parts = [1, 2, 3, 4].map((n) => readLines(text, n, 1));
    expect(
      parts.map((part) => (part.status === "read" ? part.text : "")).join(""),
    ).toBe(text);
    expect(readLines("", 1, null)).toMatchObject({
      status: "read",
      text: "",
      totalLines: 0,
    });
  });

  describe("the project's own instructions", () => {
    const withFiles = (files: Record<string, string | null>) => ({
      proposal: { name: NAME },
      client: {
        files: async () => ({ files: { ...OWN, ...files }, staged: staged() }),
      },
      siteSource: async () => SITE,
    });

    test("are AGENTS.md, then CLAUDE.md, at the root, as the proposal has them", async () => {
      const text = await readProjectInstructions(
        withFiles({
          ".claude/CLAUDE.md": "Use pnpm.",
          "AGENTS.md": "Run the tests.",
          "src/AGENTS.md": "Not the root's.",
        }),
      );
      expect(text).toBe(
        "### AGENTS.md\nRun the tests.\n\n### .claude/CLAUDE.md\nUse pnpm.",
      );
      expect(projectInstructionsPromptSection(text)).toMatch(
        /## The project's own instructions\n.*not Val's/,
      );
    });

    test("none is normal, and says nothing", async () => {
      expect(await readProjectInstructions(withFiles({}))).toBeNull();
      expect(projectInstructionsPromptSection(null)).toBe("");
    });

    test("are cut to one bound, saying where the rest is", async () => {
      const text = await readProjectInstructions(
        withFiles({
          "AGENTS.md": "a".repeat(MAX_PROJECT_INSTRUCTIONS_CHARS + 10),
          "CLAUDE.md": "More.",
        }),
      );
      expect(text?.length).toBeLessThan(MAX_PROJECT_INSTRUCTIONS_CHARS + 300);
      expect(text).toMatch(/read_file AGENTS\.md for it/);
      expect(text).toMatch(
        /### CLAUDE\.md\n\(Not included: read_file CLAUDE\.md/,
      );
    });
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

describe("buildProposalOnServer: Val Build builds it", () => {
  const clock = () => {
    let at = 0;
    return {
      now: () => at,
      sleep: async (ms: number) => {
        at += ms;
      },
    };
  };
  /** The proposal as a read of one answers it: with what is staged. */
  const read = (
    over: Partial<ProposalJson> = {},
    stagedOver: Partial<ProposalStaged> = {},
  ): ProposalJson => ({
    ...proposal(null),
    staged: staged(stagedOver),
    ...over,
  });
  const pending = (inputs = INPUTS): ProposalJson =>
    read({ serverBuild: { state: "pending", inputs, error: null } });
  const failed = (error: string, inputs = INPUTS): ProposalJson =>
    read({ serverBuild: { state: "failed", inputs, error } });
  const served = (hash: string): ProposalJson =>
    read(
      { built: { hash, inputs: INPUTS }, serverBuild: null },
      { buildRequired: false },
    );
  const off = () =>
    new ProposalsApiError(
      409,
      "Val Build does not build this project's proposals yet: build it in the Studio.",
      { details: { code: "server-builds-off" } },
    );
  /** `get` answering `reads` in turn, the first being what is staged. */
  const reading = (reads: ProposalJson[]) => async () => {
    const next = reads.shift();
    if (next === undefined) throw new Error("read once too often");
    return next;
  };

  test("is asked once, and the proposal is read until it says the build is served", async () => {
    const { now, sleep } = clock();
    const askBuild = jest.fn().mockResolvedValue(pending());
    const steps: string[] = [];
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: reading([read(), pending(), pending(), served("b1")]),
        askBuild,
      },
      onStep: (step) => steps.push(step.kind),
      now,
      sleep,
    });
    expect(outcome).toMatchObject({ status: "built", hash: "b1" });
    expect(askBuild).toHaveBeenCalledWith(NAME, INPUTS);
    expect(askBuild).toHaveBeenCalledTimes(1);
    expect(steps[0]).toBe("reading");
    expect(new Set(steps.slice(1))).toEqual(new Set(["on-server"]));
  });

  test("while it waits, it says how far Val Build says the build is", async () => {
    const { now, sleep } = clock();
    const said = [
      { queued: 1, step: null, built: false },
      {
        queued: null,
        step: { label: "Building the site", index: 3, of: 4 },
        built: false,
      },
    ];
    const progress: unknown[] = [];
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: reading([read(), pending(), pending(), served("b1")]),
        askBuild: async () => pending(),
        buildProgress: async (_name, inputs) => {
          expect(inputs).toBe(INPUTS);
          return said.shift() ?? null;
        },
      },
      onStep: (step) => {
        if (step.kind === "on-server" && step.progress)
          progress.push(step.progress);
      },
      now,
      sleep,
    });
    expect(outcome).toMatchObject({ status: "built", hash: "b1" });
    expect(progress).toEqual([
      { queued: 1, step: null, built: false },
      {
        queued: null,
        step: { label: "Building the site", index: 3, of: 4 },
        built: false,
      },
    ]);
  });

  test("a progress read that fails is no progress, and the build is still waited for", async () => {
    const { now, sleep } = clock();
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: reading([read(), pending(), served("b1")]),
        askBuild: async () => pending(),
        buildProgress: async () => {
          throw new Error("Val Build could not be reached.");
        },
      },
      now,
      sleep,
    });
    expect(outcome).toMatchObject({ status: "built", hash: "b1" });
  });

  test("a project Val Build does not build yet is off, nothing else is asked, and no step says it built there", async () => {
    const get = jest.fn().mockResolvedValue(read());
    const steps: string[] = [];
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get,
        askBuild: async () => {
          throw off();
        },
      },
      onStep: (step) => steps.push(step.kind),
    });
    expect(outcome).toEqual({ status: "off" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["reading"]);
  });

  test("content from before Val Build built anything is off too: it refuses the request as an invalid body", async () => {
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: async () => read(),
        askBuild: async () => {
          throw new ProposalsApiError(
            400,
            'Invalid body. Error: Validation error: Required at "publishId"',
            undefined,
          );
        },
      },
    });
    expect(outcome).toEqual({ status: "off" });
  });

  test("a build it could not make fails in its words; one of other inputs is not this build's", async () => {
    const { now, sleep } = clock();
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: reading([
          read(),
          failed("an older build's failure", "b".repeat(64)),
          failed("The build failed: SyntaxError: Unexpected token (16:21)"),
        ]),
        askBuild: async () => pending(),
      },
      now,
      sleep,
    });
    expect(outcome).toEqual({
      status: "failed",
      message: "The build failed: SyntaxError: Unexpected token (16:21)",
    });
  });

  test("files staged again meanwhile end the wait at once: this build will not be served", async () => {
    const { now, sleep } = clock();
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: reading([
          read(),
          read(
            {
              serverBuild: {
                state: "pending",
                inputs: "b".repeat(64),
                error: null,
              },
            },
            { inputs: "b".repeat(64) },
          ),
        ]),
        askBuild: async () => pending(),
      },
      now,
      sleep,
    });
    expect(outcome).toEqual({
      status: "failed",
      message:
        "The proposal's files changed while it was being built. Build it again.",
    });
  });

  test("a read a gateway gave up on is asked again; a refusal (signed out) fails at once, in content's words", async () => {
    const { now, sleep } = clock();
    const reads: (ProposalJson | Error)[] = [
      read(),
      new ProposalsApiError(524, "The proposals API answered 524.", undefined),
      served("b1"),
    ];
    const answer = async () => {
      const next = reads.shift()!;
      if (next instanceof Error) throw next;
      return next;
    };
    expect(
      await buildProposalOnServer({
        name: NAME,
        client: { get: answer, askBuild: async () => pending() },
        now,
        sleep,
      }),
    ).toMatchObject({ status: "built", hash: "b1" });

    const signedOut = [
      read(),
      new ProposalsApiError(401, "Not signed in", undefined),
    ];
    const refuse = async () => {
      const next = signedOut.shift()!;
      if (next instanceof Error) throw next;
      return next;
    };
    expect(
      await buildProposalOnServer({
        name: NAME,
        client: { get: refuse, askBuild: async () => pending() },
        now,
        sleep,
      }),
    ).toEqual({ status: "failed", message: "Not signed in" });
  });

  test("any other refusal of the build fails at once, in content's words", async () => {
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: async () => read(),
        askBuild: async () => {
          throw new ProposalsApiError(
            409,
            "The proposal's files changed while it was being built. Build it again.",
            undefined,
          );
        },
      },
    });
    expect(outcome).toEqual({
      status: "failed",
      message:
        "The proposal's files changed while it was being built. Build it again.",
    });
  });

  test("nothing staged, or built already, asks for nothing", async () => {
    const askBuild = jest.fn();
    for (const [over, status] of [
      [{ inputs: null }, "nothing-staged"],
      [{ buildRequired: false }, "already-built"],
    ] as const) {
      const outcome = await buildProposalOnServer({
        name: NAME,
        client: { get: async () => read({}, over), askBuild },
      });
      expect(outcome.status).toBe(status);
    }
    expect(askBuild).not.toHaveBeenCalled();
  });

  test("a build never said to be served is given up on, and says to try again", async () => {
    const { now, sleep } = clock();
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: { get: async () => pending(), askBuild: async () => pending() },
      now,
      sleep,
    });
    expect(outcome).toEqual({
      status: "failed",
      message: "Val Build did not finish the build in 4 minutes. Try again.",
    });
  });

  test("a cancel stops the waiting, and is no failure", async () => {
    const controller = new AbortController();
    const outcome = await buildProposalOnServer({
      name: NAME,
      client: {
        get: async () => pending(),
        askBuild: async () => {
          controller.abort();
          return pending();
        },
      },
      signal: controller.signal,
    });
    expect(outcome).toMatchObject({ status: "failed", cancelled: true });
  });
});
