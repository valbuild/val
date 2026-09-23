import { useCallback, useMemo } from "react";
import {
  useCommittedPatches,
  useCurrentAuthorId,
  useCurrentPatchIds,
  useDeletePatches,
  usePatchSets,
  useProfilesByAuthorId,
} from "./ValProvider";
import { discardAllDescription } from "./discardAllDescription";

/**
 * Reverting every unpublished change, and the sentence that warns about it.
 *
 * One hook because two surfaces offer this — the utility panel's quick action
 * and the review page's header — and they have to agree. A destructive action
 * that names a colleague in one place and not the other is worse than one that
 * never warns at all, which is what the two copies of this were heading for.
 *
 * `enabled` is false until the patch sets have grouped, and that is not a
 * loading nicety: the confirm's sentence names the other people whose work
 * would go, and those names come OUT of the patch sets. An eager button could
 * throw away a colleague's work having promised, and shown, nothing about it.
 */
export function useDiscardAll(): {
  enabled: boolean;
  count: number;
  description: string;
  discardAll: () => void;
} {
  const { deletePatches } = useDeletePatches();
  const currentPatchIds = useCurrentPatchIds();
  const committedPatchIds = useCommittedPatches();
  const patchSets = usePatchSets();
  const profilesByAuthorIds = useProfilesByAuthorId();
  const currentAuthorId = useCurrentAuthorId();

  /*
   * Everything discardable: the chain minus what has already shipped.
   *
   * A committed patch cannot be taken back from here — it is in a commit — and
   * including one would make the count promise more than it can do. Same
   * subtraction `useShellData` does for `pendingChanges`, so the number in the
   * confirm matches the number on the row that opened it.
   */
  const discardablePatchIds = useMemo(
    () => currentPatchIds.filter((patchId) => !committedPatchIds.has(patchId)),
    [currentPatchIds, committedPatchIds],
  );

  /*
   * Whose work this would take, named — yours excluded.
   *
   * `currentAuthorId` comes out because the sentence is about work that is not
   * yours. Your own name in it is noise at best, and at worst it is what makes
   * a project where you are the only editor read as if someone else had a stake
   * in the changes. Read off the patch sets rather than the activity feed,
   * which is capped for display.
   */
  const otherAuthorNames = useMemo(() => {
    if (patchSets.status !== "success") return [];
    const discardable = new Set<string>(discardablePatchIds);
    const authorIds = new Set<string>();
    for (const set of patchSets.data) {
      for (const patch of set.patches) {
        if (
          patch.author !== null &&
          patch.author !== currentAuthorId &&
          discardable.has(patch.patchId)
        ) {
          authorIds.add(patch.author);
        }
      }
    }
    return [...authorIds]
      .map((id) => profilesByAuthorIds?.[id]?.fullName)
      .filter((name): name is string => !!name);
  }, [patchSets, discardablePatchIds, profilesByAuthorIds, currentAuthorId]);

  const discardAll = useCallback(() => {
    deletePatches(discardablePatchIds);
  }, [deletePatches, discardablePatchIds]);

  return {
    enabled: discardablePatchIds.length > 0 && patchSets.status === "success",
    count: discardablePatchIds.length,
    description: discardAllDescription(
      discardablePatchIds.length,
      otherAuthorNames,
    ),
    discardAll,
  };
}
