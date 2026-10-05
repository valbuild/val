/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import type { SourcePath } from "@valbuild/core";
import { useRetainedCanvasPaths } from "./useRetainedCanvasPaths";

/**
 * The fields the "On this page" column keeps after the page stops showing them.
 *
 * The page only reports what it renders, and an emptied field often renders
 * nothing — so the column used to remove the field being typed in, focus and
 * all. These pin when a field is kept and the three things that end it.
 */

const path = (name: string) => `/content/page.val.ts?p="${name}"` as SourcePath;
const TITLE = path("title");
const BODY = path("body");
const LINK = path("link");
const PAGE = "/content/page.val.ts" as SourcePath;

// `mock`-prefixed so jest allows the factories below to close over them.
let mockAbsent = new Set<SourcePath>();
let mockChainVersion = 1;
const mockChainListeners = new Set<() => void>();
const mockSystem = {
  system: {
    sourceStore: {
      peek: (at: SourcePath) =>
        mockAbsent.has(at)
          ? { status: "absent", revision: 1 }
          : { status: "ready", revision: 1, data: "" },
    },
    patchStore: {
      events: {
        on: (_event: string, listener: () => void) => {
          mockChainListeners.add(listener);
          return () => mockChainListeners.delete(listener);
        },
      },
      chainVersion: () => mockChainVersion,
    },
  },
};
/*
 * `ValProvider` imports the system factory, which reaches an ESM-only module
 * jest cannot require — see `noOpSourcePaths.test.tsx`.
 */
jest.mock("../../../stores/react/createValSystem", () => ({
  __esModule: true,
  createValSystem: () => {
    throw new Error("not used in this test");
  },
}));
jest.mock("../../../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => mockSystem,
}));

type Props = {
  reported: readonly SourcePath[];
  selected: SourcePath | null;
  resetKey: string;
};

function renderColumn(initial: Props) {
  return renderHook(
    ({ reported, selected, resetKey }: Props) =>
      useRetainedCanvasPaths(reported, { selected, resetKey }),
    { initialProps: initial },
  );
}

/** An edit landing in the patch chain. */
function bumpChain() {
  act(() => {
    mockChainVersion += 1;
    for (const listener of mockChainListeners) listener();
  });
}

beforeEach(() => {
  mockAbsent = new Set();
  mockChainVersion = 1;
});

test("the selected field stays, in place, when the page stops showing it", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY, LINK],
    selected: BODY,
    resetKey: "/a\n0",
  });
  // Emptied: an empty rich text renders no element, so the page drops it.
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n0" });
  expect(result.current.paths).toEqual([TITLE, BODY, LINK]);
  expect([...result.current.offPage]).toEqual([BODY]);
});

test("it stays after the selection moves on", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY, LINK],
    selected: BODY,
    resetKey: "/a\n0",
  });
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n0" });
  rerender({ reported: [TITLE, LINK], selected: LINK, resetKey: "/a\n0" });
  expect(result.current.paths).toEqual([TITLE, BODY, LINK]);
});

test("a field nobody worked on goes when the page stops showing it", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY, LINK],
    selected: TITLE,
    resetKey: "/a\n0",
  });
  rerender({ reported: [TITLE, LINK], selected: TITLE, resetKey: "/a\n0" });
  expect(result.current.paths).toEqual([TITLE, LINK]);
  expect(result.current.offPage.size).toBe(0);
});

test("a kept field goes once it is gone from the content", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY, LINK],
    selected: BODY,
    resetKey: "/a\n0",
  });
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n0" });
  expect(result.current.paths).toEqual([TITLE, BODY, LINK]);

  // Removed in the editor: the chain moves before the page has re-rendered.
  mockAbsent.add(BODY);
  bumpChain();
  expect(result.current.paths).toEqual([TITLE, LINK]);
});

test("reloading the page lets go of what it stopped showing", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY, LINK],
    selected: BODY,
    resetKey: "/a\n0",
  });
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n0" });
  expect(result.current.paths).toContain(BODY);

  // Still selected, but the page does not show it, so nothing brings it back.
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n1" });
  expect(result.current.paths).toEqual([TITLE, LINK]);
});

test("so does moving to another route", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY, LINK],
    selected: BODY,
    resetKey: "/a\n0",
  });
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n0" });
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/b\n0" });
  expect(result.current.paths).toEqual([TITLE, LINK]);
});

test("a selection the column never listed is not added to it", () => {
  // The whole page is selected — the editor is on it, not on a field.
  const { result } = renderColumn({
    reported: [TITLE, LINK],
    selected: PAGE,
    resetKey: "/a\n0",
  });
  expect(result.current.paths).toEqual([TITLE, LINK]);
});

test("a page that reports a path twice still marks what it is not showing", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY],
    selected: BODY,
    resetKey: "/a\n0",
  });
  // As many reported paths as listed ones, but BODY is not among them.
  rerender({ reported: [TITLE, TITLE], selected: BODY, resetKey: "/a\n0" });
  expect(result.current.paths).toEqual([TITLE, BODY]);
  expect([...result.current.offPage]).toEqual([BODY]);
});

test("the same answer is the same array", () => {
  const { result, rerender } = renderColumn({
    reported: [TITLE, BODY, LINK],
    selected: BODY,
    resetKey: "/a\n0",
  });
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n0" });
  const before = result.current.paths;
  // A fresh report with the same content, as every scan of the page is.
  rerender({ reported: [TITLE, LINK], selected: BODY, resetKey: "/a\n0" });
  expect(result.current.paths).toBe(before);
});
