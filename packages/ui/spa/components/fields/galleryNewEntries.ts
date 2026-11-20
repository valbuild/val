import type { Patch } from "@valbuild/core/patch";

/**
 * The entries of a gallery that were ADDED since the last publish.
 *
 * Not simply "not in the published record": a rename is a `move` of the
 * entry, so a published file renamed in this session is under a key the
 * published record does not have either, and calling it new would put an old
 * photo at the top of the grid with a badge it did not earn. So a key reached
 * by moving a published entry -- or by moving one that was itself reached
 * that way -- is not new, however many renames it took.
 *
 * `published` is null while the published record is still loading, and then
 * nothing is new: a grid that briefly reorders every entry to the top and
 * back is worse than one that shows its badges a moment late.
 */
export function galleryNewEntries({
  current,
  published,
  patches,
  patchPath,
}: {
  /** The keys the gallery has now, pending edits included. */
  current: readonly string[];
  published: ReadonlySet<string> | null;
  /** The module's pending patches, oldest first. */
  patches: readonly Patch[];
  /** Where the gallery's record is in its module. */
  patchPath: readonly string[];
}): Set<string> {
  const fresh = new Set<string>();
  if (published === null) return fresh;
  const renamed = new Set<string>();
  for (const patch of patches) {
    for (const op of patch) {
      if (op.op !== "move") continue;
      const from = entryKey(op.from, patchPath);
      const to = entryKey(op.path, patchPath);
      if (from === null || to === null) continue;
      if (published.has(from) || renamed.has(from)) renamed.add(to);
    }
  }
  for (const key of current) {
    if (!published.has(key) && !renamed.has(key)) fresh.add(key);
  }
  return fresh;
}

/** The record key `path` names, if it names an entry of the record itself. */
function entryKey(
  path: readonly string[],
  patchPath: readonly string[],
): string | null {
  if (path.length !== patchPath.length + 1) return null;
  if (!patchPath.every((segment, i) => path[i] === segment)) return null;
  return path[patchPath.length];
}
