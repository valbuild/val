/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import type { PageSnapshot } from "@valbuild/shared/internal";
import {
  PAGE_CHECK_PREVIEW_WAIT_MS,
  usePageCheckSession,
} from "./usePageCheckSession";
import {
  setQuickPreviewRunner,
  setStagedPreview,
} from "../proposals/quickPreviewControl";
import type {
  AIClientMessage,
  AIModel,
  AIServerMessage,
} from "./useAIWebSocket";
import type { AssistantPage } from "../components/shell/canvas/AssistantPage";
import type { ProposalJson } from "../proposals/proposalsClient";
import {
  PAGE_CHECK_DEADLINE_MS,
  pageCheckOf,
  resetPageCheck,
} from "../proposals/pageCheck";
import { takeToolNotices } from "../proposals/toolNotices";
import { resetBackgroundLint } from "../proposals/backgroundLint";
import { resetProposalTypecheck } from "../proposals/useProposalTypecheck";

jest.mock("../components/ValProvider", () => ({
  useCurrentProposal: () => null,
}));

const NAME = "0123456789abcdef0123";
const INPUTS = "a".repeat(64);
const MODEL: AIModel = { provider: "anthropic", model: "claude-haiku-5-5" };
const SNAPSHOT: PageSnapshot = {
  url: "https://spring.example.com/",
  title: "Spring",
  viewport: { width: 1280, height: 800, scrollY: 0, pageHeight: 800 },
  outline: [],
};

/** The assistant's socket, as the content server would answer it: in the test's hands. */
function socket() {
  const sent: AIClientMessage[] = [];
  const handlers = new Set<(message: AIServerMessage) => void>();
  return {
    sent,
    send: (message: AIClientMessage) => {
      sent.push(message);
      return true;
    },
    subscribe: (handler: (message: AIServerMessage) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    serverSays: (message: AIServerMessage) => {
      for (const handler of handlers) handler(message);
    },
    prompts: () =>
      sent.filter(
        (m): m is Extract<AIClientMessage, { type: "ai_prompt" }> =>
          m.type === "ai_prompt",
      ),
    results: () =>
      sent.filter(
        (m): m is Extract<AIClientMessage, { type: "ai_tool_result" }> =>
          m.type === "ai_tool_result",
      ),
  };
}

const STAGED = {
  files: ["src/Hero.tsx"],
  inputs: INPUTS,
  buildRequired: false,
};
const proposal: ProposalJson = {
  name: NAME,
  branch: `val/p/${NAME}`,
  displayName: "Spring",
  status: "open",
  updatedAt: "2026-11-21T10:00:00.000Z",
  built: null,
  staged: STAGED,
};

const page: Pick<AssistantPage, "readPage" | "readPageLog"> = {
  readPage: () => async () => SNAPSHOT,
  readPageLog: () => null,
};

function render(
  ws = socket(),
  withPage = true,
  staged = STAGED,
  code: {
    files?: Record<string, string | null>;
    site?: Record<string, string>;
  } = {},
) {
  const hook = renderHook(() =>
    usePageCheckSession({
      sendWsMessage: ws.send,
      subscribeToWsMessages: ws.subscribe,
      proposalName: () => NAME,
      page: () => (withPage ? { ...emptyPage, ...page } : null),
      chatSessionId: () => "chat-1",
      model: MODEL,
      proposals: {
        get: async () => ({ ...proposal, staged }),
        files: async () => ({
          files: code.files ?? { "src/Hero.tsx": "<h1>Spring</h1>" },
          staged: STAGED,
        }),
      },
      siteSource: async () => code.site ?? {},
    }),
  );
  return { ws, hook };
}

const emptyPage: AssistantPage = {
  codeMode: true,
  selecting: false,
  setSelecting: () => {},
  pointedAt: null,
  setPointedAt: () => {},
  readPage: () => null,
  screenshotPage: () => null,
  readPageLog: () => null,
  interactPage: () => null,
};

const flush = () => act(async () => {});

describe("the page check's session", () => {
  beforeEach(() => {
    setStagedPreview(null);
    resetPageCheck();
    resetBackgroundLint();
    resetProposalTypecheck();
  });

  test("a check is a hidden prompt of its own, on the small model, with only its own tools", async () => {
    const { ws, hook } = render();
    expect(hook.result.current.verify("Look at: h1 on /")).toEqual({
      status: "started",
    });
    await flush();
    const [prompt] = ws.prompts();
    expect(prompt).toMatchObject({
      hidden: true,
      maxIterations: 15,
      agents: [{ id: "page-check", model: MODEL }],
    });
    expect(prompt?.agents[0]?.tools?.map((tool) => tool.name)).not.toContain(
      "interact_page",
    );
    expect(JSON.stringify(prompt?.message)).toContain("Look at: h1 on /");
    expect(pageCheckOf(NAME)).toEqual({
      status: "running",
      name: NAME,
      inputs: INPUTS,
    });
  });

  test("it looks at the page once the staged files are in front, not while the quick preview is still on its way", async () => {
    // The shell shows quick previews here: there is something to wait for.
    const unregister = setQuickPreviewRunner(async () => ({
      status: "shown",
      ms: 0,
      timings: [],
    }));
    try {
      const { ws, hook } = render(socket(), true, {
        ...STAGED,
        buildRequired: true,
      });
      hook.result.current.verify(null);
      await flush();
      // Asked for, with the page still the last build's: nothing is sent.
      expect(ws.prompts()).toHaveLength(0);
      // The page says it is the quick preview of these files.
      act(() => setStagedPreview({ inputs: INPUTS, status: "shown" }));
      await flush();
      expect(ws.prompts()).toHaveLength(1);
    } finally {
      unregister();
    }
  });

  test("its tools are answered here, a note from the assistant rides on the next answer, and its report reaches the assistant", async () => {
    const { ws, hook } = render();
    hook.result.current.verify(null);
    await flush();
    const promptId = ws.prompts()[0]?.id ?? "";

    expect(
      hook.result.current.message("The old banner is gone on purpose."),
    ).toEqual({ status: "sent" });
    ws.serverSays({
      type: "ai_tool_call",
      id: promptId,
      toolCallId: "t1",
      name: "read_page",
      arguments: {},
    });
    await flush();
    expect(ws.results()[0]).toMatchObject({
      toolCallId: "t1",
      result: {
        result: { success: true, title: "Spring" },
        messages_from_main: ["The old banner is gone on purpose."],
      },
    });

    ws.serverSays({
      type: "ai_tool_call",
      id: promptId,
      toolCallId: "t2",
      name: "report",
      arguments: { status: "pass", summary: "The heading reads Spring." },
    });
    await flush();
    ws.serverSays({
      type: "ai_response",
      id: promptId,
      sessionId: "page-check",
      response: "Done.",
    });
    await flush();
    expect(pageCheckOf(NAME)).toMatchObject({
      status: "done",
      report: { status: "pass" },
    });
    expect(await takeToolNotices(NAME, async () => INPUTS)).toMatchObject({
      page_check: { status: "pass", summary: "The heading reads Spring." },
    });
  });

  test("the next check continues the same session, so it keeps what it learned", async () => {
    const { ws, hook } = render();
    hook.result.current.verify(null);
    await flush();
    ws.serverSays({
      type: "ai_response",
      id: ws.prompts()[0]?.id ?? "",
      sessionId: "page-check",
      response: "",
    });
    await flush();
    hook.result.current.verify(null);
    await flush();
    const [first, second] = ws.prompts();
    expect(second?.sessionId).toBe(first?.sessionId);
  });

  test("a check that ends without a report is shown as failed, and the next can run", async () => {
    const { ws, hook } = render();
    hook.result.current.verify(null);
    await flush();
    ws.serverSays({
      type: "ai_error",
      id: ws.prompts()[0]?.id ?? "",
      code: "internal_error",
      message: "The AI service did not answer.",
    });
    await flush();
    // Said for the person; what the service said goes under Details.
    expect(pageCheckOf(NAME)).toEqual({
      status: "failed",
      name: NAME,
      message: "The AI service did not finish the page check.",
      details: "The AI service did not answer.",
    });
    expect(hook.result.current.verify(null)).toEqual({ status: "started" });
  });

  test("another prompt's messages are not its own", async () => {
    const { ws, hook } = render();
    hook.result.current.verify(null);
    await flush();
    ws.serverSays({
      type: "ai_tool_call",
      id: "the-chat's-own-prompt",
      toolCallId: "t9",
      name: "read_page",
      arguments: {},
    });
    await flush();
    expect(ws.results()).toEqual([]);
  });

  test("with no preview, nothing is checked and nothing is shown", async () => {
    const { ws, hook } = render(socket(), false);
    expect(hook.result.current.canCheck()).toBe(false);
    hook.result.current.codeChanged();
    hook.result.current.turnEnded();
    await flush();
    expect(ws.prompts()).toEqual([]);
    expect(pageCheckOf(NAME)).toEqual({ status: "idle" });
  });

  test("leaving stops a check that runs", async () => {
    const { ws, hook } = render();
    hook.result.current.verify(null);
    await flush();
    const promptId = ws.prompts()[0]?.id;
    hook.unmount();
    expect(ws.sent.at(-1)).toEqual({ type: "ai_cancel", id: promptId });
  });
});

describe("a page check that does not finish", () => {
  beforeEach(() => {
    resetPageCheck();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  test("is stopped after its deadline, shown as ours to explain, and the next can run", async () => {
    const { ws, hook } = render();
    hook.result.current.verify(null);
    await flush();
    const promptId = ws.prompts()[0]?.id;
    await act(async () => {
      jest.advanceTimersByTime(PAGE_CHECK_DEADLINE_MS);
    });
    expect(ws.sent.at(-1)).toEqual({ type: "ai_cancel", id: promptId });
    expect(pageCheckOf(NAME)).toEqual({
      status: "failed",
      name: NAME,
      message: "The page check took too long, and was stopped.",
    });
    expect(hook.result.current.verify(null)).toEqual({ status: "started" });
  });
});

test("with no preview, verify says so and spends nothing", () => {
  const { hook } = render(socket(), false);
  expect(hook.result.current.verify(null)).toEqual({ status: "not-here" });
  expect(hook.result.current.left()).toBe(3);
});

/**
 * Reported from code mode: the assistant made every button's border red,
 * and the page check said it was not on the page -- "the preview appears to
 * be a build from before the change" -- while it was. The assistant was sent
 * back to fix what was already fixed, and the checks bar said the change
 * had failed.
 *
 * The page check reads whatever page is in the preview. After a change,
 * that is the last build until the change's quick preview comes to the
 * front. It waited 20 seconds for that and then read the page anyway --
 * shorter than Val Build takes to make a quick preview and the page to load
 * it -- and it read the page anyway when the quick preview could not be made
 * at all. Either way it judged a page the change could not be on.
 *
 * So the check looks at the page only once the page is known to have the
 * change, and says so to the model; otherwise it says, without the model,
 * that the page was not checked and why.
 */
describe("a page check of a change the preview does not show", () => {
  const BUILD_REQUIRED = { ...STAGED, buildRequired: true };
  let unregister: () => void = () => {};
  beforeEach(() => {
    setStagedPreview(null);
    resetPageCheck();
    resetBackgroundLint();
    resetProposalTypecheck();
    // The shell shows quick previews here.
    unregister = setQuickPreviewRunner(async () => ({
      status: "shown",
      ms: 0,
      timings: [],
    }));
  });
  afterEach(() => {
    unregister();
    jest.useRealTimers();
  });

  test("it waits as long as Val Build takes to make the quick preview, and the page to load it", async () => {
    jest.useFakeTimers();
    const { ws, hook } = render(socket(), true, BUILD_REQUIRED);
    hook.result.current.verify(null);
    // Val Build builds the quick preview (45 seconds is not unusual), and
    // the page in the preview loads it (`useQuickPreview` gives it 30).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(75_000);
    });
    expect(ws.prompts()).toHaveLength(0);
    act(() => setStagedPreview({ inputs: INPUTS, status: "shown" }));
    await flush();
    expect(ws.prompts()).toHaveLength(1);
  });

  test("once the quick preview is in front, the check is told the page is the change", async () => {
    const { ws, hook } = render(socket(), true, BUILD_REQUIRED);
    hook.result.current.verify(null);
    await flush();
    act(() => setStagedPreview({ inputs: INPUTS, status: "shown" }));
    await flush();
    const [prompt] = ws.prompts();
    expect(prompt?.message).toContain(
      "The page in the preview is a quick preview of exactly these files: the change is on it.",
    );
  });

  test("a change its quick preview could not show is not looked for on the page", async () => {
    const { ws, hook } = render(socket(), true, BUILD_REQUIRED);
    hook.result.current.verify(null);
    await flush();
    act(() =>
      setStagedPreview({
        inputs: INPUTS,
        status: "failed",
        message: "The page with the quick preview did not load.",
      }),
    );
    await flush();

    // No model is asked to judge a page the change is not on...
    expect(ws.prompts()).toHaveLength(0);
    // ...the person is told the page was not checked, and why...
    expect(pageCheckOf(NAME)).toMatchObject({
      status: "done",
      inputs: INPUTS,
      notShown: "failed",
      report: {
        status: "blocked",
        summary:
          "The page was not checked: the change could not be shown in a quick preview, so it is on the page once the proposal is built. The quick preview said: The page with the quick preview did not load.",
        findings: [],
      },
    });
    // ...and so is the assistant, which is not sent to fix it.
    expect(await takeToolNotices(NAME, async () => INPUTS)).toMatchObject({
      page_check: { status: "blocked" },
    });
    // The next check can run.
    expect(hook.result.current.verify(null)).toEqual({ status: "started" });
  });

  test("a project with no quick previews is not looked at until it is built", async () => {
    const { ws, hook } = render(socket(), true, BUILD_REQUIRED);
    hook.result.current.verify(null);
    await flush();
    act(() => setStagedPreview({ inputs: INPUTS, status: "off" }));
    await flush();
    expect(ws.prompts()).toHaveLength(0);
    expect(pageCheckOf(NAME)).toMatchObject({
      status: "done",
      notShown: "off",
      report: {
        status: "blocked",
        summary:
          "The page was not checked: this project makes no quick previews, so the change is on the page once the proposal is built.",
      },
    });
  });

  test("where no quick preview can be shown, the last build is not checked for the change", async () => {
    unregister();
    const { ws, hook } = render(socket(), true, BUILD_REQUIRED);
    hook.result.current.verify(null);
    await flush();
    expect(ws.prompts()).toHaveLength(0);
    expect(pageCheckOf(NAME)).toMatchObject({
      status: "done",
      notShown: "no-quick-preview",
      report: {
        status: "blocked",
        summary:
          "The page was not checked: no quick preview can be shown here, so the change is on the page once the proposal is built.",
      },
    });
  });

  test("a quick preview that never says so does not hold the check for good, and the page is not judged without it", async () => {
    jest.useFakeTimers();
    const { ws, hook } = render(socket(), true, BUILD_REQUIRED);
    hook.result.current.verify(null);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PAGE_CHECK_PREVIEW_WAIT_MS);
    });
    expect(ws.prompts()).toHaveLength(0);
    expect(pageCheckOf(NAME)).toMatchObject({
      status: "done",
      notShown: "timeout",
      report: {
        status: "blocked",
        summary: `The page was not checked: the quick preview of the change was not on the page within ${PAGE_CHECK_PREVIEW_WAIT_MS / 1000} seconds.`,
      },
    });
    expect(hook.result.current.verify(null)).toEqual({ status: "started" });
  });

  test("a change the served build already has is checked on the page as it is", async () => {
    const { ws, hook } = render(socket(), true, STAGED);
    hook.result.current.verify(null);
    await flush();
    const [prompt] = ws.prompts();
    expect(prompt?.message).toContain(
      "The page in the preview is the site's build, which has these files.",
    );
  });
});

/**
 * G2 in `docs/handoff/code-mode-test-rig-plan.md`: a change a quick preview
 * cannot show, decided by the product from what is staged, not by the model.
 *
 * A quick preview runs the change's code for the browser in the last build.
 * The last build's server is the one answering, so a route the change adds
 * is not served (its link goes to a 404), one it removes still is, and a
 * dependency it adds is in no layer the page can load. The page in front is
 * then not the change, whatever it shows, and a model asked to judge it
 * passes or fails something nobody can see yet.
 *
 * The product decides these (`quickPreviewCannotShow`): no model is asked.
 */
describe("a page check of a change a quick preview cannot show (G2)", () => {
  const BUILD_REQUIRED = { ...STAGED, buildRequired: true };
  const SITE = {
    "package.json": `{ "dependencies": { "react": "^19.2.8" } }\n`,
    "src/routes/index.tsx": "export const Route = {};\n",
    "src/routes/about.tsx": "export const Route = {};\n",
  };
  let unregister: () => void = () => {};
  beforeEach(() => {
    setStagedPreview(null);
    resetPageCheck();
    resetBackgroundLint();
    resetProposalTypecheck();
    unregister = setQuickPreviewRunner(async () => ({
      status: "shown",
      ms: 0,
      timings: [],
    }));
  });
  afterEach(() => unregister());

  /** The check, once the quick preview of the staged files is in front. */
  async function checkOf(files: Record<string, string | null>) {
    const { ws, hook } = render(socket(), true, BUILD_REQUIRED, {
      files,
      site: SITE,
    });
    hook.result.current.verify(null);
    await flush();
    act(() => setStagedPreview({ inputs: INPUTS, status: "shown" }));
    await flush();
    return { ws, check: pageCheckOf(NAME) };
  }

  test.each([
    [
      "a route it adds",
      {
        "src/routes/pricing.tsx": "export const Route = {};\n",
        "src/routes/index.tsx": "export const Route = { pricing: true };\n",
      },
    ],
    ["a route it removes", { "src/routes/about.tsx": null }],
    [
      "a dependency it adds",
      {
        "package.json": `{ "dependencies": { "react": "^19.2.8", "date-fns": "^4.1.0" } }\n`,
      },
    ],
  ])(
    "%s: blocked, by the product, with a Build as the way to see it",
    async (_kind, files) => {
      const { ws, check } = await checkOf(files);
      // No model is asked to judge a page the change is not on...
      expect(ws.prompts()).toHaveLength(0);
      // ...and the person and the assistant are told it needs a Build.
      expect(check).toMatchObject({
        status: "done",
        report: { status: "blocked", findings: [] },
      });
      expect(check.status === "done" ? check.report.summary : "").toMatch(
        /built|Build/,
      );
    },
  );

  test("a change to a component, with the same quick preview, is checked on the page", async () => {
    // The control: it is the kind of change, not the quick preview, that blocks.
    const { ws } = await checkOf({
      "src/components/Hero.tsx": "<h1>Spring</h1>",
    });
    expect(ws.prompts()).toHaveLength(1);
  });
});
