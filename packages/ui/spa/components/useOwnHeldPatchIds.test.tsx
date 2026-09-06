/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { ModuleFilePath, PatchId } from "@valbuild/core";

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

// `mock`-prefixed so jest allows the factories below to close over them.
/*
 * ONE Set instance, mutated in place — which is what the real store hands out.
 *
 * The first version of this mock built `new Set(mockHeld)` on every render, so
 * the hook under test saw a fresh reference each time and its memo recomputed
 * whether or not it was keyed correctly. That made the suite unable to fail for
 * the bug it was written next to: `PatchStore.heldPatchIds()` returns
 * `this.heldIds` itself, so a memo keyed on that reference never recomputes.
 */
const mockHeld = new Set<PatchId>();
let mockAuthorId: string | null = "alice";
let mockRecords: { patchId: PatchId; authorId: string | null }[] = [];

/*
 * The versions the store bumps when the chain or the groups move. Staging
 * changes both the held Set and one of these, so a hook that keys on them
 * recomputes even though the Set it was handed is the same object.
 */
const mockChainVersion = 1;
let mockGroupsVersion = 1;

jest.mock("./ValProvider", () => ({
  __esModule: true,
  useHeldPatchIds: () => mockHeld,
  useCurrentAuthorId: () => mockAuthorId,
  useChainVersion: () => mockChainVersion,
  useGroupsVersion: () => mockGroupsVersion,
}));
/*
 * ONE system object, as the real `useValSystem` context read returns.
 *
 * Rebuilding it per render was the second thing hiding the staleness: a memo
 * keyed on `[val, held, authorId]` recomputes every render if `val` changes
 * identity every render, so the suite passed no matter how the memo was keyed.
 */
const mockSystem = {
  system: {
    patchStore: {
      // `recordsFor` answers in chain order for the ids it KNOWS. An id it
      // does not know is simply absent, which is the store's own contract.
      recordsFor: (patchIds: PatchId[]) =>
        mockRecords
          .filter((record) => patchIds.includes(record.patchId))
          .map((record) => ({
            ...record,
            moduleFilePath: "/content/page.val.ts" as ModuleFilePath,
            patch: [],
          })),
    },
  },
};

jest.mock("../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => mockSystem,
}));

import { useOwnHeldPatchIds } from "./useOwnHeldPatchIds";

/**
 * Which held patches Publish may offer to stage.
 *
 * Holding other people's pending work is the NORMAL state on a shared branch,
 * so the branch-wide held set is the wrong input for any message that offers an
 * action. Publish told a user whose own edits had netted out to nothing that "1
 * change is held back — stage it in Review to publish", naming a colleague's
 * change they could neither publish nor sensibly stage, and the accurate
 * message about their own reverted work never appeared.
 */

const MINE = "mine" as PatchId;
const THEIRS = "theirs" as PatchId;
const BY_A_TOKEN = "by-a-token" as PatchId;

function ownHeld(options: {
  held: PatchId[];
  records: { patchId: PatchId; authorId: string | null }[];
  authorId?: string | null;
}): PatchId[] {
  mockHeld.clear();
  for (const patchId of options.held) mockHeld.add(patchId);
  mockRecords = options.records;
  mockAuthorId = options.authorId === undefined ? "alice" : options.authorId;
  return [...renderHook(() => useOwnHeldPatchIds()).result.current];
}

test("a colleague's held change is not this user's to stage", () => {
  expect(
    ownHeld({
      held: [THEIRS],
      records: [{ patchId: THEIRS, authorId: "bob" }],
    }),
  ).toEqual([]);
});

test("this user's own held change is", () => {
  // The case the message is actually for: you unstaged your own edit, so
  // "stage it in Review to publish" is true and useful.
  expect(
    ownHeld({
      held: [MINE],
      records: [{ patchId: MINE, authorId: "alice" }],
    }),
  ).toEqual([MINE]);
});

test("a mixed held set keeps only this user's", () => {
  expect(
    ownHeld({
      held: [THEIRS, MINE],
      records: [
        { patchId: THEIRS, authorId: "bob" },
        { patchId: MINE, authorId: "alice" },
      ],
    }),
  ).toEqual([MINE]);
});

test("a patch with no author is nobody's to stage", () => {
  /*
   * Written by an api key or a PAT. The server reads this the same way —
   * `refuseUnlessOwn` refuses a null-authored group rather than letting
   * `null === null` pass for ownership — and the two must not disagree.
   */
  expect(
    ownHeld({
      held: [BY_A_TOKEN],
      records: [{ patchId: BY_A_TOKEN, authorId: null }],
    }),
  ).toEqual([]);
});

test("with no identified user, nothing is offered", () => {
  // No session and not `fs`: we cannot say whose anything is, and guessing
  // would put a colleague's change behind a "stage it" prompt again.
  expect(
    ownHeld({
      held: [MINE],
      records: [{ patchId: MINE, authorId: "alice" }],
      authorId: null,
    }),
  ).toEqual([]);
});

test("staging a held change updates the count on the NEXT render", () => {
  /*
   * The bug a fresh mount cannot show.
   *
   * `PatchStore.heldPatchIds()` returns `this.heldIds` — one Set, mutated in
   * place — and `useHeldPatchIds` memoises that reference, so it is identical
   * across every change. A memo here keyed on that reference alone therefore
   * computes once and never again: Publish went on saying "1 change is held
   * back — stage it in Review" after the user had staged it, and in the other
   * direction never showed the message after an unstage.
   *
   * Re-rendering the SAME hook instance is what makes it visible; every test
   * above mounts afresh, so the memo is new and the staleness cannot appear.
   */
  mockHeld.clear();
  mockHeld.add(MINE);
  mockRecords = [{ patchId: MINE, authorId: "alice" }];
  mockAuthorId = "alice";

  const { result, rerender } = renderHook(() => useOwnHeldPatchIds());
  expect([...result.current]).toEqual([MINE]);

  // The user stages it: the store empties the Set it already handed out, and
  // bumps the groups version — which is the only signal that anything moved.
  mockHeld.clear();
  mockGroupsVersion += 1;
  rerender();

  expect([...result.current]).toEqual([]);
});
