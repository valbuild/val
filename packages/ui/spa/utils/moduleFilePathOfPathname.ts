/**
 * The module file path a Studio URL names, from `location.pathname` after the
 * content route (`/val/~`).
 *
 * `location.pathname` is percent-encoded, and a browser encodes more than one
 * might expect: `{` and `}` always, so a TanStack route with an optional
 * segment, `/src/routes/_site.{-$locale}.index.val.ts`, comes back as
 * `/src/routes/_site.%7B-$locale%7D.index.val.ts`. Used as it is, that names no
 * module, and the Studio says the page "can no longer be found" for every page
 * of a site with a language in its URLs -- including the one it just linked to,
 * because the Studio writes the path raw and the browser encodes it on the way
 * into the address bar.
 *
 * `decodeURI`, not `decodeURIComponent`: an encoded `/` (`%2F`) is not a path
 * separator and must stay encoded. A malformed escape (`%E0%A4%A`) is left as
 * it is rather than throwing on a URL someone typed.
 */
export function moduleFilePathOfPathname(encodedPath: string): string {
  try {
    return decodeURI(encodedPath);
  } catch {
    return encodedPath;
  }
}
