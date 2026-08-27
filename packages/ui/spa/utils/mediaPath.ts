/**
 * The path a file is actually served at.
 *
 * A file's ref is where it lives in the repository — `/public/val/logo.png` —
 * and the URL it is served at is that path minus `/public`, because `/public`
 * is the web root. Showing the ref means every path in the Studio disagrees with
 * every path in the site's own markup, so "which image is this" takes a mental
 * step it should not.
 *
 * This is for LABELS — a gallery's directory, a file's name in a list. For the
 * URL of a file's bytes use `Internal.mediaUrl`, which is the authority on the
 * rule and also knows about drafts. This one deliberately does not: a directory
 * has no `patch_id`.
 *
 * `Internal.mediaUrl` carries the same `/public` literal and the same TODO about
 * making it configurable. When that becomes configurable, this is the other
 * place to change.
 *
 * Anything not under `/public` is returned unchanged: a remote ref is a whole
 * URL, and a ref outside the public folder is served from wherever it says.
 */
export function servedPath(ref: string): string {
  return ref.startsWith(PUBLIC_PREFIX) ? ref.slice(PUBLIC_PREFIX.length) : ref;
}

const PUBLIC_PREFIX = "/public";
