import pc from "picocolors";
import { ModuleFilePath, PatchId } from "@valbuild/core";
import { PreparedCommit } from "@valbuild/server";

export type PatchMetadata = {
  patchId: PatchId;
  path: ModuleFilePath;
  createdAt: string;
  authorId: string | null;
};

/**
 * Prints the pending patches grouped by module, marking the ones that could not
 * be applied. This is the same information `/save` returns on a 400, except it
 * lists all of them rather than the first per module.
 */
export function printPatchReport(
  patches: PatchMetadata[],
  prepared: Pick<PreparedCommit, "unappliablePatches" | "appliedPatches">,
  options: { verbose?: boolean } = {},
): void {
  const byModule = new Map<ModuleFilePath, PatchMetadata[]>();
  for (const patch of patches) {
    const existing = byModule.get(patch.path);
    if (existing) {
      existing.push(patch);
    } else {
      byModule.set(patch.path, [patch]);
    }
  }
  const moduleFilePaths = Array.from(byModule.keys()).sort();
  for (const moduleFilePath of moduleFilePaths) {
    const modulePatches = byModule.get(moduleFilePath) ?? [];
    const unappliableHere = modulePatches.filter(
      (patch) => prepared.unappliablePatches[patch.patchId],
    );
    const header = `${moduleFilePath} ${pc.dim(
      `(${modulePatches.length} patch${modulePatches.length === 1 ? "" : "es"})`,
    )}`;
    console.log(unappliableHere.length > 0 ? pc.red(header) : pc.green(header));
    for (const patch of modulePatches) {
      const failure = prepared.unappliablePatches[patch.patchId];
      if (!failure && !options.verbose) {
        continue;
      }
      const who = patch.authorId ?? "unknown author";
      const line = `  ${patch.patchId}  ${patch.createdAt}  ${who}`;
      if (failure) {
        console.log(pc.red(line));
        for (const messageLine of failure.message.split("\n")) {
          console.log(pc.red(`    ${messageLine}`));
        }
      } else {
        console.log(pc.dim(line));
      }
    }
  }

  const unappliableCount = Object.keys(prepared.unappliablePatches).length;
  console.log("");
  if (unappliableCount === 0) {
    console.log(
      pc.green(
        `${patches.length} pending patch${patches.length === 1 ? "" : "es"}, all appliable.`,
      ),
    );
  } else {
    console.log(
      pc.red(
        `${patches.length} pending patch${patches.length === 1 ? "" : "es"}, ` +
          `${unappliableCount} of which cannot be applied across ${moduleFilePaths.length} module(s).`,
      ),
    );
    console.log(
      pc.dim(
        "Publishing is blocked until these are removed. See: val delete-unappliable-patches --dry-run",
      ),
    );
  }
}
