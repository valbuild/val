/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { SourcePath } from "@valbuild/core";
import { useNoOpSourcePaths } from "./ValProvider";

/**
 * Which paths ended up back where they started.
 *
 * `useNoOpSourcePaths` answers "did this path end up back where it started",
 * and the review screen files everything it names under "reverted" — a
 * collapsed section that says the content matches what is published and offers
 * only Discard. It answers by comparing the DISPLAYED source against base.
 */

const NAME = '/content/authors.val.ts?p="teddy"."name"' as SourcePath;

function systemWith(options: {
  /** What each path currently displays. */
  after: Record<string, unknown>;
  /** What each path displayed before any pending patch. */
  before: Record<string, unknown>;
}) {
  const noEvents = { on: () => () => {} };
  return {
    system: {
      sourceStore: {
        events: noEvents,
        sourcesVersion: () => 1,
        peek: (path: SourcePath) => ({
          status: "ready",
          data: options.after[path],
        }),
        peekBase: (path: SourcePath) => ({
          status: "ready",
          data: options.before[path],
        }),
      },
      patchStore: {
        events: noEvents,
        chainVersion: () => 1,
      },
    },
  };
}

// `mock`-prefixed so jest allows the factory below to close over it.
let mockCurrent: ReturnType<typeof systemWith> | null = null;
/*
 * `ValProvider` imports the system factory, which reaches an ESM-only module
 * jest cannot require. Nothing on this path calls it — the system here is a
 * stub — so it is replaced rather than loaded. Without this the suite cannot
 * even be imported, which is why no other test reaches into `ValProvider`.
 */
jest.mock("../stores/react/createValSystem", () => ({
  __esModule: true,
  createValSystem: () => {
    throw new Error("not used in this test");
  },
}));
jest.mock("../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => mockCurrent,
}));

function noOpPaths(
  options: Parameters<typeof systemWith>[0],
  paths: SourcePath[] = [NAME],
): Set<SourcePath> {
  mockCurrent = systemWith(options);
  const { result } = renderHook(() => useNoOpSourcePaths(paths));
  return new Set(result.current);
}

test("a path whose change was undone is a no-op", () => {
  // The two sides really are equal, and "reverted" is the right answer. This
  // is the case the classification exists for.
  expect(
    noOpPaths({
      after: { [NAME]: "Theodor René Carlsen" },
      before: { [NAME]: "Theodor René Carlsen" },
    }),
  ).toContain(NAME);
});

test("a path with a visible change is not a no-op", () => {
  expect(
    noOpPaths({
      after: { [NAME]: "Ada was here" },
      before: { [NAME]: "Theodor René Carlsen" },
    }),
  ).not.toContain(NAME);
});
