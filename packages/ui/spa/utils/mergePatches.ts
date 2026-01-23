import { ModuleFilePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";

export function mergePatches(
  pendingPatches: Record<ModuleFilePath, { patch: Patch; seqNumber: number }[]>
): { patch: Patch; path: ModuleFilePath }[] {
  const pendingPatchesModuleFilePaths = Object.keys(
    pendingPatches
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
      if (canMerge(patch, sortedPatches[i + 1]?.patch)) {
        continue;
      }
      mergedPatches.push({ patch, path: moduleFilePath });
    }
  }
  return mergedPatches;
}

export function canMerge(last: Patch | undefined, next: Patch | undefined) {
  if (!last || !next) {
    return false;
  }
  // Currently the only case we merge is when there's 1 op in both patches and they both replace the same value
  // This is a pretty common use case, since every keystroke is a patch
  if (last.length === 1 && last[0].op === "replace") {
    if (next.length === 1 && next[0].op === "replace") {
      return last[0].path.join("/") === next[0].path.join("/");
    }
  }
  return false;
}
