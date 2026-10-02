import { Internal } from "@valbuild/core";

/**
 * The gallery entry a referrer's `path` names, given the gallery's keys.
 *
 * Usually the path IS the key. It is not for an upload made through an
 * `s.image(remoteGallery)` field, which stores the remote ref in the field and
 * keys the entry by the local path inside it — so a path that is not a key
 * falls back to that embedded path, the same order `fillFromGallery` resolves
 * it in.
 *
 * The key set is required, not optional, because the fallback is ambiguous
 * without it: a gallery can hold BOTH shapes, a full-ref key and the local
 * path inside that same ref. The field then uses the full-ref entry, and
 * matching the local one as well would let a rename or delete of the local
 * entry rewrite or block a field that does not use it.
 *
 * A path that names no key at all is returned as it is — it then matches
 * exactly the entry of that name, and nothing else.
 */
export function galleryKeyOf(
  path: string,
  galleryKeys: ReadonlySet<string>,
): string {
  if (galleryKeys.has(path)) {
    return path;
  }
  const split = Internal.remote.splitRemoteRef(path);
  if (split.status === "success") {
    for (const embedded of [`/${split.filePath}`, split.filePath]) {
      if (galleryKeys.has(embedded)) {
        return embedded;
      }
    }
  }
  return path;
}
