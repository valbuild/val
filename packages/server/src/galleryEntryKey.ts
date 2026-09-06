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
  /** Where the bytes are, or would be, in the working tree. */
  localPath: string;
  /** True when the key is a remote ref, so the local file is optional. */
  remote: boolean;
};

export function galleryEntryOf(key: string): GalleryEntryKey {
  const remoteRefRes = Internal.remote.splitRemoteRef(key);
  if (remoteRefRes.status === "success") {
    return { localPath: `/${remoteRefRes.filePath}`, remote: true };
  }
  return { localPath: key, remote: false };
}
