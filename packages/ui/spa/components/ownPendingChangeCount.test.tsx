/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { useOwnPendingChangeCount } from "./ValProvider";

/**
 * What Review's badge counts.
 *
 * Every pending change in the chain — what Publish would ship — and nothing
 * that has already shipped.
 */

const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
const MINE = "mine" as PatchId;
const THEIRS = "theirs" as PatchId;
const SHIPPED = "shipped" as PatchId;

// `mock`-prefixed so jest allows the factory below to close over it.
let mockCurrent: unknown = null;

/*
 * `ValProvider` imports the system factory, which reaches an ESM-only module
 * jest cannot require. Nothing on this path calls it, so it is replaced rather
 * than loaded.
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

function count(options: {
  /** Every patch in the chain, oldest first. */
  chain: PatchId[];
  /** Already in a commit, though still in the chain. */
  committed: PatchId[];
}): number {
  const noEvents = { on: () => () => {} };
  mockCurrent = {
    system: {
      sourceStore: { events: noEvents, sourcesVersion: () => 1 },
      patchStore: {
        events: noEvents,
        chainVersion: () => 1,
        publishedPatchIds: () => new Set(options.committed),
        allRecords: () =>
          options.chain.map((patchId) => ({
            patchId,
            moduleFilePath: AUTHORS,
            patch: [],
            appliedAt: options.committed.includes(patchId)
              ? { commitSha: "abc" }
              : null,
          })),
      },
    },
  };
  return renderHook(() => useOwnPendingChangeCount()).result.current;
}

test("counts the whole chain", () => {
  expect(count({ chain: [MINE, THEIRS], committed: [] })).toBe(2);
});

test("a published patch is not counted, though it is still in the chain", () => {
  /*
   * A published patch stays in the chain in `http` mode until the new commit
   * comes back. Counting it would have Review offer work that is already in a
   * commit and cannot be discarded.
   */
  expect(
    count({
      chain: [SHIPPED, MINE],
      committed: [SHIPPED],
    }),
  ).toBe(1);
});
