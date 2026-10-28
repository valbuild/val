import {
  Internal,
  type PatchId,
  type SerializedFileSchema,
  type SerializedImageSchema,
} from "@valbuild/core";
import { fetchMediaBytes } from "./fetchMediaBytes";
import { remoteRefOf, type RemoteUploadSettings } from "./uploadLocalMedia";

export type ReadBackSessionImage =
  | { status: "ok"; file: { filePath: string; dataUrl: string } }
  | { status: "error"; message: string };

/**
 * An image the assistant was given, read back so it can go to REMOTE storage.
 *
 * The content service attaches a session image to a patch at the path it is
 * given, and that is all it does: it does not hash the bytes, so it cannot
 * name the remote ref a remote schema stores. Asked to attach it as remote
 * under a `/public` path anyway, it did -- and the value named a path the
 * Studio reads as LOCAL, looked up a local file that was never there, and
 * showed a broken image; published, the bytes went to remote storage and the
 * content still named the repository.
 *
 * So the bytes are attached as a local file first (`localPath`, in `patchId`),
 * read back from where a draft is served, and handed on with the path they
 * are stored under: with a `remote` target, the ref they hash to -- by
 * `remoteRefOf`, the rule every other Studio upload to remote storage uses --
 * and without one, `localPath` itself. The caller writes them in a `file` op
 * as a data URL, so they go up the way a picked file does.
 */
export async function readBackSessionImage(args: {
  /** Where the session image was attached: `/public/val/images/a.png`. */
  localPath: string;
  patchId: PatchId;
  /** As it will be stored; its width, height and mime type are hashed. */
  metadata: { mimeType?: string } & Record<string, unknown>;
  /** Where it goes: remote storage, named for `schema`, or `null` to stay. */
  remote: {
    schema: SerializedImageSchema | SerializedFileSchema;
    settings: RemoteUploadSettings;
  } | null;
}): Promise<ReadBackSessionImage> {
  const { localPath, patchId, metadata, remote } = args;
  const filename = localPath.slice(localPath.lastIndexOf("/") + 1);
  const fetched = await fetchMediaBytes(
    Internal.mediaUrl({ path: localPath, patch_id: patchId }),
    filename,
    metadata.mimeType,
  );
  if (fetched.status === "error") {
    return { status: "error", message: fetched.message };
  }
  if (remote === null) {
    return {
      status: "ok",
      file: { filePath: localPath, dataUrl: fetched.bytes.dataUrl },
    };
  }
  const made = remoteRefOf({
    localPath,
    schema: remote.schema,
    metadata,
    sha256: fetched.bytes.sha256,
    remote: remote.settings,
  });
  if (made.status === "error") {
    return made;
  }
  return {
    status: "ok",
    file: { filePath: made.ref, dataUrl: fetched.bytes.dataUrl },
  };
}
