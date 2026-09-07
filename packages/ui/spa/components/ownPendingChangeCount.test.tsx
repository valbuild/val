/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { useOwnPendingChangeCount } from "./ValProvider";

/**
 * What Review's badge counts.
 *
 * It sits beside Publish and is read as "how much is waiting for me", so it has
 * to be the scoped set. On a shared branch the chain also holds other people's
 * pending work — which this client can neither publish nor discard — and a
 * badge that counted it would send the reader off to deal with somebody else's
 * edit.
 */

const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
const MINE = "mine" as PatchId;
const ALSO_MINE = "also-mine" as PatchId;
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
  /** What this client is scoped to. `null` is unscoped. */
  scope: PatchId[] | null;
  /** Already in a commit, though still in the chain. */
  committed: PatchId[];
}): number {
  const noEvents = { on: () => () => {} };
  mockCurrent = {
    system: {
      patchGroup: () => options.scope,
      sourceStore: { events: noEvents, sourcesVersion: () => 1 },
      patchStore: {
        events: noEvents,
        chainVersion: () => 1,
        groupsVersion: () => 1,
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

test("unscoped counts the whole chain", () => {
  // `fs` mode, or a content API without groups. One author, so the chain is
  // theirs — the same number this showed before groups existed.
  expect(count({ chain: [MINE, THEIRS], scope: null, committed: [] })).toBe(2);
});

test("scoped counts only what this client would publish", () => {
  expect(
    count({
      chain: [MINE, THEIRS, ALSO_MINE],
      scope: [MINE, ALSO_MINE],
      committed: [],
    }),
  ).toBe(2);
});

test("a change held back is not counted", () => {
  // Unstaged: still in the chain, still pending, and not this publish's.
  expect(count({ chain: [MINE, THEIRS], scope: [], committed: [] })).toBe(0);
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
      scope: [SHIPPED, MINE],
      committed: [SHIPPED],
    }),
  ).toBe(1);
});
