import { PatchId } from "@valbuild/core";
import { ParentRef } from "@valbuild/core/patch";
import { OrderedPatches } from "./ValOps";

/**
 * Computes the changed patch parent references based on the current patches and the patch IDs to be deleted.
 *
 * NOTE: patches that will be deleted are not included in the changed patches, since they will be deleted any how.
 *
 * @param currentPatches - The array of current patches.
 * @param deletePatchIds - The array of patch IDs to be deleted.
 * @returns An object containing the changed patches with their corresponding parent references.
 */
export function computeChangedPatchParentRefs(
  currentPatches: OrderedPatches["patches"],
  deletePatchIds: PatchId[],
): {
  changedPatches: Record<PatchId, ParentRef>;
} {
  let lastNonDeletedPatchIndex = -1;
  const changedPatches: Record<PatchId, ParentRef> = {};
  for (let i = 0; i < currentPatches.length; i++) {
    const current = currentPatches[i];
    if (
      // skip all patches that will be deleted:
      deletePatchIds.includes(current.patchId)
    ) {
      if (
        // skip change if the patch after is deleted anyway:
        !deletePatchIds.includes(currentPatches[i + 1]?.patchId)
      ) {
        if (
          // set next patch to point to head if it exists:
          lastNonDeletedPatchIndex === -1 &&
          currentPatches[i + 1]
        ) {
          changedPatches[currentPatches[i + 1].patchId] = {
            type: "head",
            headBaseSha: current.baseSha,
          };
        } else if (
          // set next patch to point to the last non-deleted patch:
          currentPatches[lastNonDeletedPatchIndex] &&
          currentPatches[i + 1]
        ) {
          changedPatches[currentPatches[i + 1].patchId] = {
            type: "patch",
            patchId: currentPatches[lastNonDeletedPatchIndex].patchId,
          };
        }
      }
    } else {
      lastNonDeletedPatchIndex = i;
    }
  }

  return {
    changedPatches,
  };
}
