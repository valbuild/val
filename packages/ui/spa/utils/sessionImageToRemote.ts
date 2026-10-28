import {
  Internal,
  type PatchId,
  type SerializedFileSchema,
  type SerializedImageSchema,
} from "@valbuild/core";
import { fetchMediaBytes } from "./fetchMediaBytes";
import { remoteRefOf, type RemoteUploadSettings } from "./uploadLocalMedia";

export type SessionImageAsRemote =
  | { status: "ok"; ref: string; dataUrl: string }
  | { status: "error"; message: string };

/**
 * An image the assistant was given, made ready for a REMOTE field or gallery.
 *
 * The content service attaches a session image to a patch at the path it is
 * given, and that is all it does: it does not hash the bytes, so it cannot
 * name the remote ref a remote schema stores. Asked to attach it as remote
 * under a `/public` path anyway, it did -- and the entry named a path the
 * Studio reads as LOCAL, looked up a local file that was never there, and
 * showed a broken image; published, the bytes went to remote storage and the
 * content still named the repository.
 *
 * So the bytes are attached as a local file first (`localPath`, in `patchId`),
 * read back from where a draft is served, and handed on with the ref they
 * hash to -- by `remoteRefOf`, the rule every other Studio upload to remote
 * storage uses. The caller writes them in a `file` op as a data URL, so they
 * go up the way a picked file does.
 */
export async function sessionImageAsRemote(args: {
  /** Where the session image was attached: `/public/val/images/a.png`. */
  localPath: string;
  patchId: PatchId;
  schema: SerializedImageSchema | SerializedFileSchema;
  /** As it will be stored; its width, height and mime type are hashed. */
  metadata: { mimeType?: string } & Record<string, unknown>;
  remote: RemoteUploadSettings;
}): Promise<SessionImageAsRemote> {
  const { localPath, patchId, schema, metadata, remote } = args;
  const filename = localPath.slice(localPath.lastIndexOf("/") + 1);
  const fetched = await fetchMediaBytes(
    Internal.mediaUrl({ path: localPath, patch_id: patchId }),
    filename,
    metadata.mimeType,
  );
  if (fetched.status === "error") {
    return { status: "error", message: fetched.message };
  }
  const made = remoteRefOf({
    localPath,
    schema,
    metadata,
    sha256: fetched.bytes.sha256,
    remote,
  });
  if (made.status === "error") {
    return made;
  }
  return { status: "ok", ref: made.ref, dataUrl: fetched.bytes.dataUrl };
}
