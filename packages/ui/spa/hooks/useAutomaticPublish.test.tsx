/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import type { AiSummaryState } from "../components/PublishSummaryView";
import {
  AUTOMATIC_SUMMARY_TIMEOUT_MS,
  useAutomaticPublish,
} from "./useAutomaticPublish";

/**
 * Publishing without a box: the default in HTTP mode.
 *
 * Whatever the AI does, pressing Publish publishes — exactly once, with the
 * AI's message if it answers in time and with the one built from the changed
 * paths if it does not.
 */

const patchSets = [
  {
    moduleFilePath: "/content/home.val.ts",
    patchPath: ["hero", "title"],
    schemaTypes: ["string"],
  },
];
const DEFAULT_TEXT = "Update hero.title in /content/home.val.ts";
const AI_TEXT = "The hero now leads with the product name";

const mockValSystem = {
  system: {
    getPatchSets: () => Promise.resolve(patchSets),
    sourceStore: {
      peek: () => ({ status: "ready", data: "New heading" }),
      peekBase: () => ({ status: "ready", data: "Old heading" }),
    },
  },
};

let mockModel: { id: string; provider: string } | null = null;
let mockAiState: AiSummaryState = { status: "idle" };
const mockAiHook = {
  get state() {
    return mockAiState;
  },
  start: jest.fn(() => true),
  reset: jest.fn(),
  cancel: jest.fn(),
  reveal: jest.fn(),
};

jest.mock("../components/ValProvider", () => ({
  useAvailableAIModel: () => mockModel,
}));
jest.mock("../stores/react/SystemContext", () => ({
  useValSystem: () => mockValSystem,
}));
jest.mock("./useCommitSummary", () => ({
  useCommitSummary: () => mockAiHook,
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockModel = null;
  mockAiState = { status: "idle" };
  mockAiHook.start.mockClear();
  mockAiHook.start.mockImplementation(() => true);
  mockAiHook.reset.mockClear();
  mockAiHook.cancel.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

function setup() {
  const publish = jest.fn();
  const hook = renderHook(() =>
    useAutomaticPublish({ publish, aiEnabled: true }),
  );
  return { publish, hook };
}

/** Press, and let the patch sets arrive. */
async function press(hook: ReturnType<typeof setup>["hook"]) {
  await act(async () => {
    hook.result.current.publishAutomatically();
  });
}

describe("useAutomaticPublish", () => {
  test("without AI it publishes straight away, naming the exact path", async () => {
    const { publish, hook } = setup();
    await press(hook);
    expect(mockAiHook.start).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(DEFAULT_TEXT);
    expect(hook.result.current.isSummarising).toBe(false);
  });

  test("with AI it waits for the AI's message and publishes that", async () => {
    mockModel = { id: "m", provider: "p" };
    const { publish, hook } = setup();
    await press(hook);
    expect(mockAiHook.start).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(hook.result.current.isSummarising).toBe(true);

    mockAiState = { status: "ready", text: AI_TEXT, sessionId: null };
    hook.rerender();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(AI_TEXT);
    expect(hook.result.current.isSummarising).toBe(false);
  });

  test("without AI it is still in flight while the changes are read", async () => {
    let resolve: (value: typeof patchSets) => void = () => {};
    const getPatchSets = mockValSystem.system.getPatchSets;
    mockValSystem.system.getPatchSets = () =>
      new Promise((r) => {
        resolve = r;
      });
    try {
      const { publish, hook } = setup();
      act(() => {
        hook.result.current.publishAutomatically();
      });
      // Busy, so the button is disabled and the overlay holds the menu open.
      expect(hook.result.current.isSummarising).toBe(true);
      expect(publish).not.toHaveBeenCalled();
      await act(async () => {
        resolve(patchSets);
      });
      expect(publish).toHaveBeenCalledWith(DEFAULT_TEXT);
      expect(hook.result.current.isSummarising).toBe(false);
    } finally {
      mockValSystem.system.getPatchSets = getPatchSets;
    }
  });

  test("a failed AI publishes with the default", async () => {
    mockModel = { id: "m", provider: "p" };
    const { publish, hook } = setup();
    await press(hook);
    mockAiState = { status: "failed", message: "nope" };
    hook.rerender();
    expect(publish).toHaveBeenCalledWith(DEFAULT_TEXT);
  });

  test("an AI that never answers is given up on", async () => {
    mockModel = { id: "m", provider: "p" };
    const { publish, hook } = setup();
    await press(hook);
    act(() => {
      jest.advanceTimersByTime(AUTOMATIC_SUMMARY_TIMEOUT_MS);
    });
    expect(mockAiHook.cancel).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(DEFAULT_TEXT);
  });

  test("the deadline runs from the press, even if the patch sets never arrive", async () => {
    mockModel = { id: "m", provider: "p" };
    const getPatchSets = mockValSystem.system.getPatchSets;
    mockValSystem.system.getPatchSets = () => new Promise(() => {});
    try {
      const { publish, hook } = setup();
      act(() => {
        hook.result.current.publishAutomatically();
      });
      expect(hook.result.current.isSummarising).toBe(true);
      act(() => {
        jest.advanceTimersByTime(AUTOMATIC_SUMMARY_TIMEOUT_MS);
      });
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith("Update content");
      expect(hook.result.current.isSummarising).toBe(false);
    } finally {
      mockValSystem.system.getPatchSets = getPatchSets;
    }
  });

  test("a prompt that could not be sent publishes with the default", async () => {
    mockModel = { id: "m", provider: "p" };
    mockAiHook.start.mockImplementation(() => false);
    const { publish, hook } = setup();
    await press(hook);
    expect(publish).toHaveBeenCalledWith(DEFAULT_TEXT);
  });

  test("a second press while it waits is not a second publish", async () => {
    mockModel = { id: "m", provider: "p" };
    const { publish, hook } = setup();
    await press(hook);
    await press(hook);
    expect(mockAiHook.start).toHaveBeenCalledTimes(1);
    mockAiState = { status: "ready", text: AI_TEXT, sessionId: null };
    hook.rerender();
    act(() => {
      jest.advanceTimersByTime(AUTOMATIC_SUMMARY_TIMEOUT_MS);
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test("a summary left over from the last publish is not reused", async () => {
    mockModel = { id: "m", provider: "p" };
    mockAiState = {
      status: "ready",
      text: "Last time's message",
      sessionId: null,
    };
    const { publish, hook } = setup();
    // Pressed, and re-rendered before the prompt has gone out.
    act(() => {
      hook.result.current.publishAutomatically();
    });
    hook.rerender();
    expect(publish).not.toHaveBeenCalled();
    await act(async () => {});
    expect(mockAiHook.reset).toHaveBeenCalled();
  });

  test("unmounting while the AI writes still publishes", async () => {
    mockModel = { id: "m", provider: "p" };
    const { publish, hook } = setup();
    await press(hook);
    hook.unmount();
    expect(publish).toHaveBeenCalledWith(DEFAULT_TEXT);
  });
});
