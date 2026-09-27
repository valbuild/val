/** @jest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PublishSummary } from "./PublishSummary";
import { TooltipProvider } from "./designSystem/tooltip";
import type { AiSummaryState } from "./PublishSummaryView";

/**
 * What actually gets committed when Publish is pressed in the commit message
 * box — which only a project with `studio.commitMessage: "required"` sees.
 *
 * The rules: the box starts EMPTY (a pre-filled one could be published
 * unread, which is what "required" exists to prevent), Publish is disabled
 * until it has something in it, the AI fills an untouched box when it lands,
 * and nothing publishes on its own — there is no countdown any more. The
 * tests assert on the text handed to `onPublish`, not only on the textarea.
 */

const mockPatchSets = {
  status: "success",
  data: [
    {
      moduleFilePath: "/content/home.val.ts",
      patchPath: ["hero", "title"],
      schemaTypes: ["string"],
    },
  ],
};

const mockValSystem = {
  system: {
    sourceStore: {
      peek: () => ({ status: "ready", data: "New heading" }),
      peekBase: () => ({ status: "ready", data: "Old heading" }),
    },
  },
};

/** Set by the harness on every render; read by the mocked hooks below. */
let mockPublishSummaryHook: {
  summary: { type: "not-asked" } | { type: "manual" | "ai"; text: string };
  setSummary: (
    summary: { type: "manual" | "ai"; text: string } | { type: "not-asked" },
  ) => void;
};
let mockAiState: AiSummaryState = { status: "loading" };

const mockAiHook = {
  get state() {
    return mockAiState;
  },
  start: jest.fn(),
  cancel: jest.fn(),
  reveal: jest.fn(),
};

jest.mock("./ValProvider", () => ({
  usePublishSummary: () => ({
    ...mockPublishSummaryHook,
    publishDisabled: false,
    isPublishing: false,
    aiEnabled: true,
  }),
  usePatchSets: () => mockPatchSets,
  useAvailableAIModel: () => ({ id: "test-model", provider: "test" }),
}));
jest.mock("../stores/react/SystemContext", () => ({
  useValSystem: () => mockValSystem,
}));
jest.mock("../hooks/useCommitSummary", () => ({
  useCommitSummary: () => mockAiHook,
}));
jest.mock("./ValRouter", () => ({
  useSessionParam: () => ({ setSessionParam: jest.fn() }),
}));
jest.mock("./AIChatActionsContext", () => ({
  useAIChatActions: () => ({ openAIChat: jest.fn() }),
}));
jest.mock("./ValPortalProvider", () => ({
  useValPortal: () => null,
}));

const AI_TEXT = "The hero now leads with the product name";
const PLACEHOLDER =
  "Describe your changes. For example: Update hero.title in /content/home.val.ts";

function Harness({ onPublish }: { onPublish: (summary: string) => void }) {
  // The real summary lives in a provider and is persisted; all this flow needs
  // of it is that reads see the last write.
  const [summary, setSummaryState] = useState<
    { type: "not-asked" } | { type: "manual" | "ai"; text: string }
  >({ type: "not-asked" });
  mockPublishSummaryHook = { summary, setSummary: setSummaryState };
  return (
    <TooltipProvider>
      <PublishSummary onPublish={onPublish} onClose={() => {}} />
    </TooltipProvider>
  );
}

function setAiState(next: AiSummaryState, rerender: () => void) {
  mockAiState = next;
  act(() => {
    rerender();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAiState = { status: "loading" };
  mockAiHook.start.mockClear();
  mockAiHook.cancel.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

function summaryBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: "Commit message",
  }) as HTMLTextAreaElement;
}

function publishButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /publish/i }) as HTMLButtonElement;
}

describe("PublishSummary", () => {
  test("starts empty, with the message nobody wrote as the placeholder", () => {
    mockAiState = { status: "idle" };
    render(<Harness onPublish={jest.fn()} />);
    expect(summaryBox().value).toBe("");
    expect(summaryBox().placeholder).toBe(PLACEHOLDER);
  });

  test("an empty box cannot be published", () => {
    const onPublish = jest.fn();
    render(<Harness onPublish={onPublish} />);
    expect(publishButton().disabled).toBe(true);
    act(() => {
      fireEvent.click(publishButton());
    });
    expect(onPublish).not.toHaveBeenCalled();
  });

  test("says the AI is writing while it does", () => {
    render(<Harness onPublish={jest.fn()} />);
    expect(summaryBox().placeholder).toBe("Writing a commit message with AI…");
  });

  test("the AI summary fills a box nobody has typed in", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);
    setAiState({ status: "ready", text: AI_TEXT, sessionId: null }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    expect(summaryBox().value).toBe(AI_TEXT);
  });

  test("the AI summary is not published until someone presses Publish", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);
    setAiState({ status: "ready", text: AI_TEXT, sessionId: null }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onPublish).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(publishButton());
    });
    expect(onPublish).toHaveBeenCalledWith(AI_TEXT);
  });

  test("what the user wrote is committed, and never waits on the AI", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);
    act(() => {
      fireEvent.change(summaryBox(), {
        target: { value: "Fix the typo in the footer" },
      });
    });
    act(() => {
      fireEvent.click(publishButton());
    });
    expect(onPublish).toHaveBeenCalledWith("Fix the typo in the footer");

    // And an arrival afterwards does not rewrite it either.
    setAiState({ status: "ready", text: AI_TEXT, sessionId: null }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    expect(summaryBox().value).toBe("Fix the typo in the footer");
  });

  test("a failed AI leaves the box to the reader", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);
    setAiState({ status: "failed", message: "No key configured" }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    expect(summaryBox().value).toBe("");
    expect(publishButton().disabled).toBe(true);
    act(() => {
      fireEvent.change(summaryBox(), { target: { value: "Update hero" } });
    });
    act(() => {
      fireEvent.click(publishButton());
    });
    expect(onPublish).toHaveBeenCalledWith("Update hero");
  });
});
