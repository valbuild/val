/** @jest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PublishSummary } from "./PublishSummary";
import { TooltipProvider } from "./designSystem/tooltip";
import type { AiSummaryState } from "./PublishSummaryView";

/**
 * What actually gets committed when Publish is pressed.
 *
 * The rule the popover is built around is that the AI never blocks anyone: the
 * box is filled with a summary that needed no network call, and the AI's
 * version takes over only if the user has not written their own. Pressing
 * Publish while the AI is still writing buys it a few seconds — and this is
 * the seam that broke.
 *
 * The text used to be read back out of the summary STATE by the publish button,
 * from that button's own render. Publishing during the grace period is fired by
 * a callback created when Publish was pressed, and the summary lands after
 * that: the box on screen said the AI's sentence and the commit said "Update
 * Home". Both effects run in the same flush, so no amount of waiting fixed it.
 * Hence the tests below assert on the text handed to `onPublish`, not on the
 * textarea.
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
const DEFAULT_TEXT = "Update Home";

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
  return screen.getByPlaceholderText(
    "Write a summary of your changes",
  ) as HTMLTextAreaElement;
}

describe("PublishSummary", () => {
  test("fills the box with a summary that needed no network call", () => {
    const onPublish = jest.fn();
    render(<Harness onPublish={onPublish} />);
    expect(summaryBox().value).toBe(DEFAULT_TEXT);
  });

  test("the AI summary takes over a box nobody has typed in", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);
    setAiState({ status: "ready", text: AI_TEXT, sessionId: null }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    expect(summaryBox().value).toBe(AI_TEXT);
  });

  test("a summary that lands during the grace period is what gets committed", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    });
    // Publishing waits rather than going ahead with the default.
    expect(onPublish).not.toHaveBeenCalled();
    expect(screen.getByText(/Waiting for the AI summary/)).toBeTruthy();

    setAiState({ status: "ready", text: AI_TEXT, sessionId: null }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );

    // The regression: this used to be called with DEFAULT_TEXT, because the
    // callback the countdown fired predated the summary arriving.
    expect(onPublish).toHaveBeenCalledWith(AI_TEXT);
    expect(summaryBox().value).toBe(AI_TEXT);
  });

  test("the wait ends on its own, with the box as it stands", () => {
    const onPublish = jest.fn();
    render(<Harness onPublish={onPublish} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    });
    // A second apart, one act each: the next tick is only scheduled by the
    // re-render the previous one caused, so a single long advance runs one.
    for (let second = 0; second <= 10; second++) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(onPublish).toHaveBeenCalledWith(DEFAULT_TEXT);
  });

  test("a second press skips the rest of the wait", () => {
    const onPublish = jest.fn();
    render(<Harness onPublish={onPublish} />);
    const publish = () =>
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /publish/i }));
      });
    publish();
    expect(onPublish).not.toHaveBeenCalled();
    publish();
    expect(onPublish).toHaveBeenCalledWith(DEFAULT_TEXT);
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
      fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    });
    expect(onPublish).toHaveBeenCalledWith("Fix the typo in the footer");

    // And an arrival afterwards does not rewrite it either.
    setAiState({ status: "ready", text: AI_TEXT, sessionId: null }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    expect(summaryBox().value).toBe("Fix the typo in the footer");
  });

  test("an AI summary already in the box is committed as it stands", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);
    setAiState({ status: "ready", text: AI_TEXT, sessionId: null }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    });
    expect(onPublish).toHaveBeenCalledWith(AI_TEXT);
  });

  test("a failed summary is not waited for", () => {
    const onPublish = jest.fn();
    const { rerender } = render(<Harness onPublish={onPublish} />);
    setAiState({ status: "failed", message: "No key configured" }, () =>
      rerender(<Harness onPublish={onPublish} />),
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    });
    expect(onPublish).toHaveBeenCalledWith(DEFAULT_TEXT);
  });
});
