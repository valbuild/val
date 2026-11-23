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

function render(ws = socket(), withPage = true, staged = STAGED) {
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
          files: { "src/Hero.tsx": "<h1>Spring</h1>" },
          staged: STAGED,
        }),
      },
      siteSource: async () => ({}),
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

  test("a quick preview that never says so does not hold the check for good", async () => {
    jest.useFakeTimers();
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
      await act(async () => {
        await jest.advanceTimersByTimeAsync(PAGE_CHECK_PREVIEW_WAIT_MS - 1);
      });
      expect(ws.prompts()).toHaveLength(0);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(ws.prompts()).toHaveLength(1);
    } finally {
      unregister();
      jest.useRealTimers();
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
