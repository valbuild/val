/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { PatchId } from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";

/*
 * `ValProvider` imports the system factory, which reaches an ESM-only module
 * jest cannot require. Nothing on this path calls it — every input here is a
 * mocked hook — so it is replaced rather than loaded.
 */
jest.mock("../stores/react/createValSystem", () => ({
  __esModule: true,
  createValSystem: () => {
    throw new Error("not used in this test");
  },
}));

// `mock`-prefixed so jest allows the factory below to close over them.
let mockGroups: PatchGroupT[] | undefined;
let mockSupported = true;
let mockAuthorId: string | null = "alice";
let mockOwnGroupId: string | undefined;

jest.mock("./ValProvider", () => ({
  __esModule: true,
  usePatchGroups: () => mockGroups,
  usePatchGroupsSupported: () => mockSupported,
  useCurrentAuthorId: () => mockAuthorId,
  useOwnPatchGroupId: () => mockOwnGroupId,
}));

import { useCurrentPatchGroup } from "./useCurrentPatchGroup";

/**
 * Which group this client stages into, when the two sources disagree.
 *
 * There are two, and they go stale in opposite directions. The chain
 * ANNOTATION is refetched only when a chain fetch has missing ids to ask for,
 * so on a quiet branch it can be arbitrarily old. `ownGroupId` comes from the
 * most recent save response and is cleared by `markPublished` at exactly the
 * moment it stops being true.
 *
 * Getting the precedence backwards is not a cosmetic bug: it names a group the
 * server has closed, so every stage and unstage is refused with 409, the
 * failure is only logged, and the deferred queue never engages because there
 * appears to be a group to send to. On reload an unstaged change comes back
 * staged and the next publish ships it.
 */

const group = (over: Partial<PatchGroupT> = {}): PatchGroupT => ({
  patchGroupId: "gA",
  authorId: "alice",
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
  patchIds: ["p1" as PatchId],
  ...over,
});

function current(state: {
  groups?: PatchGroupT[];
  supported?: boolean;
  authorId?: string | null;
  ownGroupId?: string;
}) {
  mockGroups = state.groups;
  mockSupported = state.supported ?? true;
  mockAuthorId = state.authorId === undefined ? "alice" : state.authorId;
  mockOwnGroupId = state.ownGroupId;
  return renderHook(() => useCurrentPatchGroup()).result.current;
}

test("the annotation names the group when nothing fresher does", () => {
  const res = current({ groups: [group()] });
  expect(res).toMatchObject({ enabled: true, patchGroupId: "gA" });
  expect([...res.members]).toEqual(["p1"]);
});

test("a save response beats a stale annotation", () => {
  /*
   * The window after a publish: the server closed gA and put the next write in
   * gB, but the annotation still lists gA as open because nothing refetched it.
   * Preferring the annotation here answered gA — a group the server refuses.
   */
  const res = current({ groups: [group()], ownGroupId: "gB" });
  expect(res.patchGroupId).toBe("gB");
  /*
   * And NOT gA's members. The annotation is the only source of membership, but
   * reporting one group's id with another group's members is how the staging
   * screen comes to show a set that will not publish.
   */
  expect([...res.members]).toEqual([]);
});

test("a group this user published in ANOTHER tab is not named", () => {
  /*
   * `markPublished` runs only for a publish made in this tab, so `ownGroupId`
   * survives one made elsewhere — and preferring it unconditionally then named
   * a group the server has closed. Every stage from this tab became a 409 that
   * is only logged, while the local scope moved anyway, and the deferred queue
   * never engaged because there appeared to be a group.
   */
  const res = current({
    groups: [group({ publishedAt: "2026-01-02T00:00:00.000Z" })],
    ownGroupId: "gA",
  });
  expect(res.patchGroupId).toBe(undefined);
  // Which puts this tab back in the post-publish window it is really in.
  expect(res.enabled).toBe(true);
});

test("a published own group falls through to a newer open one", () => {
  const res = current({
    groups: [
      group({ publishedAt: "2026-01-02T00:00:00.000Z" }),
      group({ patchGroupId: "gB", patchIds: ["p2" as PatchId] }),
    ],
    ownGroupId: "gA",
  });
  expect(res.patchGroupId).toBe("gB");
  expect([...res.members]).toEqual(["p2"]);
});

test("a published annotation group is never named", () => {
  // What `markPublished` now writes locally, since nothing refetches it.
  const res = current({
    groups: [group({ publishedAt: "2026-01-02T00:00:00.000Z" })],
  });
  expect(res.patchGroupId).toBe(undefined);
  // No id means the deferred queue takes the change, which is the point.
  expect(res.enabled).toBe(true);
});

test("another author's open group is not this client's", () => {
  const res = current({ groups: [group({ authorId: "bob" })] });
  expect(res.patchGroupId).toBe(undefined);
});

test("a group with no author belongs to nobody", () => {
  // An api-key or PAT write. `null === null` must not read as a match.
  const res = current({ groups: [group({ authorId: null })], authorId: null });
  expect(res.enabled).toBe(false);
});

test("staging is off until we know who the user is", () => {
  /*
   * `profileId` comes from `/stat`, the annotation from `GET /patches`: two
   * independent requests, either order. Answering `enabled: true` with no
   * members here made the race permanent — the shell seeds the scope from those
   * empty members and never seeds again.
   */
  expect(current({ groups: [group()], authorId: null }).enabled).toBe(false);
  // Unless our own save named a group, which is ours by construction rather
  // than by comparing an author id we do not have.
  expect(
    current({ groups: [group()], authorId: null, ownGroupId: "gB" }),
  ).toMatchObject({ enabled: true, patchGroupId: "gB" });
});

test("a deployment without patch groups keeps staging off entirely", () => {
  expect(current({ supported: false, groups: [group()] })).toMatchObject({
    enabled: false,
    patchGroupId: undefined,
  });
});
