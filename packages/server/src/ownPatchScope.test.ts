import type { PatchId } from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { ownPatchScopeFor } from "./ValServer";

/**
 * Whose pending patches a scoped draft render shows.
 *
 * `/sources/~` reads the group list first (to learn whether groups exist at
 * all) and then the whole chain. The list is remembered for a second, so it can
 * be older than the chain: an editor who saved and reloaded at once was
 * rendered without the patch they had just written. Found by home's
 * `pnpm loop --content real`. The chain response carries membership read in the
 * same transaction as the patches, and that is what decides.
 */
const group = (over: Partial<PatchGroupT>): PatchGroupT => ({
  patchGroupId: "group-alice",
  authorId: "alice",
  createdAt: "2026-01-01T00:00:00Z",
  publishedAt: null,
  patchIds: [],
  ...over,
});
const ids = (...list: string[]) => list as PatchId[];

test("the response's membership wins over the remembered list", () => {
  const remembered = ids("a");
  const fetched = { patchGroups: [group({ patchIds: ids("a", "b") })] };
  expect(ownPatchScopeFor(fetched, "alice", remembered)).toEqual(["a", "b"]);
});

test("only this author's OPEN groups count", () => {
  const fetched = {
    patchGroups: [
      group({ patchIds: ids("a") }),
      group({ patchGroupId: "group-bob", authorId: "bob", patchIds: ids("b") }),
      group({
        patchGroupId: "group-alice-old",
        publishedAt: "2026-01-02T00:00:00Z",
        patchIds: ids("c"),
      }),
    ],
  };
  expect(ownPatchScopeFor(fetched, "alice", undefined)).toEqual(["a"]);
});

test("holding nothing in a response that has groups is base, not everything", () => {
  const fetched = {
    patchGroups: [group({ authorId: "bob", patchIds: ids("b") })],
  };
  expect(ownPatchScopeFor(fetched, "alice", ids("a"))).toEqual([]);
});

test("a response without membership, or no author, falls back to the list", () => {
  expect(ownPatchScopeFor({}, "alice", ids("a"))).toEqual(["a"]);
  expect(
    ownPatchScopeFor(
      { patchGroups: [group({ patchIds: ids("b") })] },
      undefined,
      ids("a"),
    ),
  ).toEqual(["a"]);
});
