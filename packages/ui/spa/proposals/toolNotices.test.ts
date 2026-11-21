import {
  backgroundLintOf,
  resetBackgroundLint,
  runLint,
  scheduleLint,
  untoldLintProblems,
} from "./backgroundLint";
import { stagedInputsOf } from "./backgroundChecks";
import {
  takeToolNotices,
  withToolNotices,
  type ToolNoticeSource,
} from "./toolNotices";
import type { ProposalJson, ProposalStaged } from "./proposalsClient";
import {
  resetProposalTypecheck,
  scheduleTypecheck,
} from "./useProposalTypecheck";

const mockRunProposalTypecheck = jest.fn();
jest.mock("@valbuild/shared/typecheck", () => ({
  runProposalTypecheck: (...args: unknown[]) =>
    mockRunProposalTypecheck(...args),
}));
jest.mock("../components/ValProvider", () => ({
  useCurrentProposal: () => null,
}));

const NAME = "0123456789abcdef0123";
const INPUTS = "a".repeat(64);
const LATER = "b".repeat(64);
const MODULES = `export default modules(config, [
  { def: () => import("./src/content/home.val") },
]);`;
/** A module whose path is not its own file's: Val's rules find it. */
const WRONG_PATH = `import { c, s } from "../../val.config";
export default c.define("/src/content/start.val.ts", s.string(), "Hello");`;
const TYPE_ERROR = {
  file: "src/Hero.tsx",
  line: 1,
  column: 1,
  code: 2322,
  message: "Type 'number' is not assignable to type 'string'.",
};

/** Content, as the background lint reads it: the proposal's files and what it stages. */
const lintDeps = (
  files: Record<string, string>,
  staged: Partial<ProposalStaged> = {},
) => {
  const reads = { count: 0 };
  return {
    reads,
    deps: {
      siteSource: async () => ({}),
      client: {
        files: async () => {
          reads.count++;
          return {
            files,
            staged: {
              files: Object.keys(files),
              inputs: INPUTS,
              buildRequired: false,
              ...staged,
            },
          };
        },
      },
    },
  };
};

describe("the outbox: what the background checks found, on the next tool answer", () => {
  beforeEach(() => {
    resetBackgroundLint();
    resetProposalTypecheck();
    mockRunProposalTypecheck.mockReset();
  });

  test("lint problems in what is staged are handed over once, beside the tool's own result", async () => {
    const { deps } = lintDeps({
      "val.modules.ts": MODULES,
      "src/content/home.val.ts": WRONG_PATH,
    });
    await runLint(NAME, deps);

    const notices = await takeToolNotices(NAME, async () => INPUTS);
    const answer = withToolNotices({ success: true }, notices);
    expect(answer).toMatchObject({
      result: { success: true },
      lint_problems: {
        problems: [
          {
            path: "src/content/home.val.ts",
            rule: "no-illegal-module-paths",
            fixable: true,
          },
        ],
        next: "Val's lint rules found these in what is staged. Fix them: the fixable ones with lint and fix: true, the rest in the files.",
      },
    });
    // Told: the next answer is the tool's own again.
    expect(await takeToolNotices(NAME, async () => INPUTS)).toEqual({});
  });

  test("a finding about files no longer staged is dropped, and content is not asked again", async () => {
    const { deps } = lintDeps({
      "val.modules.ts": MODULES,
      "src/content/home.val.ts": WRONG_PATH,
    });
    await runLint(NAME, deps);

    expect(await takeToolNotices(NAME, async () => LATER)).toEqual({});
    expect(untoldLintProblems(NAME)).toBeNull();
    const stagedInputs = jest.fn(async () => LATER);
    expect(await takeToolNotices(NAME, stagedInputs)).toEqual({});
    expect(stagedInputs).not.toHaveBeenCalled();
  });

  test("two answers at once hand a finding over once", async () => {
    const { deps } = lintDeps({
      "val.modules.ts": MODULES,
      "src/content/home.val.ts": WRONG_PATH,
    });
    await runLint(NAME, deps);
    const [first, second] = await Promise.all([
      takeToolNotices(NAME, async () => INPUTS),
      takeToolNotices(NAME, async () => INPUTS),
    ]);
    expect([first, second].filter((n) => "lint_problems" in n)).toHaveLength(1);
  });

  test("the background typecheck's errors go the same way, and both checks in one answer", async () => {
    mockRunProposalTypecheck.mockResolvedValue({
      status: "done",
      inputs: INPUTS,
      errors: [TYPE_ERROR],
    });
    jest.useFakeTimers();
    try {
      scheduleTypecheck(
        NAME,
        { files: jest.fn(), reportTypecheck: jest.fn() },
        () => {},
        0,
      );
      await jest.runAllTimersAsync();
    } finally {
      jest.useRealTimers();
    }
    const { deps } = lintDeps({
      "val.modules.ts": MODULES,
      "src/content/home.val.ts": WRONG_PATH,
    });
    await runLint(NAME, deps);

    const notices = await takeToolNotices(NAME, async () => INPUTS);
    expect(notices).toMatchObject({
      typecheck_errors: { newErrors: 1, errors: [TYPE_ERROR] },
      lint_problems: { problems: [{ rule: "no-illegal-module-paths" }] },
    });
    expect(await takeToolNotices(NAME, async () => INPUTS)).toEqual({});
  });

  test("nothing found: the tool's answer is exactly its own, and content is not asked what is staged", async () => {
    const stagedInputs = jest.fn(async () => INPUTS);
    const notices = await takeToolNotices(NAME, stagedInputs);
    expect(notices).toEqual({});
    expect(stagedInputs).not.toHaveBeenCalled();
    const result = { success: true };
    expect(withToolNotices(result, notices)).toBe(result);
  });

  test("when what is staged cannot be read in time, only what is not about the files goes", async () => {
    const told: string[] = [];
    const sources: ToolNoticeSource[] = [
      () => ({
        key: "tied",
        inputs: INPUTS,
        value: 1,
        failing: true,
        markTold: () => told.push("tied"),
      }),
      () => ({
        key: "untied",
        inputs: null,
        value: 2,
        failing: false,
        markTold: () => told.push("untied"),
      }),
    ];
    const notices = await takeToolNotices(NAME, () => new Promise(() => {}), {
      sources,
      waitMs: 10,
    });
    expect(notices).toEqual({ untied: 2 });
    expect(told).toEqual(["untied"]);
  });

  test("a read of what is staged that fails holds nothing back but the findings it would have confirmed", async () => {
    const { deps } = lintDeps({
      "val.modules.ts": MODULES,
      "src/content/home.val.ts": WRONG_PATH,
    });
    await runLint(NAME, deps);
    const notices = await takeToolNotices(NAME, async () => {
      throw new Error("content could not be reached");
    });
    expect(notices).toEqual({});
    expect(untoldLintProblems(NAME)).not.toBeNull();
  });
});

describe("the background lint", () => {
  beforeEach(() => resetBackgroundLint());
  afterEach(() => jest.useRealTimers());

  test("runs once after the staged files stop changing, not once per change", async () => {
    jest.useFakeTimers();
    const { deps, reads } = lintDeps({ "src/Hero.tsx": "export const a = 1;" });
    scheduleLint(NAME, deps, 2_000);
    jest.advanceTimersByTime(1_000);
    scheduleLint(NAME, deps, 2_000);
    jest.advanceTimersByTime(1_000);
    expect(reads.count).toBe(0);
    await jest.runAllTimersAsync();
    expect(reads.count).toBe(1);
    expect(backgroundLintOf(NAME)).toEqual({
      status: "done",
      name: NAME,
      inputs: INPUTS,
      problems: [],
    });
  });

  test("files already linted are not linted again", async () => {
    let lints = 0;
    const { deps } = lintDeps({ "src/Hero.tsx": "export const a = 1;" });
    const counted = {
      ...deps,
      lintCode: async () => {
        lints++;
        return { messages: [], fixed: {} };
      },
    };
    await runLint(NAME, counted);
    await runLint(NAME, counted);
    expect(lints).toBe(1);
  });

  test("nothing staged: nothing linted, nothing to tell", async () => {
    const { deps } = lintDeps({}, { inputs: null, files: [] });
    await runLint(NAME, deps);
    expect(backgroundLintOf(NAME)).toEqual({ status: "idle" });
    expect(untoldLintProblems(NAME)).toBeNull();
  });

  test("a lint that cannot read the proposal fails quietly, and tells the assistant nothing", async () => {
    await runLint(NAME, {
      siteSource: async () => ({}),
      client: {
        files: async () => {
          throw new Error("content could not be reached");
        },
      },
    });
    expect(backgroundLintOf(NAME)).toEqual({
      status: "failed",
      name: NAME,
      message: "content could not be reached",
    });
    expect(untoldLintProblems(NAME)).toBeNull();
  });
});

test("what is staged now is what content says the proposal stages", async () => {
  const proposal = (inputs: string | null): ProposalJson => ({
    name: NAME,
    branch: `val/p/${NAME}`,
    displayName: "Spring",
    status: "open",
    updatedAt: "2026-11-21T10:00:00.000Z",
    built: null,
    staged: { files: [], inputs, buildRequired: false },
  });
  expect(
    await stagedInputsOf({ get: async () => proposal(INPUTS) }, NAME),
  ).toBe(INPUTS);
  expect(await stagedInputsOf({ get: async () => proposal(null) }, NAME)).toBe(
    null,
  );
});
