import { last } from "@remirror/core";
import { ModuleFilePath } from "@valbuild/core";
import { Patch, Operation } from "@valbuild/core/patch";

export function mergePatches(
  pendingPatches: Record<ModuleFilePath, { patch: Patch; seqNumber: number }[]>,
) {
  const pendingPatchesModuleFilePaths = Object.keys(
    pendingPatches,
  ) as ModuleFilePath[];
  if (pendingPatchesModuleFilePaths.length === 0) {
    return;
  }
  const mergedPatches: { patch: Patch; path: ModuleFilePath }[] = [];
  for (const moduleFilePath of pendingPatchesModuleFilePaths) {
    const patches = pendingPatches[moduleFilePath];
    let lastMergeOp: Operation | undefined;
    const sortedPatches = patches.sort((a, b) => a.seqNumber - b.seqNumber);
    for (let i = 0; i < sortedPatches.length; i++) {
      const { patch } = sortedPatches[i];
      if (patch.length === 1 && patch[0].op === "replace") {
        if (
          lastMergeOp &&
          lastMergeOp.op === "replace" &&
          patch[0].path.join("/") === lastMergeOp.path.join("/")
        ) {
          // merge current replace with last replace
          lastMergeOp.value = patch[0].value;
        } else {
          if (lastMergeOp) {
            mergedPatches.push({
              patch: [lastMergeOp],
              path: moduleFilePath,
            });
            lastMergeOp = undefined;
          }
          lastMergeOp = patch[0];
        }
      } else {
        if (lastMergeOp) {
          mergedPatches.push({
            patch: [lastMergeOp],
            path: moduleFilePath,
          });
          lastMergeOp = undefined;
        }
        mergedPatches.push({
          patch,
          path: moduleFilePath,
        });
      }
    }
    if (lastMergeOp) {
      mergedPatches.push({
        patch: [lastMergeOp],
        path: moduleFilePath,
      });
      lastMergeOp = undefined;
    }
  }
  return mergedPatches;
}
