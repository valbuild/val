import type { PageSnapshot } from "@valbuild/shared/internal";
import {
  askPageCheck,
  checksLine,
  MESSAGE_VERIFIER_TOOL,
  noteForMain,
  PAGE_CHECK_TOOLS,
  pageCheckPrompt,
  pageCheckReported,
  pickPageCheckModel,
  resetPageCheck,
  runPageCheckTool,
  VERIFY_TOOL,
  type PageCheckAsk,
  type PageCheckReport,
  type PageCheckToolDeps,
} from "./pageCheck";
import { resetBackgroundLint } from "./backgroundLint";
import { takeToolNotices } from "./toolNotices";
import { resetProposalTypecheck } from "./useProposalTypecheck";
import type { PageCheckAsked } from "./pageCheckScheduler";

jest.mock("../components/ValProvider", () => ({
  useCurrentProposal: () => null,
}));

const NAME = "0123456789abcdef0123";
const INPUTS = "a".repeat(64);
const HERO = "export const Hero = () => <h1>Spring sale</h1>;";

/** The page check's tools, over a proposal with one file and a page that answers `page`. */
const deps = (
  over: Partial<PageCheckToolDeps> = {},
): PageCheckToolDeps & {
  reports: PageCheckReport[];
  notes: string[];
  staged: unknown[];
} => {
  const reports: PageCheckReport[] = [];
  const notes: string[] = [];
  const staged: unknown[] = [];
  return {
    reports,
    notes,
    staged,
    readPage: null,
    readPageLog: null,
    project: {
      proposal: { name: NAME },
      siteSource: async () => ({}),
      client: {
        files: async () => ({
          files: { "src/Hero.tsx": HERO },
          staged: {
            files: ["src/Hero.tsx"],
            inputs: INPUTS,
            buildRequired: false,
          },
        }),
      },
    },
    onReport: (report) => reports.push(report),
    onMessage: (text) => notes.push(text),
    ...over,
  };
};

describe("the page check's tools", () => {
  beforeEach(() => {
    resetPageCheck();
    resetBackgroundLint();
    resetProposalTypecheck();
  });

  test("it is given tools that read and report, and none that change anything or click", () => {
    expect(PAGE_CHECK_TOOLS.map((tool) => tool.name)).toEqual([
      "read_page",
      "read_page_log",
      "list_files",
      "read_file",
      "search_code",
      "report",
      "message_main",
    ]);
  });

  test("reads the proposal's code as the assistant does", async () => {
    const answer = await runPageCheckTool(
      "read_file",
      { path: "src/Hero.tsx" },
      deps(),
    );
    expect(answer.isError).toBe(false);
    expect(JSON.stringify(answer.result)).toContain("Spring sale");
  });

  test("a tool it was not given is refused before it runs, and nothing is staged", async () => {
    for (const name of ["write_files", "edit_file", "interact_page", "lint"]) {
      const d = deps();
      const answer = await runPageCheckTool(
        name,
        { files: { "src/Hero.tsx": "" } },
        d,
      );
      expect(answer.isError).toBe(true);
      expect(answer.result).toMatchObject({
        success: false,
        error: expect.stringContaining("is not one of your tools"),
      });
    }
  });

  test("reads the page in the preview, and says so when none is open", async () => {
    const snapshot: PageSnapshot = {
      url: "https://spring.example.com/",
      title: "Spring",
      viewport: { width: 1280, height: 800, scrollY: 0, pageHeight: 800 },
      outline: [],
    };
    const open = await runPageCheckTool(
      "read_page",
      {},
      deps({ readPage: async () => snapshot }),
    );
    expect(open).toMatchObject({
      isError: false,
      result: { success: true, title: "Spring" },
    });
    const closed = await runPageCheckTool("read_page", {}, deps());
    expect(closed.isError).toBe(true);
  });

  test("its report is kept, and reaches the assistant once, while the files are as checked", async () => {
    const d = deps();
    const answer = await runPageCheckTool(
      "report",
      {
        status: "fail",
        summary: "The heading is there, in the wrong colour.",
        findings: [
          {
            message: "h1 is black; the change made it the brand colour.",
            where: "main h1",
          },
        ],
      },
      d,
    );
    expect(answer).toEqual({ result: { success: true }, isError: false });
    expect(d.reports).toHaveLength(1);
    const report = d.reports[0];
    if (report === undefined) throw new Error("no report");
    pageCheckReported(NAME, INPUTS, report);

    const notices = await takeToolNotices(NAME, async () => INPUTS);
    expect(notices).toEqual({
      page_check: {
        status: "fail",
        summary: "The heading is there, in the wrong colour.",
        findings: [
          {
            message: "h1 is black; the change made it the brand colour.",
            where: "main h1",
          },
        ],
        next: "The page check found these on the page. Fix the ones that are still there.",
      },
    });
    expect(await takeToolNotices(NAME, async () => INPUTS)).toEqual({});
  });

  test("a report about files changed since is dropped, never handed over", async () => {
    pageCheckReported(NAME, INPUTS, {
      status: "fail",
      summary: "The old heading.",
      findings: [],
    });
    expect(await takeToolNotices(NAME, async () => "b".repeat(64))).toEqual({});
    expect(await takeToolNotices(NAME, async () => INPUTS)).toEqual({});
  });

  test("a note sent while one is being handed over goes with the next answer", async () => {
    noteForMain(NAME, "first");
    let answer: (inputs: string | null) => void = () => {};
    // A finding tied to the files, so the take waits on what is staged.
    pageCheckReported(NAME, INPUTS, {
      status: "pass",
      summary: "Fine.",
      findings: [],
    });
    const taking = takeToolNotices(
      NAME,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await Promise.resolve();
    noteForMain(NAME, "second");
    answer(INPUTS);
    expect(await taking).toMatchObject({ page_check_messages: ["first"] });
    expect(
      await takeToolNotices(NAME, () => new Promise(() => {}), { waitMs: 5 }),
    ).toEqual({ page_check_messages: ["second"] });
  });

  test("a report that is not one is refused, and it is told how to send one", async () => {
    const d = deps();
    const answer = await runPageCheckTool("report", { status: "fine" }, d);
    expect(answer.isError).toBe(true);
    expect(d.reports).toEqual([]);
  });

  test("a note for the assistant goes with its next tool answer, whatever is staged", async () => {
    const d = deps();
    await runPageCheckTool(
      "message_main",
      { text: "The page is blank." },
      { ...d, onMessage: (text) => noteForMain(NAME, text) },
    );
    expect(
      await takeToolNotices(NAME, () => new Promise(() => {}), { waitMs: 5 }),
    ).toEqual({ page_check_messages: ["The page is blank."] });
  });
});

describe("the assistant's verify and message_verifier", () => {
  const ask = (
    over: Partial<PageCheckAsk> = {},
  ): PageCheckAsk & { asked: (string | null)[] } => {
    const asked: (string | null)[] = [];
    return {
      asked,
      canCheck: () => true,
      verify: (focus): PageCheckAsked => {
        asked.push(focus);
        return { status: "started" };
      },
      message: () => ({ status: "sent" }),
      ...over,
    };
  };

  test("verify starts a check with what changed and what to look at, and answers at once", () => {
    const check = ask();
    const answer = askPageCheck(check, VERIFY_TOOL.name, {
      what_changed: "The hero's heading is the brand colour.",
      what_to_check: "h1 on /",
    });
    expect(check.asked).toEqual([
      "Changed: The hero's heading is the brand colour.\nLook at: h1 on /",
    ]);
    expect(answer).toMatchObject({
      result: { success: true, status: "started" },
    });
    expect(answer.isError).toBeUndefined();
  });

  test("with no preview open, nothing is started and the assistant is told how to check instead", () => {
    const check = ask({ canCheck: () => false });
    const answer = askPageCheck(check, VERIFY_TOOL.name, {
      what_changed: "x",
    });
    expect(check.asked).toEqual([]);
    expect(answer).toMatchObject({
      isError: true,
      result: { error: expect.stringContaining("read_page") },
    });
  });

  test("past the limit, it says when it runs again", () => {
    const answer = askPageCheck(
      ask({ verify: () => ({ status: "limited" }) }),
      VERIFY_TOOL.name,
      {},
    );
    expect(answer).toMatchObject({
      isError: true,
      result: {
        status: "limited",
        error: expect.stringContaining("after their next one"),
      },
    });
  });

  test("a note reaches a running check, and an empty one is refused", () => {
    expect(
      askPageCheck(ask(), MESSAGE_VERIFIER_TOOL.name, { text: "Ignore /old" }),
    ).toMatchObject({ result: { status: "sent" } });
    expect(
      askPageCheck(ask(), MESSAGE_VERIFIER_TOOL.name, { text: "  " }),
    ).toMatchObject({ isError: true });
  });
});

describe("what the page check is told", () => {
  test("why it runs, what to look at, the files, and what the typecheck and lint found", () => {
    expect(
      pageCheckPrompt(
        { reason: "turn-ended", focus: null },
        {
          stagedFiles: ["src/Hero.tsx"],
          typecheck: checksLine(
            { status: "done", count: 2, current: true },
            "type errors",
          ),
          lint: checksLine({ status: "running" }, "problems"),
        },
      ),
    ).toBe(
      [
        "The other assistant finished a turn that changed code.",
        "It did not say what to look at: find what the changed files render, and check that on the page.",
        "Files the proposal changes: src/Hero.tsx.",
        "Typecheck: 2 type errors.",
        "Lint: running.",
      ].join("\n"),
    );
  });

  test("a typecheck of files from before the last change says so", () => {
    expect(
      checksLine({ status: "done", count: 0, current: false }, "type errors"),
    ).toBe("no type errors, in the files as they were before the last change.");
  });
});

describe("the page check's model", () => {
  const info = (provider: "anthropic" | "openai", model: string) => ({
    ref: { provider, model },
    label: model,
  });

  test("the smallest on the chat's provider, which is known to answer", () => {
    expect(
      pickPageCheckModel(
        [
          info("openai", "gpt-5.1-mini"),
          info("anthropic", "claude-opus-5-5"),
          info("anthropic", "claude-haiku-5-5"),
        ],
        { provider: "anthropic", model: "claude-opus-5-5" },
      ),
    ).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
  });

  test("another provider's small one, and else the chat's own", () => {
    const chat = { provider: "anthropic" as const, model: "claude-opus-5-5" };
    expect(pickPageCheckModel([info("openai", "gpt-5.1-mini")], chat)).toEqual({
      provider: "openai",
      model: "gpt-5.1-mini",
    });
    expect(
      pickPageCheckModel([info("anthropic", "claude-opus-5-5")], chat),
    ).toBe(chat);
  });
});
