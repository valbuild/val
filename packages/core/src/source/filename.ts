/**
 * How Val names a media file: a cleaned-up base name, the first five hex of the
 * content's SHA-256, and the extension — `hero-mountains_a1b2c.jpg`.
 *
 * Two producers need this and must agree: an upload (`createFilename`, which
 * has the bytes) and a rename (`createRenamedFilename`, which keeps the bytes
 * and only changes what is in front of the hash). If they disagreed, renaming a
 * file to the name it was uploaded with would give it a different name.
 */

/** The `_a1b2c` a Val filename ends in, before the extension. */
export const FILENAME_HASH_SUFFIX_LENGTH = 5;

/**
 * The part of a filename a person chose, made safe for a URL path.
 *
 * Lower case, with everything `encodeURIComponent` would escape dropped rather
 * than escaped — a path segment that needs decoding is a path segment that gets
 * decoded twice somewhere. Can return the empty string, for a name made only of
 * such characters; a caller that needs a name has to refuse that.
 */
export function sanitizeFilenameBase(base: string): string {
  return encodeURIComponent(base)
    .replace(/%[0-9A-Fa-f]{2}/g, "")
    .toLowerCase();
}

/**
 * `base` with a trailing `_<hashPrefix>` removed, so a name that already carries
 * the hash does not get it twice (`photo_a1b2c` + `a1b2c` → `photo_a1b2c`, not
 * `photo_a1b2c_a1b2c`).
 */
export function stripHashSuffix(base: string, hashPrefix: string): string {
  const pos = base.lastIndexOf("_");
  if (pos !== -1 && base.slice(pos + 1) === hashPrefix) {
    return base.slice(0, pos);
  }
  return base;
}

/**
 * The name a file gets when it is renamed to `newBase`.
 *
 * The hash and the extension are not the editor's to change: the hash keeps two
 * different files from ever sharing a name, and the extension is part of a
 * remote file's validation hash and of how its bytes are served. So they are
 * passed in, and only the base comes from the person.
 *
 * Returns `null` when nothing usable is left of `newBase` after cleaning it.
 */
export function createRenamedFilename(
  newBase: string,
  sha256: string,
  ext: string,
): string | null {
  const hashPrefix = sha256.slice(0, FILENAME_HASH_SUFFIX_LENGTH);
  const cleaned = sanitizeFilenameBase(
    stripHashSuffix(newBase.trim(), hashPrefix),
  );
  if (cleaned === "") {
    return null;
  }
  return ext === ""
    ? `${cleaned}_${hashPrefix}`
    : `${cleaned}_${hashPrefix}.${ext}`;
}
