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
