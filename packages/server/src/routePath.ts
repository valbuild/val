import type { ModuleFilePath } from "@valbuild/core";

/**
 * A module path as a route's URL carries it (`GET /modules/~<path>`), read
 * back as the file it names.
 *
 * The client appends the path as it is, and the URL percent-encodes what a
 * URL path cannot hold: the braces of a TanStack optional segment
 * (`_site.{-$locale}.val.ts`), a space, `æøå`. Read raw, every such module
 * was "not found". A path that is not valid percent-encoding (a literal `%`
 * nothing encoded) is taken as it is.
 */
export function moduleFilePathOfRoute(path: string): ModuleFilePath {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Not percent-encoded: the path as sent.
  }
  return decoded as ModuleFilePath;
}
