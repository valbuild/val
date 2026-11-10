/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useCodeModeQuickPreview,
  withQuickPreview,
  withQuickPreviewState,
} from "./useCodeModeQuickPreview";
import { quickPreviewRunner } from "../../proposals/quickPreviewControl";
import { runQuickPreviewTool } from "../../proposals/proposalCode";
import { proposalCodeChanged } from "../../proposals/useProposalBuild";
import { resetServerBuildsForTests } from "../../proposals/serverFirst";

/*
 * The network is the edge here: the proposal Val's server reads, and Val
 * Build's quick preview. Everything between -- when a quick preview runs, how
 * it reaches the page, what the assistant's tool answers -- is the product's.
 */
const mockProposal = { name: "p1", branch: "val/p/p1" };
let mockStaged: { inputs: string | null; buildRequired: boolean } = {
  inputs: "inputs-1",
  buildRequired: true,
};
const mockQuickPreview = jest.fn();
jest.mock("../ValProvider", () => ({
  useCurrentProposal: () => mockProposal,
  useStudioDeployState: () => ({ deploy: jest.fn(), state: null }),
}));
jest.mock("../../proposals/proposalsClient", () => ({
  createProposalsClient: () => ({
    get: async () => ({ status: "open", staged: { files: [], ...mockStaged } }),
    quickPreview: (name: string, inputs: string) =>
      mockQuickPreview(name, inputs),
    files: jest.fn(),
    buildTarget: jest.fn(),
  }),
}));

jest.setTimeout(15_000);

const FILES = { "/_app/app.js": { type: "text/javascript", text: "app" } };

beforeEach(() => {
  // Nothing in a quick preview made by Val Build goes to the network but
  // the proposals client above; the publish client is made, never called.
  (globalThis as { fetch?: unknown }).fetch = () =>
    Promise.reject(new Error("Not this test's network"));
  resetServerBuildsForTests();
  mockStaged = { inputs: "inputs-1", buildRequired: true };
  mockQuickPreview.mockReset();
  mockQuickPreview.mockImplementation(async (_name, inputs: string) => ({
    files: FILES,
    inputs,
  }));
});

function renderQuickPreview(initial: {
  pageLive: boolean;
  buildEpoch: number;
}) {
  const store = jest.fn(async () => {});
  const hook = renderHook((props) => useCodeModeQuickPreview(props), {
    initialProps: initial,
  });
  act(() => hook.result.current.setStorer(store));
  return { ...hook, store };
}

describe("the quick preview in code mode", () => {
  test("a change staged in the proposal is shown on the page by itself, once the page answers", async () => {
    const { result, store } = renderQuickPreview({
      pageLive: true,
      buildEpoch: 0,
    });
    await waitFor(() => expect(store).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(mockQuickPreview).toHaveBeenCalledWith("p1", "inputs-1");
    expect(store).toHaveBeenCalledWith(expect.any(String), FILES);
    // The canvas opens the page as that quick preview...
    await waitFor(() => expect(result.current.quickId).not.toBeNull());
    expect(result.current.shown).toBe(false);
    // ...and once it is live, it is in front.
    act(() => result.current.onLive());
    expect(result.current.shown).toBe(true);
    await waitFor(() => expect(result.current.state.status).toBe("idle"));
  });

  test("nothing is previewed while the page does not answer, or when the served build has what is staged", async () => {
    const { store, rerender } = renderQuickPreview({
      pageLive: false,
      buildEpoch: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(store).not.toHaveBeenCalled();

    mockStaged = { inputs: "inputs-1", buildRequired: false };
    act(() => proposalCodeChanged());
    rerender({ pageLive: true, buildEpoch: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(mockQuickPreview).not.toHaveBeenCalled();
  });

  test("the assistant's quick_preview shows it, and says when the page has it", async () => {
    mockStaged = { inputs: "inputs-2", buildRequired: false };
    const { result } = renderQuickPreview({ pageLive: true, buildEpoch: 0 });
    const runner = quickPreviewRunner();
    expect(runner).not.toBeNull();
    const answer = runQuickPreviewTool(runner);
    await waitFor(() => expect(result.current.quickId).not.toBeNull());
    act(() => result.current.onLive());
    const { result: toolResult, isError } = await answer;
    expect(isError).toBe(false);
    expect(toolResult).toMatchObject({ success: true });
  });

  test("a build served after it puts the served build back in the canvas", async () => {
    const { result, rerender, store } = renderQuickPreview({
      pageLive: true,
      buildEpoch: 0,
    });
    await waitFor(() => expect(store).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(result.current.quickId).not.toBeNull());
    act(() => result.current.onLive());
    expect(result.current.shown).toBe(true);

    mockStaged = { inputs: "inputs-1", buildRequired: false };
    rerender({ pageLive: true, buildEpoch: 1 });
    expect(result.current.quickId).toBeNull();
    expect(result.current.shown).toBe(false);
  });

  test("the assistant is told where none can be shown", async () => {
    const { unmount } = renderQuickPreview({ pageLive: true, buildEpoch: 0 });
    unmount();
    expect(quickPreviewRunner()).toBeNull();
    const { isError, result } = await runQuickPreviewTool(null);
    expect(isError).toBe(true);
    expect(result).toMatchObject({ success: false });
  });
});

describe("withQuickPreview", () => {
  test("opens the page as the quick preview, keeping its query and hash", () => {
    expect(withQuickPreview("/blog", "abc")).toBe("/blog?val_quick=abc");
    expect(withQuickPreview("/blog?x=1#top", "abc")).toBe(
      "/blog?x=1&val_quick=abc#top",
    );
    expect(withQuickPreview("/blog", null)).toBe("/blog");
  });
});

describe("withQuickPreviewState", () => {
  const idle = { state: { status: "idle" as const }, shown: false };
  test("a change not built yet says it is being shown, or is shown", () => {
    expect(
      withQuickPreviewState(
        { state: "behind" },
        { state: { status: "running", step: "x", startedAt: 0 }, shown: false },
      ),
    ).toEqual({ state: "previewing" });
    expect(
      withQuickPreviewState({ state: "behind" }, { ...idle, shown: true }),
    ).toEqual({ state: "quick" });
    expect(withQuickPreviewState({ state: "behind" }, idle)).toEqual({
      state: "behind",
    });
  });
  test("a build running, failed or served says so, whatever the quick preview does", () => {
    const shown = { ...idle, shown: true };
    expect(withQuickPreviewState({ state: "up-to-date" }, shown)).toEqual({
      state: "up-to-date",
    });
    expect(
      withQuickPreviewState({ state: "updating", progress: 0.5 }, shown),
    ).toEqual({ state: "updating", progress: 0.5 });
  });
});
