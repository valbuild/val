import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";

/**
 * The one way to build a child's source path.
 *
 * There were five hand-rolled versions of this, three of them subtly different
 * and two of them wrong, and the wrong ones were wrong in a way that hid: a
 * module path segment has to be JSON-quoted if it is a string and bare if it is
 * an array index, and both broken copies appended the raw key at the module
 * root. An unquoted key parses fine as long as it contains no `.` — so every
 * object field and every ordinary record key still resolved, and only a key with
 * a dot in it broke. That is exactly what a media gallery is keyed by, so
 * clicking a file in the Media panel navigated to
 * `?p=/public/val/red-8x8_bfbd0.png`, which `splitModulePath` reads as the two
 * segments `/public/val/red-8x8_bfbd0` and `png`, and the studio said the module
 * was not found.
 *
 * So: one function, and never a template string. `Internal.createValPathOfItem`
 * is the rule itself — `JSON.stringify` quotes a string and leaves a number
 * bare, which is precisely the module-path grammar — and everything here defers
 * to it rather than restating it.
 */
export function sourcePathOfChild(
  parent: SourcePath | ModuleFilePath,
  key: string | number,
): SourcePath {
  /**
   * A parent that is already `…?p=` gets the key with no separator.
   *
   * The search index walks from `moduleFilePath + "?p="` rather than from the
   * module file path, so that every path it produces has a module path — and
   * `createValPathOfItem` would see the separator and join with a `.`, giving
   * `?p=."title"`.
   */
  if (parent.endsWith(Internal.ModuleFilePathSep)) {
    return `${parent}${JSON.stringify(key)}` as SourcePath;
  }
  const path = Internal.createValPathOfItem(parent, key);
  if (path === undefined) {
    // Only when the parent is empty, which callers cannot produce: every walk
    // starts from a module file path. Thrown rather than skipped so a future
    // change that breaks that assumption is loud.
    throw new Error(
      `Could not build a source path for '${key}' under ${parent}`,
    );
  }
  return path;
}

/**
 * The same thing, for callers holding the module file path and module path apart.
 *
 * `ModulePath` is empty at the module root, which is the case both broken copies
 * got wrong: there is no separator in the path yet, so the key is the first
 * segment and still has to be quoted.
 */
export function concatModulePath(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  key: string | number,
): SourcePath {
  return sourcePathOfChild(
    modulePath
      ? Internal.joinModuleFilePathAndModulePath(moduleFilePath, modulePath)
      : moduleFilePath,
    key,
  );
}
