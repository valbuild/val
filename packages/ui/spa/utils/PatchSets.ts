// Moved to @valbuild/shared, where Val's server groups pending changes the
// same way when a proposal is merged (`proposalMerge/merge.ts`).
export {
  PatchSets,
  isInsidePatchSetPath,
  type PatchMetadata,
  type PatchSetMetadata,
  type SerializedPatchSet,
} from "@valbuild/shared/internal";
