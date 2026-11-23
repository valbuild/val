/**
 * @jest-environment jsdom
 */
import { reportCodeMode, resetCodeMode } from "./codeMode";
import { createCodeClients } from "./codeClients";
import { studioCodeToolDeps } from "./studioCodeTools";
import { FRESH_MS, OWN_STAGING_GRACE_MS } from "./projectSnapshot";
import { runCodeTool, type CodeToolDeps } from "./proposalCode";
import { resetStagedCode } from "./stagedCode";
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
 * What is the product's: `runCodeTool`, and everything it is handed to read,
 * write and evaluate with, made by the functions `useAI.ts` makes it with
 * (`createCodeClients`, `studioCodeToolDeps`): the proposals client, the site
 * source reader, the chat's snapshot of the project, code mode and the
 * evaluation of a staging. What is faked: the network (`countingFetch`), the
 * clock, the project's `seq` (a Studio that holds a manifest, and hears of
 * nothing during the test), and what the evaluation runs on this page with
 * no requests of its own to content -- the builder, the worker and the
 * Studio's host store -- which jest cannot run.
 *
 * `projectSnapshot.test.ts` has what ends the snapshot (someone else's
 * staging, a save, a failure); `codeToolRequests.scenario.test.ts` counts
 * the same tools against Val's real server.
 */
jest.mock("../publish/handoff", () => ({ canBuildHere: () => true }));
jest.mock("../publish/loadBuilder", () => ({
  // The builder is WebAssembly in a worker: what it is handed is the
  // product's (`target` is `publish.buildTarget()`, a request), its bundle
  // is not.
  loadBuilder: async () => ({
    // It says what the bundle read: nothing of this project, which has no
    // Val modules.
    bundleValModules: async () => ({
      code: "export default {};",
      dependencies: {},
    }),
  }),
}));
jest.mock("./evaluateTree", () => ({ evaluateTree: async () => ({}) }));
jest.mock("./stagedCode", () => ({
  ...jest.requireActual("./stagedCode"),
  importBundle: async () => ({ modules: [] }),
}));

let counted: CountingFetch;
let deps: CodeToolDeps;
/** The tab's clock. */
let now: number;

/** `CodeToolDeps`, as the code-tool handler in `useAI.ts` makes them in a proposal. */
function depsAsTheStudio(): CodeToolDeps {
  // `codeClients` in `useAI.ts`: made once, for the hook's whole life.
  const clients = createCodeClients({
    api: "/api/val",
    seq: () => 1,
    now: () => now,
  });
  return {
    ...studioCodeToolDeps(clients, {
      proposal: { name: NAME },
      nameOf: () => null,
      system: () => ({
        host: {
          reloadCode: async () => ({
            status: "reloaded",
            changed: [],
            removed: [],
            failures: [],
          }),
        },
      }),
    }),
    build: {
      start: () => Promise.reject(new Error("no build in this test")),
      running: () => null,
      report: () => ({ status: "idle", last: null }),
      cancel: () => false,
    },
    typecheck: () => Promise.reject(new Error("no typecheck in this test")),
    offerProposal: () => {},
    // Formatting and linting run in the page, on files already read.
    formatCode: async (text) => ({ status: "formatted", text: `${text}\n` }),
    lintCode: async (_project, paths) => ({
      messages: [],
      fixed: Object.fromEntries(paths.map((path) => [path, "fixed\n"])),
    }),
  };
}

/**
 * Every request a tool made: before it answered and, where the tab
 * evaluates the staging without the answer waiting for it
 * ({@link EVALUATE_STAGED}), beside it.
 */
async function run(name: string, args: Record<string, unknown>) {
  const answer = await runCodeTool(name, args, deps);
  expect(answer.isError ? answer.result : null).toBeNull();
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return counted.take();
}

/** The model thought for a while: nothing was read or staged just now. */
function later() {
  now += OWN_STAGING_GRACE_MS;
}

beforeEach(async () => {
  resetStagedCode();
  now = 1_000_000;
  counted = installCountingFetch();
  // What the top bar does with the proposal it reads: code mode is on.
  reportCodeMode({ name: NAME, displayName: "Spring", on: true });
  deps = depsAsTheStudio();
  // A chat's first tool call reads the project: the site's source and the
  // proposal's files, beside each other. The counts below are of a call
  // AFTER the first, which is what all but one call of a chat is.
  await runCodeTool("list_files", {}, deps);
  expect(counted.take().sort()).toEqual([...FIRST_READ].sort());
});
afterEach(() => {
  counted.restore();
  resetCodeMode();
});

// ---------------------------------------------------------------------------
// The counts. One list per tool: every request the tool makes before it
// answers, in order.
// ---------------------------------------------------------------------------

/** Reading the project: the site's source (by version) and the proposal's files. */
const FIRST_READ = [
  "GET /publish-api/project-source",
  "GET /proposals-api/:name/files",
];
/**
 * A read, a search, a listing: answered from the chat's snapshot of the
 * project (`projectSnapshot.ts`). Before it: {@link FIRST_READ}, every time.
 */
const READ_PROJECT: string[] = [];

/**
 * What is staged now: asked before a write that is made from a file's text,
 * so someone else's staging is edited and not overwritten, unless the files
 * were read or staged within `OWN_STAGING_GRACE_MS`. Before the snapshot
 * this request asked whether code mode is on, which Val's server now
 * answers by refusing the write.
 */
const STAGED_CHECK = ["GET /proposals-api/:name"];
const STAGE = ["POST /proposals-api/:name/files"];
/**
 * The tab evaluating `val.modules` after a staging: the build target for
 * the bundle. The project is the snapshot's. Before it: the proposal's
 * files and the site's whole source again, then the build target.
 */
const EVALUATE_STAGED = ["GET /publish-api/build-target"];

/** Before the tool answers. Before the snapshot: 2 for a read, 7, 5, 4, 4. */
const REQUESTS_BY_TOOL = {
  read_file: READ_PROJECT,
  search_code: READ_PROJECT,
  list_files: READ_PROJECT,
  edit_file: [...STAGED_CHECK, ...STAGE],
  // Writes whole files, so it reads nothing first, and checks nothing.
  write_files: STAGE,
  format_files: [...STAGED_CHECK, ...STAGE],
  lint: READ_PROJECT,
  lint_fix: [...STAGED_CHECK, ...STAGE],
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
    later();
    expect(
      await run("edit_file", {
        path: "src/components/Hero.tsx",
        old_string: "Hello",
        new_string: "Hi",
      }),
    ).toEqual([
      ...REQUESTS_BY_TOOL.edit_file,
      // Nothing was evaluated in this tab yet, so whether a component can
      // change the Val modules is not known: evaluated, and the answer does
      // not wait for it (`stagedCode.test.ts`).
      ...EVALUATE_STAGED,
    ]);
    expect(REQUESTS_BY_TOOL.edit_file).toHaveLength(2);
    // Now it is known that it cannot: nothing is evaluated.
    later();
    expect(
      await run("edit_file", {
        path: "src/components/Hero.tsx",
        old_string: "Hi",
        new_string: "Hey",
      }),
    ).toEqual(REQUESTS_BY_TOOL.edit_file);
  });

  test("edit_file right after a read or a staging of this tab's asks nothing first", async () => {
    expect(
      await run("edit_file", {
        path: "src/components/Hero.tsx",
        old_string: "Hello",
        new_string: "Hi",
      }),
    ).toEqual([...STAGE, ...EVALUATE_STAGED]);
  });

  test("write_files", async () => {
    later();
    expect(
      await run("write_files", { files: { "src/new.ts": "export {};\n" } }),
    ).toEqual([...REQUESTS_BY_TOOL.write_files, ...EVALUATE_STAGED]);
    expect(REQUESTS_BY_TOOL.write_files).toHaveLength(1);
  });

  test("write_files of a .val.ts waits for the tab to evaluate it", async () => {
    expect(
      await run("write_files", {
        files: { "content/home.val.ts": "export default null;\n" },
      }),
    ).toEqual([...STAGE, ...EVALUATE_STAGED]);
  });

  test("format_files", async () => {
    later();
    expect(
      await run("format_files", { paths: ["src/components/Hero.tsx"] }),
    ).toEqual(REQUESTS_BY_TOOL.format_files);
  });

  test("lint", async () => {
    // Nothing staged, nothing asked for: it lints nothing.
    deps = { ...deps, lintCode: async () => ({ messages: [], fixed: {} }) };
    later();
    expect(await run("lint", {})).toEqual(REQUESTS_BY_TOOL.lint);
  });

  test("lint with fix: true", async () => {
    later();
    expect(await run("lint", { fix: true, paths: ["src/app.tsx"] })).toEqual(
      REQUESTS_BY_TOOL.lint_fix,
    );
  });

  test("what is held is asked for again after a while, and only the first read of the site's source carries it", async () => {
    now += FRESH_MS;
    await runCodeTool("read_file", { path: "src/app.tsx" }, deps);
    expect(
      counted.requests
        .map((each) => [each.route, each.notModified])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["/proposals-api/:name/files", false],
      ["/publish-api/project-source", true],
    ]);
  });

  test("three edits of one model reply run one after another: one request each, and each reads what the one before wrote", async () => {
    const edit = (to: string) =>
      runCodeTool(
        "edit_file",
        { path: "src/app.tsx", old_string: "null", new_string: to },
        deps,
      );
    later();
    const answers = await Promise.all([edit("1"), edit("2"), edit("3")]);
    // The second and third find "null" gone, from the tab: each read what
    // the one before wrote, and asked nothing to do so.
    expect(answers.map((answer) => answer.isError)).toEqual([
      false,
      true,
      true,
    ]);
    expect(counted.take()).toEqual([
      ...REQUESTS_BY_TOOL.edit_file,
      ...EVALUATE_STAGED,
    ]);
  });
});
