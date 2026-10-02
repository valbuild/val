import { Internal } from "@valbuild/core";

/**
 * Does a referrer's `path` name the gallery entry keyed `key`?
 *
 * Usually they are the same string. They are not for an upload made through an
 * `s.image(remoteGallery)` field, which stores the remote ref in the field and
 * keys the entry by the local path inside it — `fillFromGallery` accepts that
 * form, so every scan has to as well, or a rename or delete of such an entry
 * walks past the fields that use it.
 */
export function pathNamesGalleryKey(path: string, key: string): boolean {
  if (path === key) {
    return true;
  }
  const split = Internal.remote.splitRemoteRef(path);
  return (
    split.status === "success" &&
    (key === `/${split.filePath}` || key === split.filePath)
  );
}
