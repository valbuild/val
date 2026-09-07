/**
 * The reference stored for a file whose bytes live behind an external adapter.
 *
 * Deliberately the same shape of idea as a remote ref (`remote/splitRemoteRef`):
 * a URL-ish string that **ends with the file's virtual path**, so the file's
 * logical identity survives wherever its bytes happen to be.
 *
 *     /api/val/external/documents/f/{fileHash}/p/public/val/documents/report_a1b2c.pdf
 *      \__________________________/ \________/   \_______________________________/
 *              route + label          content        the path a LOCAL file
 *                                     address        would have had
 *
 * Three things follow from that shape, and each is load-bearing:
 *
 * - **`media.ts` needs no change.** `isRemote` is `!path.startsWith("/public")`,
 *   and this does not, so `Internal.mediaUrl` returns the ref as-is and Val's
 *   route serves it. The media rule that has been got wrong repeatedly is left
 *   exactly alone.
 * - **Moving between storage modes is mechanical.** External → local reads the
 *   `public/…` suffix back out, fetches the bytes and writes them there; local →
 *   external uploads the file already at that path. Nothing is renamed.
 * - **The filename is Val's, not the adapter's**, produced by the same
 *   `createFilename` a local or remote file uses — so the same bytes get the
 *   same name under all three storage modes.
 */

const RegEx = /^\/api\/val\/external\/([^/]+)\/f\/([^/]+)\/p\/(.+)$/;

export type ExternalFileRefParts = {
  /** The `.external(label)` of the record the file belongs to. */
  label: string;
  /** SHA-256 of the bytes. Content-addressed, so a retried publish re-uses. */
  fileHash: string;
  /** The virtual path, WITHOUT a leading slash: `public/val/...`. */
  filePath: `public/${string}`;
};

export function createExternalFileRef({
  label,
  fileHash,
  filePath,
}: {
  label: string;
  fileHash: string;
  /** Accepts the path as it is written in a module: `/public/val/...`. */
  filePath: string;
}): string {
  const withoutLeadingSlash = filePath.startsWith("/")
    ? filePath.slice(1)
    : filePath;
  if (!withoutLeadingSlash.startsWith("public/")) {
    throw new Error(
      `External file paths must be under '/public', got: '${filePath}'`,
    );
  }
  return `/api/val/external/${label}/f/${fileHash}/p/${withoutLeadingSlash}`;
}

export function splitExternalFileRef(
  ref: string,
):
  | ({ status: "success" } & ExternalFileRefParts)
  | { status: "error"; error: string } {
  const match = ref.match(RegEx);
  if (!match) {
    return { status: "error", error: "Not an external file ref: " + ref };
  }
  const filePath = match[3];
  if (!filePath.startsWith("public/")) {
    return { status: "error", error: "Invalid external file ref: " + ref };
  }
  // Traversal check, for the same reason `splitRemoteRef` has one: this path is
  // used to read and write files.
  if (
    filePath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return { status: "error", error: "Invalid external file ref: " + ref };
  }
  return {
    status: "success",
    label: match[1],
    fileHash: match[2],
    filePath: filePath as `public/${string}`,
  };
}

export function isExternalFileRef(ref: string): boolean {
  return RegEx.test(ref);
}
