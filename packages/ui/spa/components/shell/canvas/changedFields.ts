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
 * Published patches do not count. In `http` mode they stay in the chain, and a
 * field whose change has shipped is not something left to review.
 */
export function changedPathsAmong(
  paths: readonly SourcePath[],
  records: readonly PatchRecord[],
  publishedPatchIds: ReadonlySet<PatchId>,
): Set<SourcePath> {
  const touchedByModule = new Map<string, string[][]>();
  for (const record of records) {
    if (record.appliedAt || publishedPatchIds.has(record.patchId)) continue;
    let touched = touchedByModule.get(record.moduleFilePath);
    if (touched === undefined) {
      touched = [];
      touchedByModule.set(record.moduleFilePath, touched);
    }
    for (const op of record.patch) {
      // A file op rides beside the `replace` that names the field, and its
      // `path` is the same one, so it adds nothing but a duplicate.
      if (op.op === "file" || op.op === "test") continue;
      touched.push(op.path);
      // A move changes where it came from as much as where it went.
      if (op.op === "move") touched.push(op.from);
    }
  }

  const changed = new Set<SourcePath>();
  if (touchedByModule.size === 0) return changed;
  for (const path of paths) {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const touched = touchedByModule.get(moduleFilePath);
    if (touched === undefined) continue;
    const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
    if (touched.some((opPath) => overlaps(segments, opPath))) {
      changed.add(path);
    }
  }
  return changed;
}

/** Is one of the two a prefix of the other (or are they the same path)? */
function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
