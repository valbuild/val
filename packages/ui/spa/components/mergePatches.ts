import { ModuleFilePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";

export function mergePatches(
  pendingPatches: Record<ModuleFilePath, { patch: Patch; seqNumber: number }[]>,
): { patch: Patch; path: ModuleFilePath }[] {
  const pendingPatchesModuleFilePaths = Object.keys(
    pendingPatches,
  ) as ModuleFilePath[];
  if (pendingPatchesModuleFilePaths.length === 0) {
    return [];
  }
  const mergedPatches: { patch: Patch; path: ModuleFilePath }[] = [];
  for (const moduleFilePath of pendingPatchesModuleFilePaths) {
    const patches = pendingPatches[moduleFilePath];
    const sortedPatches = patches.sort((a, b) => a.seqNumber - b.seqNumber);
    for (let i = 0; i < sortedPatches.length; i++) {
      const { patch } = sortedPatches[i];
      if (patch.length === 1 && patch[0].op === "replace") {
        const nextPatch = sortedPatches[i + 1]?.patch;
        if (
          nextPatch &&
          nextPatch.length === 1 &&
          nextPatch[0].op === "replace" &&
          nextPatch[0].path.join("/") === patch[0].path.join("/")
        ) {
          continue;
        }
      }
      mergedPatches.push({ patch, path: moduleFilePath });
    }
  }
  return mergedPatches;
}
