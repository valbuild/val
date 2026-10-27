import { Internal } from "@valbuild/core";
import { useFilePatchIds } from "../components/ValFieldProvider";

/**
 * Anything the studio holds a file as.
 *
 * A media value is `{ path, ... }`, and a GALLERY hands back the bare path
 * instead — the record's key IS the path, so there is no object around it. Both
 * are accepted here because both turn up at call sites, and making each one
 * remember which it has is how half of them ended up not resolving at all.
 */
export type MediaLike = { readonly path: string } | string | null | undefined;

/**
 * Where these bytes are served from, INCLUDING while they are still a draft.
 *
 * `Internal.mediaUrl` is the one implementation of the URL rule, and it needs
 * one thing the value does not carry: the id of the patch holding the bytes of
 * a file that has been uploaded but not published. That lives in the patch
 * store, keyed by path, so a caller with only the media value produces a URL
 * for the PUBLISHED file — which for a fresh upload is a 404, and the image
 * stays blank until the editor saves. Six call sites had a copy of the lookup
 * and five presentational ones had none.
 *
 * Use {@link useMediaUrl} in a component. Use this where the map is already in
 * hand — a data layer that resolved a whole collection, a pure function under
 * test.
 */
export function mediaUrlOf(
  source: MediaLike,
  filePatchIds: ReadonlyMap<string, string>,
): string | null {
  if (source === null || source === undefined) {
    return null;
  }
  const path = typeof source === "string" ? source : source.path;
  if (!path) {
    return null;
  }
  const patchId = filePatchIds.get(path);
  return Internal.mediaUrl({
    path,
    ...(patchId ? { patch_id: patchId } : {}),
  });
}

/**
 * The hook form, and the one a component should reach for.
 *
 * Safe outside a Val system — `useFilePatchIds` answers with an empty map
 * there — so a story or a test renders the published URL rather than throwing.
 */
export function useMediaUrl(source: MediaLike): string | null {
  const filePatchIds = useFilePatchIds();
  return mediaUrlOf(source, filePatchIds);
}
