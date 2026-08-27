import { Internal } from "@valbuild/core";

/**
 * The URL a gallery entry's bytes are served from.
 *
 * A gallery is keyed by file path, so this takes a bare path where a field would
 * have a whole media object. `filePatchIds` is what says whether the bytes are
 * committed yet; `Internal.mediaUrl` is the rule itself, and the only copy of it.
 */
export function refToUrl(
  ref: string,
  filePatchIds: ReadonlyMap<string, string>,
): string {
  const patchId = filePatchIds.get(ref);
  return Internal.mediaUrl({
    path: ref,
    ...(patchId ? { patch_id: patchId } : {}),
  });
}
