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
let mockHeld: PatchId[] = [];
let mockAuthorId: string | null = "alice";
let mockRecords: { patchId: PatchId; authorId: string | null }[] = [];

jest.mock("./ValProvider", () => ({
  __esModule: true,
  useHeldPatchIds: () => new Set(mockHeld),
  useCurrentAuthorId: () => mockAuthorId,
}));
jest.mock("../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => ({
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
  }),
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
  mockHeld = options.held;
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
