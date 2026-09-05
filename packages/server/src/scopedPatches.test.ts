import { scopedPatches } from "./ValServer";
import type { PatchId } from "@valbuild/core";
import type { CommitSha } from "./ValOps";

/**
 * What a scoped draft render applies.
 *
 * Scoping exists to keep other people's PENDING work out of your preview. It
 * was also keeping COMMITTED work out, which is a different thing entirely: a
 * published patch stays in the chain with `appliedAt` set until the next
 * deployment moves the base, and the unscoped path applies it.
 *
 * The symptom was sharp. The moment Alice published, her own draft preview
 * reverted the field she had just shipped, and stayed that way until the deploy
 * landed. Bob never saw it in that window either — so anything he wrote on top
 * was authored against content already stale on `main`.
 */

const applied = { commitSha: "abc123" as CommitSha };

function patch(patchId: string, appliedAt: typeof applied | null = null) {
  return { patchId: patchId as PatchId, appliedAt };
}

const ids = (list: { patchId: PatchId }[]) => list.map((p) => p.patchId);

test("keeps the caller's own pending patches", () => {
  const chain = [patch("mine"), patch("theirs")];
  expect(ids(scopedPatches(chain, ["mine" as PatchId]))).toEqual(["mine"]);
});

test("keeps a committed patch the caller does not hold", () => {
  // Bob published; Alice is scoped to her own group. Between his publish and
  // the deploy this is the only thing standing between her and a stale render.
  const chain = [patch("theirs", applied), patch("mine")];
  expect(ids(scopedPatches(chain, ["mine" as PatchId]))).toEqual([
    "theirs",
    "mine",
  ]);
});

test("keeps the caller's OWN patch once it is committed", () => {
  /*
   * A publish CLOSES the group, so the just-published patch stops being in any
   * open group — which is exactly when the author would have watched their own
   * change disappear from their own preview.
   */
  const chain = [patch("mine", applied)];
  expect(ids(scopedPatches(chain, []))).toEqual(["mine"]);
});

test("a partially published group still yields its applied patches", () => {
  /*
   * The reason this keys on `appliedAt` and not on the group's `publishedAt`:
   * publishing a subset leaves the group OPEN with some patches applied, and no
   * flag on the group names them.
   */
  const chain = [patch("shipped", applied), patch("still-pending")];
  expect(ids(scopedPatches(chain, []))).toEqual(["shipped"]);
});

test("holding nothing on a branch with nothing applied renders base", () => {
  const chain = [patch("theirs")];
  expect(scopedPatches(chain, [])).toEqual([]);
});

test("chain order survives the filter", () => {
  // The server applies what it is given in the order it is given, so a filter
  // that reordered would apply patches out of sequence.
  const chain = [patch("a", applied), patch("b"), patch("c", applied)];
  expect(ids(scopedPatches(chain, ["b" as PatchId]))).toEqual(["a", "b", "c"]);
});
