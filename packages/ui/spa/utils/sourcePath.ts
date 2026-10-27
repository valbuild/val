import { Internal, type SourcePath } from "@valbuild/core";
/**
 * Source path helpers, two of them now living in `@valbuild/shared/internal`.
 *
 * `sourcePathOfChild` and `concatModulePath` moved there because
 * `traverseSchemaSource` needs them and that moved to shared with the search
 * index. Sixteen files in the Studio import them from here, and none of them
 * care where the implementation sits — so the path stays and each function has
 * one home.
 *
 * `isPathWithin` stays. It is a question about the Studio's own navigation and
 * held patches, and nothing outside the Studio asks it.
 */
export { sourcePathOfChild, concatModulePath } from "@valbuild/shared/internal";

/**
 * Whether `path` is `id` or something inside it.
 *
 * A prefix test alone is not enough: `/content/authors.val.ts` is a textual
 * prefix of `/content/authorsExtra.val.ts`, and a page id ending in a quoted
 * route key is a prefix of a longer key that merely starts the same way
 * (`?p="/blog"` and `?p="/blogs"`). The next character therefore has to be one
 * that actually starts a new segment.
 *
 * Two callers need this rule and neither can own it: the shell asks which row a
 * route belongs to, and `useNoOpSourcePaths` asks whether a held patch covers a
 * path. A second copy of the boundary check is a second chance to get it wrong.
 */
export function isPathWithin(path: string, id: string): boolean {
  if (path === id) return true;
  if (!path.startsWith(id)) return false;
  const next = path[id.length];
  return next === "?" || next === ".";
}

/**
 * Whether a string is shaped like a source path: a module file
 * (`/…/name.val.ts`), optionally followed by `?p=` and a module path.
 *
 * A shape check, not a lookup: whether the module exists is the caller's
 * question. For strings from outside the Studio's own types -- a URL, the
 * demo's tour, which a site writes.
 */
export function isSourcePath(value: string): value is SourcePath {
  const sep = value.indexOf(Internal.ModuleFilePathSep);
  const moduleFilePath = sep === -1 ? value : value.slice(0, sep);
  if (!moduleFilePath.startsWith("/") || !moduleFilePath.includes(".val.")) {
    return false;
  }
  return sep === -1 || value.length > sep + Internal.ModuleFilePathSep.length;
}
