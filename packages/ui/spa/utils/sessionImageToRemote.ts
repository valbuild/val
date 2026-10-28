import {
  type PatchId,
  type SerializedFileSchema,
  type SerializedImageSchema,
} from "@valbuild/core";
import { fetchMediaBytes } from "./fetchMediaBytes";
import { remoteRefOf, type RemoteUploadSettings } from "./uploadLocalMedia";

/**
 * The remote ref an image the assistant was given is stored under.
 *
 * The content service attaches a session image to a patch by pointing the
 * patch's file at the object the image already is: nothing is copied, and a
 * remote one is filed under its `/public` path, as every remote upload is.
 * What it is stored UNDER, in the content, is a ref -- and a ref names the
 * SHA-256 of the bytes. Stored under the `/public` path instead, the Studio
 * read it as a local file, asked for one that was never there, and showed a
 * broken image.
 *
 * The service hands the hash back with the transfer (`sha256`). One that
 * predates that does not, and then the bytes are read back from where the
 * draft is served, to hash them -- a download, and only that: the bytes are
 * already on the patch, so nothing goes up again. The ref itself is made by
 * `remoteRefOf`, the rule every other Studio upload to remote storage uses.
 */
export async function nameSessionImageRemote(args: {
  /** Where the session image was attached: `/public/val/images/a.png`. */
  localPath: string;
  patchId: PatchId;
  schema: SerializedImageSchema | SerializedFileSchema;
  /** As it will be stored; its width, height and mime type are hashed. */
  metadata: { mimeType?: string } & Record<string, unknown>;
  /** What the content service said the bytes hash to, where it said. */
  sha256: string | undefined;
  remote: RemoteUploadSettings;
}): Promise<
  { status: "ok"; ref: string } | { status: "error"; message: string }
> {
  const { localPath, patchId, schema, metadata, remote } = args;
  let sha256 = args.sha256;
  if (sha256 === undefined) {
    const filename = localPath.slice(localPath.lastIndexOf("/") + 1);
    const fetched = await fetchMediaBytes(
      `/api/val/files${localPath}?patch_id=${encodeURIComponent(patchId)}&remote=true`,
      filename,
      metadata.mimeType,
    );
    if (fetched.status === "error") {
      return { status: "error", message: fetched.message };
    }
    sha256 = fetched.bytes.sha256;
  }
  return remoteRefOf({ localPath, schema, metadata, sha256, remote });
}
