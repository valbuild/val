import { useEffect, useMemo } from "react";
import type { PatchId } from "@valbuild/core";
import type { SerializedPatchSet } from "../utils/PatchSets";
// Type-only, so this does not close a cycle at runtime: the provider imports
// this module for the hook, and only the shape of its change event comes back.
import type { PatchGroupChange } from "./PatchStagingProvider";
import {
  CLOSURE_VERSION,
  indexPatchSets,
  repairGroup,
  validateGroup,
  type PatchGroup,
  type PatchSetIndex,
} from "../utils/patchGroups";

/**
 * Keep a patch group prefix-closed, whatever the chain does.
 *
 * A group is only safe to publish because it holds a PREFIX of every patch set
 * it touches: what stays behind is in other patch sets and cannot have its
 * paths shifted by the commit. That is maintained at the point of every stage
 * and every write — `stageClosure` and the write-path closure both compute it —
 * so a group cannot acquire a hole by anything its owner does.
 *
 * It can acquire one by what somebody ELSE does. Patch sets coalesce:
 * `PatchSets.insertPath` merges an existing set into a new, broader one when the
 * new patch's path is a prefix of it, so a third party's array insert can
 * swallow two leaf sets and leave a hole in a group whose owner touched
 * nothing. Nothing about that is visible at stage time, because it happens
 * afterwards — which is why this re-validates on every recomputation of the
 * index rather than on stage and unstage.
 *
 * `extend` is the policy: grow the group so the user's own change stays
 * publishable. `truncate` would silently drop their work while leaving a valid
 * group, which no assertion can catch — see the DECISION tests in
 * `patchGroups.test.ts` for both traces side by side.
 *
 * Called from the SHELL as well as from `PatchStagingProvider`, and that is the
 * point rather than an accident. The provider is mounted only on the review
 * screen, so a repair that lived there alone would run only while somebody
 * happened to be looking at Compare — and the coalescing insert that needs it
 * arrives while they are editing. Running it twice is harmless: the second pass
 * validates a group the first already repaired and does nothing.
 */
export function usePatchGroupRepair({
  enabled,
  indexed,
  group,
  onChange,
}: {
  enabled: boolean;
  /** From {@link useIndexedPatchSets}, so a caller that also renders from the
   * index does not build it twice. */
  indexed: IndexedPatchSets;
  group: PatchGroup;
  onChange: (next: Set<PatchId>, change: PatchGroupChange) => void;
}): void {
  const index = indexed.value;
  useEffect(() => {
    if (!enabled || !indexed.ok) {
      return;
    }
    if (validateGroup(index, group).length === 0) {
      return;
    }
    const repair = repairGroup(index, group, "extend");
    onChange(repair.group, {
      type: "stage",
      requested: [],
      alsoMoved: repair.added,
      closureVersion: CLOSURE_VERSION,
    });
  }, [enabled, indexed.ok, index, group, onChange]);
}

/**
 * The patch-set index, or a disabled one where the inputs disagree.
 *
 * `indexPatchSets` throws if a patch set names a patch the chain order does not
 * have, which is a real possibility mid-sync. Thrown during render it would
 * take the whole review screen down, so a skew turns staging off for this
 * render instead — the changes are still reviewable, just not stageable.
 */
export type IndexedPatchSets = {
  value: PatchSetIndex;
  /** False where the index could not be built, and staging must stay off. */
  ok: boolean;
};

export function useIndexedPatchSets(
  patchSets: SerializedPatchSet | undefined,
  chainOrder: readonly PatchId[],
): IndexedPatchSets {
  return useMemo(() => {
    if (patchSets === undefined) {
      // Not computed yet. Not a skew, so nothing is logged: there is simply
      // nothing to validate against until the grouping arrives.
      return { value: indexPatchSets([], []), ok: false };
    }
    try {
      return { value: indexPatchSets(patchSets, chainOrder), ok: true };
    } catch (err) {
      console.error(
        "Val: could not index patch sets, disabling staging for this render",
        err,
      );
      return { value: indexPatchSets([], []), ok: false };
    }
  }, [patchSets, chainOrder]);
}
