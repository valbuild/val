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
      /*
       * The canonical patch-path-to-source-path conversion, not a hand-rolled
       * join.
       *
       * `createValPathOfItem` JSON-quotes the ONE key it is handed, so joining
       * the segments with "." first produced `?p="teddy.name"` — a single
       * segment with a dot in its name — rather than `?p="teddy"."name"`. Only
       * top-level fields came out right, a record key containing a dot was
       * split in the other direction, and an op at the module root became
       * `?p=""`.
       *
       * `patchPathToModulePath` is what the rest of the Studio produces and
       * parses, integer segments left unquoted (`"items".2."label"`).
       */
      const sourcePath: SourcePath =
        op.path.length === 0
          ? (moduleFilePath as unknown as SourcePath)
          : Internal.joinModuleFilePathAndModulePath(
              moduleFilePath,
              Internal.patchPathToModulePath(op.path),
            );
      if (!seen.has(sourcePath)) {
        seen.add(sourcePath);
        paths.push(sourcePath);
      }
    }
  }
  return paths;
}
