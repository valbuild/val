import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";

/**
 * The paths a commit's ops touched, from the ops themselves.
 *
 * The alternative was reconstructing the module's previous state and diffing it
 * against the new one - which needed the pre-commit `.val.ts`, a static parse
 * of it, and a replay of every op, three fragile steps to rediscover something
 * the ops already say outright. An op carries the path it applies to. That is
 * the answer.
 *
 * Deduplicated and returned in first-touched order, because a module edited
 * eight times in one publish should list a field once, where it first changed.
 */
export function changedPathsOf(
  moduleFilePath: ModuleFilePath,
  patches: { patch: Patch }[],
): SourcePath[] {
  const seen = new Set<SourcePath>();
  const paths: SourcePath[] = [];
  for (const { patch } of patches) {
    for (const op of patch) {
      // A `file` op names a file, not a place in the source; the `replace` that
      // points the field at it is in the same patch and is the real change.
      if (op.op === "file") {
        continue;
      }
      const sourcePath = Internal.createValPathOfItem(
        moduleFilePath as unknown as SourcePath,
        // Patch paths are arrays of segments; joining them through the same
        // helper the Studio uses keeps one notion of what a path is.
        op.path.join("."),
      );
      if (sourcePath && !seen.has(sourcePath)) {
        seen.add(sourcePath);
        paths.push(sourcePath);
      }
    }
  }
  return paths;
}
