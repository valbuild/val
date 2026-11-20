import {
  FileMetadata,
  ImageMetadata,
  Internal,
  SerializedImageSchema,
  SerializedFileSchema,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { getFileExt } from "../../utils/getFileExt";

const textEncoder = new TextEncoder();

/**
 * The patch a single image or file field writes for an upload: the field's
 * value (the path, and what was read from the bytes unless the field is
 * library-backed) and the file op carrying the bytes.
 *
 * Its own module, out of `FileField`, so it can be used without the field
 * component -- the image field, rich text and the scenario harness
 * (`scenarios/`) all call it.
 */
export async function createFilePatch(
  path: string[],
  data: string | null,
  filename: string | null,
  fileHash: string,
  metadata: FileMetadata | ImageMetadata | undefined,
  subType: "image" | "file",
  remote: {
    publicProjectId: string;
    coreVersion: string;
    bucket: string;
    schema: SerializedImageSchema | SerializedFileSchema;
    remoteHost: string;
  } | null,
  dir: string | undefined = "/public/val",
  /**
   * True when the field is backed by a gallery. The dimensions and mime type
   * then live in the gallery module, so the field carries only the path.
   */
  galleryBacked: boolean = false,
): Promise<{ patch: Patch; filePath: string }> {
  const newFilePath = Internal.createFilename(
    data,
    filename,
    metadata,
    fileHash,
  );
  if (!newFilePath || !metadata) {
    return { patch: [], filePath: "" };
  }

  const filePath = `${dir}/${newFilePath}`;
  const remoteFileHash = Internal.remote.hashToRemoteFileHash(fileHash);
  const ref = remote
    ? Internal.remote.createRemoteRef(remote.remoteHost, {
        publicProjectId: remote.publicProjectId,
        coreVersion: remote.coreVersion,
        bucket: remote.bucket,
        validationHash: Internal.remote.getValidationHash(
          remote.coreVersion,
          remote.schema,
          getFileExt(newFilePath),
          metadata,
          remoteFileHash,
          textEncoder,
        ),
        fileHash: remoteFileHash,
        filePath:
          `${(dir ?? "/public/val").slice(1)}/${newFilePath}` as `public/${string}`,
      })
    : filePath;
  return {
    patch: [
      {
        value: {
          path: ref,
          ...(galleryBacked ? {} : metadata),
        },
        op: "replace",
        path,
      },
      {
        value: data,
        metadata,
        op: "file",
        path,
        filePath: ref,
        remote: remote !== null,
      },
    ],
    filePath,
  };
}
