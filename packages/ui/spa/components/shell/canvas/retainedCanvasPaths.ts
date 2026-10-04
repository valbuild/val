import type { SourcePath } from "@valbuild/core";

/**
 * What the "On this page" column lists: what the page reports, plus the fields
 * the editor was working on that the page has stopped showing.
 *
 * The page only reports what it renders, and an emptied field often renders
 * nothing — an empty rich text has no elements, a `null` image has no `<img>`.
 * Listing exactly what the page reports therefore removed the field being
 * edited the moment it was emptied, focus and all. The fields in `keep` stay
 * instead.
 *
 * Each kept path goes back where it was, after the nearest path before it in
 * `previous` that is still listed — so a field emptied in the middle of a page
 * stays in the middle rather than dropping to the end. A path is never listed
 * twice, and nothing outside `previous` and `reported` is ever added: `keep` can
 * hold paths that were never in the column, and they are not invented here.
 *
 * Returns `previous` itself when the answer is unchanged, so a re-render with
 * the same input does not hand the column a new array.
 */
export function mergeRetainedPaths(
  /** What the column listed last time. */
  previous: readonly SourcePath[],
  /** What the page reports now, in page order. */
  reported: readonly SourcePath[],
  /** Whether a path the page no longer reports should stay listed. */
  keep: (path: SourcePath) => boolean,
): readonly SourcePath[] {
  const listed = new Set(reported);
  const merged = [...reported];
  /** Where the next kept path goes: just after the last one placed. */
  let insertAt = 0;
  for (const path of previous) {
    if (listed.has(path)) {
      insertAt = merged.indexOf(path) + 1;
      continue;
    }
    if (!keep(path)) continue;
    merged.splice(insertAt, 0, path);
    listed.add(path);
    insertAt += 1;
  }
  return sameOrder(previous, merged) ? previous : merged;
}

function sameOrder(
  a: readonly SourcePath[],
  b: readonly SourcePath[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
