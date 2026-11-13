/**
 * Which paths a request may name, where the path ends up joined onto a
 * directory on disk or handed to the content service as a file to read.
 *
 * A media file's path arrives from the client three ways: in the URL of
 * `/files`, in the body of `/upload/patches`, and as the `filePath` of a
 * patch's `file` op. None of them was checked. `/files` answered any path
 * under the project root (`.env`, the source), and an upload's `filePath` was
 * joined onto the staging directory as it was, so `../../../../src/x` wrote
 * outside it. In fs mode there is no session to stop either.
 *
 * So the rule is on the PATH, and it is the one media already follows: a local
 * file lives under `/public` (`MediaDir` in core), and a remote one is named by
 * its ref, which is a URL and never starts with a slash.
 */

/** No segment that climbs or stays put, and nothing a path API reads as a separator. */
function hasOnlyPlainSegments(filePath: string): boolean {
  if (filePath.includes("\\") || filePath.includes("\0")) {
    return false;
  }
  return filePath
    .split("/")
    .every((segment) => segment !== ".." && segment !== ".");
}

/**
 * A local media path: `/public/...`, with nothing in it that leaves `/public`.
 *
 * What `/files` serves when it is asked for a published file, and where a
 * publish may write an uploaded one.
 */
export function isPublicFilePath(filePath: string): boolean {
  return filePath.startsWith("/public/") && hasOnlyPlainSegments(filePath);
}

/**
 * What a `file` op or an upload may name: a local media path, or a remote ref.
 *
 * A remote ref is stored in the patch directory under its own text, so it is
 * held to the same segments rule. It cannot start with a slash, which is what
 * keeps `/etc/x` and `/src/x` from passing as one.
 */
export function isMediaFilePath(filePath: string): boolean {
  if (filePath.startsWith("/")) {
    return isPublicFilePath(filePath);
  }
  return filePath.length > 0 && hasOnlyPlainSegments(filePath);
}

/**
 * A patch id as a directory name: one segment, and not a climbing one.
 *
 * Patch ids are UUIDs here and whatever the content service mints there, so
 * this does not say what an id IS, only what it cannot be while it is used as
 * the name of a directory under `.val/patches`.
 */
export function isSafePatchId(patchId: string): boolean {
  return (
    patchId.length > 0 &&
    patchId !== "." &&
    patchId !== ".." &&
    !/[/\\\0]/.test(patchId)
  );
}

export const MEDIA_FILE_PATH_ACCEPTS =
  "A file's path must be under /public (/public/val/photo.jpg) or be a remote file's ref, with no '..' in it.";
