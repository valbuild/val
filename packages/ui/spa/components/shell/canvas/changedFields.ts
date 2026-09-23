import { Internal, PatchId, SourcePath } from "@valbuild/core";
import { PatchRecord } from "../../../stores/types";

/**
 * Which of `paths` an unpublished patch has touched.
 *
 * A field counts as changed when an op lands ON it, ABOVE it or BELOW it:
 *
 * - on it — the ordinary edit;
 * - above it — a `replace` of the object the field sits in, or an `add` of the
 *   array item it belongs to, changes the field without naming it;
 * - below it — the page reports an image or a rich text as one path, and an
 *   edit to its `alt` or to one of its paragraphs lands deeper than that.
 *
 * An exact-match lookup (`patchesByPath`) answers only the first, which is the
 * right question for "who wrote this op" and the wrong one for "has this field
 * moved since it was published".
 *
 * This is a CANDIDATE list, not the answer. Patches say what was touched, not
 * what is different: an edit typed back to the original is still a patch, and
 * an array insert shifts every index after it. The caller compares each
 * candidate's value with the published one (`useNoOpSourcePaths`) and keeps
 * the ones that differ; this pass exists so that comparison only runs on
 * fields some unpublished patch could have changed.
 *
 * Published patches do not count. In `http` mode they stay in the chain, and a
 * field whose change has shipped is not something left to review.
 */
export function changedPathsAmong(
  paths: readonly SourcePath[],
  records: readonly PatchRecord[],
  publishedPatchIds: ReadonlySet<PatchId>,
): Set<SourcePath> {
  return changedFieldsAmong(indexFields(paths), records, publishedPatchIds);
}

/**
 * The fields of a page, parsed once.
 *
 * Separate from the match because the two change at different rates: the
 * fields when the page reports a new set, the chain on every edit. Parsing a
 * source path is most of the cost of a match, so it is not paid per edit.
 */
export type IndexedFields = {
  fields: readonly {
    path: SourcePath;
    /** The key of each prefix of the path, the module alone first. */
    keys: readonly string[];
  }[];
  moduleFilePaths: ReadonlySet<string>;
};

export function indexFields(paths: readonly SourcePath[]): IndexedFields {
  const moduleFilePaths = new Set<string>();
  const fields = paths.map((path) => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    moduleFilePaths.add(moduleFilePath);
    const keys: string[] = [moduleFilePath];
    let key: string = moduleFilePath;
    for (const segment of modulePath
      ? Internal.splitModulePath(modulePath)
      : []) {
      key += SEPARATOR + segment;
      keys.push(key);
    }
    return { path, keys };
  });
  return { fields, moduleFilePaths };
}

export function changedFieldsAmong(
  { fields, moduleFilePaths }: IndexedFields,
  records: readonly PatchRecord[],
  publishedPatchIds: ReadonlySet<PatchId>,
): Set<SourcePath> {
  /*
   * Two sets of keys rather than a comparison of every path with every op,
   * because this runs on every movement of the chain — every edit — and the
   * pairwise version was 33ms at 300 fields and 1000 patches.
   *
   * `opPaths` holds each op's own path; `opPathsAndAbove` holds that path and
   * every prefix of it. A field is changed when its own key is in
   * `opPathsAndAbove` (an op on it or below it) or one of its prefixes is in
   * `opPaths` (an op above it). Linear in ops and in fields, times depth.
   */
  const opPaths = new Set<string>();
  const opPathsAndAbove = new Set<string>();
  const touch = (moduleFilePath: string, opPath: readonly string[]) => {
    let key = moduleFilePath;
    opPathsAndAbove.add(key);
    for (const segment of opPath) {
      key += SEPARATOR + segment;
      opPathsAndAbove.add(key);
    }
    opPaths.add(key);
  };
  for (const record of records) {
    // The chain holds the whole site's edits; only this page's modules matter.
    if (!moduleFilePaths.has(record.moduleFilePath)) continue;
    if (record.appliedAt || publishedPatchIds.has(record.patchId)) continue;
    for (const op of record.patch) {
      // A file op rides beside the `replace` that names the field, and its
      // `path` is the same one, so it adds nothing but a duplicate.
      if (op.op === "file" || op.op === "test") continue;
      if (op.op === "replace") {
        touch(record.moduleFilePath, op.path);
        continue;
      }
      touch(record.moduleFilePath, structuralTarget(op.path));
      // A move changes where it came from as much as where it went.
      if (op.op === "move") {
        touch(record.moduleFilePath, structuralTarget(op.from));
      }
    }
  }

  const changed = new Set<SourcePath>();
  if (opPaths.size === 0) return changed;
  for (const { path, keys } of fields) {
    // Most fields on a page share a module with no patches at all.
    if (!opPathsAndAbove.has(keys[0])) continue;
    if (
      opPathsAndAbove.has(keys[keys.length - 1]) ||
      keys.some((key) => opPaths.has(key))
    ) {
      changed.add(path);
    }
  }
  return changed;
}

/**
 * Where an `add`, `remove`, `move` or `copy` really lands.
 *
 * Into an array, it lands on the whole array: every item after the index
 * shifts, so every op in the chain that named an item of it by index before
 * this one now names a different item. Widening to the array is the only
 * answer that does not depend on replaying the chain — the same rule
 * `PatchSets` follows — and the comparison with the published value that
 * follows this match is what narrows it back down to the items that differ.
 *
 * A record's keys are not positions, so an op on one lands where it says. A
 * numeric record key is widened too; that over-reports, and the comparison
 * narrows it the same way.
 */
function structuralTarget(path: readonly string[]): readonly string[] {
  const last = path[path.length - 1];
  if (last === "-" || (last !== undefined && Number.isInteger(Number(last)))) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Joins segments into a key. A NUL cannot appear in a module file path, and a
 * segment containing one would have to be a record key nobody could type.
 */
const SEPARATOR = "\u0000";
