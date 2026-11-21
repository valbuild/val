import { createProjectSourceReader } from "@valbuild/shared/internal";
import { readCodeMode } from "./codeMode";
import { runCodeTool, type CodeToolDeps } from "./proposalCode";
import { createProposalsClient } from "./proposalsClient";
import { resetStagedCode, runStagedCode } from "./stagedCode";
import { studioStagedCodeDeps } from "./studioStagedCode";
import {
  installCountingFetch,
  NAME,
  type CountingFetch,
} from "./__fixtures__/countingFetch";

/*
 * How many requests each of the assistant's code tools makes: the counted
 * work behind "a code-mode change feels slow". Every request is a round trip
 * through the app's `/api/val` relay to content, and the tool's answer --
 * and so the model's next step -- waits for all of them.
 *
 * COUNTS, never milliseconds: a count is the same on every machine
 * (`scenarios/measure/README.md`). Each tool has ONE expectation below,
 * naming every request in order. When a change lowers one, change its list;
 * when a change raises one, that is the regression this file is for.
 *
 * What is the product's: `runCodeTool`, the proposals client, the site
 * source reader, `readCodeMode`, `runStagedCode` and `studioStagedCodeDeps`.
 * What is faked: the network (`countingFetch`), and what the evaluation runs
 * on this page with no requests of its own to content -- the builder, the
 * worker and the Studio's host store -- which jest cannot run.
 *
 * The tools' deps are put together here as the handler in `useAI.ts` puts
 * them together, because that wiring is written inline in the handler and
 * cannot be called from a test. It is the one part of this that is a copy:
 * when the wiring gets a function of its own, call it from `depsAsTheStudio`.
 */
jest.mock("../publish/handoff", () => ({ canBuildHere: () => true }));
jest.mock("../publish/loadBuilder", () => ({
  // The builder is WebAssembly in a worker: what it is handed is the
  // product's (`target` is `publish.buildTarget()`, a request), its bundle
  // is not.
  loadBuilder: async () => ({
    bundleValModules: async () => ({ code: "export default {};" }),
  }),
}));
jest.mock("./evaluateTree", () => ({ evaluateTree: async () => ({}) }));
jest.mock("./stagedCode", () => ({
  ...jest.requireActual("./stagedCode"),
  importBundle: async () => ({ modules: [] }),
}));

let counted: CountingFetch;
let deps: CodeToolDeps;

/** `CodeToolDeps`, as the code-tool handler in `useAI.ts` makes them in a proposal. */
function depsAsTheStudio(): CodeToolDeps {
  // `codeClients` in `useAI.ts`: made once, for the hook's whole life.
  const proposals = createProposalsClient({ api: "/api/val" });
  const siteSource = createProjectSourceReader({ api: "/api/val" });
  return {
    proposal: { name: NAME },
    client: proposals,
    siteSource,
    build: {
      start: () => Promise.reject(new Error("no build in this test")),
      running: () => null,
      report: () => ({ status: "idle", last: null }),
      cancel: () => false,
    },
    typecheck: () => Promise.reject(new Error("no typecheck in this test")),
    offerProposal: () => {},
    codeMode: () => readCodeMode(proposals, NAME, () => null),
    evaluateStaged: () =>
      runStagedCode(
        NAME,
        studioStagedCodeDeps(NAME, proposals, {
          host: {
            reloadCode: async () => ({
              status: "reloaded",
              changed: [],
              removed: [],
              failures: [],
            }),
          },
        }),
      ),
    // Formatting and linting run in the page, on files already read.
    formatCode: async (text) => ({ status: "formatted", text: `${text}\n` }),
    lintCode: async (_project, paths) => ({
      messages: [],
      fixed: Object.fromEntries(paths.map((path) => [path, "fixed\n"])),
    }),
  };
}

async function run(name: string, args: Record<string, unknown>) {
  const answer = await runCodeTool(name, args, deps);
  expect(answer.isError ? answer.result : null).toBeNull();
  return counted.take();
}

beforeEach(async () => {
  resetStagedCode();
  counted = installCountingFetch();
  deps = depsAsTheStudio();
  // A turn's first tool call reads the site's source whole; every one after
  // it asks whether it changed. The counts below are of a call AFTER the
  // first, which is what all but one call of a turn is.
  await runCodeTool("list_files", {}, deps);
  expect(counted.take()).toEqual(FIRST_READ);
});
afterEach(() => counted.restore());

// ---------------------------------------------------------------------------
// The counts. One list per tool: every request the tool makes before it
// answers, in order.
// ---------------------------------------------------------------------------

/** Reading the project: the site's source (by version), then the proposal's files. */
const READ_PROJECT = [
  "GET /publish-api/project-source",
  "GET /proposals-api/:name/files",
];
/** The same two requests: the first read is only larger, not more. */
const FIRST_READ = READ_PROJECT;

/** Is code mode still on: asked before every tool that changes code. */
const CODE_MODE_CHECK = ["GET /proposals-api/:name"];
const STAGE = ["POST /proposals-api/:name/files"];
/**
 * The tab evaluating `val.modules` after a staging, which the answer waits
 * for: the proposal's files and the site's source again (a publish client
 * made for this one read, so the source is sent whole), then the build
 * target for the bundle.
 */
const EVALUATE_STAGED = [
  "GET /proposals-api/:name/files",
  "GET /publish-api/project-source",
  "GET /publish-api/build-target",
];

const REQUESTS_BY_TOOL = {
  read_file: READ_PROJECT,
  search_code: READ_PROJECT,
  list_files: READ_PROJECT,
  edit_file: [
    ...CODE_MODE_CHECK,
    ...READ_PROJECT,
    ...STAGE,
    ...EVALUATE_STAGED,
  ],
  // Writes whole files, so it reads nothing first.
  write_files: [...CODE_MODE_CHECK, ...STAGE, ...EVALUATE_STAGED],
  // Staged without the evaluation `edit_file` and `write_files` wait for.
  format_files: [...CODE_MODE_CHECK, ...READ_PROJECT, ...STAGE],
  lint: READ_PROJECT,
  lint_fix: [...CODE_MODE_CHECK, ...READ_PROJECT, ...STAGE],
};

describe("requests a code tool makes before it answers", () => {
  test("read_file", async () => {
    expect(await run("read_file", { path: "src/app.tsx" })).toEqual(
      REQUESTS_BY_TOOL.read_file,
    );
  });

  test("search_code", async () => {
    expect(await run("search_code", { query: "Hero" })).toEqual(
      REQUESTS_BY_TOOL.search_code,
    );
  });

  test("list_files", async () => {
    expect(await run("list_files", {})).toEqual(REQUESTS_BY_TOOL.list_files);
  });

  test("edit_file", async () => {
    expect(
      await run("edit_file", {
        path: "src/components/Hero.tsx",
        old_string: "Hello",
        new_string: "Hi",
      }),
    ).toEqual(REQUESTS_BY_TOOL.edit_file);
    expect(REQUESTS_BY_TOOL.edit_file).toHaveLength(7);
  });

  test("write_files", async () => {
    expect(
      await run("write_files", { files: { "src/new.ts": "export {};\n" } }),
    ).toEqual(REQUESTS_BY_TOOL.write_files);
    expect(REQUESTS_BY_TOOL.write_files).toHaveLength(5);
  });

  test("format_files", async () => {
    expect(
      await run("format_files", { paths: ["src/components/Hero.tsx"] }),
    ).toEqual(REQUESTS_BY_TOOL.format_files);
  });

  test("lint", async () => {
    // Nothing staged, nothing asked for: it lints nothing, and still reads.
    deps = { ...deps, lintCode: async () => ({ messages: [], fixed: {} }) };
    expect(await run("lint", {})).toEqual(REQUESTS_BY_TOOL.lint);
  });

  test("lint with fix: true", async () => {
    expect(await run("lint", { fix: true, paths: ["src/app.tsx"] })).toEqual(
      REQUESTS_BY_TOOL.lint_fix,
    );
  });

  test("only the first read of the site's source carries it: the rest are answered not modified", async () => {
    await run("read_file", { path: "src/app.tsx" });
    await runCodeTool("read_file", { path: "src/app.tsx" }, deps);
    expect(
      counted.requests.map((each) => [each.route, each.notModified]),
    ).toEqual([
      ["/publish-api/project-source", true],
      ["/proposals-api/:name/files", false],
    ]);
  });

  test("three edits of one model reply run one after another: three times one edit", async () => {
    const edit = (to: string) =>
      runCodeTool(
        "edit_file",
        { path: "src/app.tsx", old_string: "null", new_string: to },
        deps,
      );
    await Promise.all([edit("1"), edit("2"), edit("3")]);
    // The second and third find "null" gone: they fail after their read,
    // which is the point -- each read what the one before wrote.
    expect(counted.take()).toEqual([
      ...REQUESTS_BY_TOOL.edit_file,
      ...CODE_MODE_CHECK,
      ...READ_PROJECT,
      ...CODE_MODE_CHECK,
      ...READ_PROJECT,
    ]);
  });
});
