import { Internal } from "@valbuild/core";

export function refToUrl(
  ref: string,
  filePatchIds: ReadonlyMap<string, string>,
): string {
  const patchId = filePatchIds.get(ref);
  let filePath = ref;
  const remoteRefRes = Internal.remote.splitRemoteRef(ref);
  const isRemote = remoteRefRes.status === "success";
  if (isRemote) {
    filePath = `/${remoteRefRes.filePath}`;
  }
  if (patchId) {
    if (isRemote) {
      return `/api/val/files${filePath}?patch_id=${patchId}&remote=true&ref=${encodeURIComponent(ref)}`;
    }
    return filePath.startsWith("/public")
      ? `/api/val/files${filePath}?patch_id=${patchId}`
      : `${filePath}?patch_id=${patchId}`;
  }
  return ref.startsWith("/public") ? filePath.slice("/public".length) : ref;
}
