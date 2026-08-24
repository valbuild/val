import {
  ModuleFilePathSep,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";

/**
 * Either granularity a change can be announced at.
 *
 * A patch names the exact source path it touched; intake and a base-source
 * replacement change everything in a module and can only name the module. Both
 * are compared the same way — `isSelfOrUnder` already treats the `?p=` separator
 * as a boundary, which is what makes a bare module file path match everything
 * inside it — so widening the type is the whole of the difference.
 */
export type ChangedPath = SourcePath | ModuleFilePath;

/**
 * Is `path` the same as `other`, or nested under it?
 *
 * A raw `startsWith` is wrong here: `?p="ab"` starts with `?p="a"` as a string
 * but is a sibling, not a child. Requiring a boundary makes the test
 * structural. `.` separates module-path segments, and `ModuleFilePathSep`
 * (`?p=`) separates the module file path from the module path — so a listener
 * registered on the bare module file path is matched by anything inside it.
 */
function isSelfOrUnder(path: ChangedPath, other: ChangedPath): boolean {
  return (
    path === other ||
    path.startsWith(other + ".") ||
    path.startsWith(other + ModuleFilePathSep)
  );
}

/**
 * Does a change at any of `changed` affect a reader registered at `path`?
 *
 * Both directions matter, and for different reasons:
 * - `changed` is an ANCESTOR of `path` — a patch replaced the whole object my
 *   field lives in, so my value may have changed underneath me.
 * - `changed` is UNDER `path` — a patch edited one field inside the object I am
 *   showing, so my rendered subtree is out of date.
 */
export function touchesPath(
  changed: readonly ChangedPath[],
  path: SourcePath,
): boolean {
  for (const c of changed) {
    if (isSelfOrUnder(path, c) || isSelfOrUnder(c, path)) {
      return true;
    }
  }
  return false;
}
