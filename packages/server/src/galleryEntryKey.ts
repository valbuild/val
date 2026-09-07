import { Internal } from "@valbuild/core";

/**
 * A gallery entry's key, read as what it actually is.
 *
 * A gallery is a record keyed by its entries' file paths. A REMOTE gallery keys
 * an uploaded entry by the remote URL instead — which encodes that same path —
 * so every entry has a local path, and the interesting question is whether the
 * bytes are expected to be at it.
 *
 * **They are not, for a remote entry added the ordinary way.** `saveOrUploadFiles`
 * uploads the remote descriptors to the content host and copies only the local
 * ones into the working tree, so an image added through the Studio (or over MCP)
 * and published has no file in the repo, by design — putting one there is what
 * remote storage exists to avoid. A remote entry CAN have one, because
 * `val validate --fix` promotes a local file to a remote ref and leaves the file
 * where it was; so "remote" means "do not require it", never "there is not one".
 *
 * One copy, in its own file, because this used to be two: a `remoteKeyToLocalPath`
 * in `fixHandlers` and a `galleryKeyToLocalPath` in `createFixPatch`, each
 * normalising the key correctly and each then treating the result as a file that
 * must exist. That agreement is what made a published remote image report as
 * missing from both sides at once.
 */
export type GalleryEntryKey = {
  /**
   * Where the bytes are, or would be, in the working tree.
   *
   * The key itself for a remote key that does not parse — there is no such
   * place for one, and nothing reads this for a remote entry except the
   * untracked-files comparison, where a URL matches no file.
   */
  localPath: string;
  /** True when the key is a URL, so a local file is not required. */
  remote: boolean;
};

/** A key that names somewhere else, whether or not it is a ref we can read. */
function isRemoteUrl(key: string): boolean {
  return key.startsWith("https://") || key.startsWith("http://");
}

export function galleryEntryOf(key: string): GalleryEntryKey {
  const remoteRefRes = Internal.remote.splitRemoteRef(key);
  if (remoteRefRes.status === "success") {
    return { localPath: `/${remoteRefRes.filePath}`, remote: true };
  }
  if (isRemoteUrl(key)) {
    // A URL that is not a ref this version can read: truncated by a hand edit,
    // a path outside `public/`, a `..` segment — or written by a core version
    // whose format `splitRemoteRef` rejects.
    //
    // Still not a path in the working tree, so the on-disk checks must not run
    // against it. They would find nothing at `<projectRoot>/https://…`, report
    // the entry as missing, and `--fix` would DELETE it — the exact failure
    // this module exists to prevent, arriving at the one moment the key is the
    // only remaining record of where the bytes went.
    //
    // Nothing is being hidden by this: a malformed key is already reported, by
    // the record schema's own "Invalid remote URL format". That is an error for
    // a person to look at, not a file for `--fix` to go missing.
    return { localPath: key, remote: true };
  }
  return { localPath: key, remote: false };
}
