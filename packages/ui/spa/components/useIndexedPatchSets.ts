import { useMemo } from "react";
import type { PatchId } from "@valbuild/core";
import type { SerializedPatchSet } from "../utils/PatchSets";
import { indexPatchSets, type PatchSetIndex } from "../utils/patchGroups";

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
