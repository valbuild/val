import {
  Internal,
  type SerializedFileSchema,
  type SerializedImageSchema,
} from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import { getFileExt } from "../../utils/getFileExt";
import type { array } from "@valbuild/core/fp";

/**
 * The patches a media library (`s.imagedir`, `s.filedir`) writes for its own
 * entries. A library is a record keyed by the file's path, so the path is the
 * key and is not repeated in the value.
 *
 * Their own functions so `ModuleGallery`'s single and multi-file uploads, its
 * delete and its alt text all write the same shapes, and so the scenario
 * harness (`scenarios/`) writes exactly what the library writes.
 */

/** What a library entry records about an uploaded image, all of it known. */
export type GalleryImageMetadata = {
  width: number;
  height: number;
  mimeType: string;
};

/** What a library entry records about an uploaded file. */
export type GalleryFileMetadata = { mimeType: string };

/** A new entry and its bytes: the metadata as the value, the file op beside it. */
export function galleryUploadPatch(args: {
  patchPath: string[];
  ref: string;
  /** The file as a data URL. */
  src: string;
  remote: boolean;
  media:
    | { kind: "image"; metadata: GalleryImageMetadata }
    | { kind: "file"; metadata: GalleryFileMetadata };
}): Patch {
  const { patchPath, ref, src, remote, media } = args;
  const value: JSONValue =
    media.kind === "image"
      ? {
          width: media.metadata.width,
          height: media.metadata.height,
          mimeType: media.metadata.mimeType,
          alt: null, // default alt for new uploads
        }
      : { mimeType: media.metadata.mimeType };
  return [
    { op: "add", path: [...patchPath, ref], value },
    {
      op: "file",
      path: [...patchPath, ref],
      filePath: ref,
      value: src,
      metadata: media.metadata,
      remote,
    },
  ];
}

/**
 * An entry out, and every file it names with it: its own (`filePaths`, all
 * of a stream's files for a stream) and, for a video, its poster and captions
 * (`entryFiles`).
 */
export function galleryRemovePatch(args: {
  patchPath: string[];
  ref: string;
  filePaths: string[];
  remote: boolean;
  entryFiles: { filePath: string; remote: boolean }[];
}): Patch {
  const { patchPath, ref, filePaths, remote, entryFiles } = args;
  const [head, ...tail] = patchPath;
  const entryPath: array.NonEmptyArray<string> =
    head === undefined ? [ref] : [head, ...tail, ref];
  return [
    { op: "remove", path: entryPath },
    ...filePaths.map((filePath): Patch[number] => ({
      op: "file",
      path: [...patchPath, ref],
      filePath,
      value: null,
      remote,
    })),
    ...entryFiles.map((file): Patch[number] => ({
      op: "file",
      path: [...patchPath, ref],
      filePath: file.filePath,
      value: null,
      remote: file.remote,
    })),
  ];
}

/** An entry's alt text. */
export function galleryAltPatch(
  patchPath: string[],
  ref: string,
  alt: string,
): Patch {
  return [
    {
      // "add", not "replace": on an object key the two mean the same thing,
      // but "add" also works when the key is absent by the time the patch is
      // applied - e.g. the entry was re-uploaded with fresh metadata.
      op: "add",
      path: [...patchPath, ref, "alt"],
      value: alt,
    },
  ];
}

const textEncoder = new TextEncoder();

/**
 * Where an upload to a library goes: `<directory>/<name>_<hash>.<ext>` for a
 * local library, a remote ref for a remote one. `ModuleGallery`'s uploads
 * name their files with this, and so does the scenario harness.
 */
export function galleryRef(
  library: {
    directory: string;
    requireRemote: boolean | undefined;
    remoteData: {
      publicProjectId: string;
      bucket: string;
      coreVersion: string;
      remoteHost: string;
    } | null;
  },
  res: { fileHash: string; src: string; filename?: string },
  syntheticSchema: SerializedImageSchema | SerializedFileSchema,
  metadata: Record<string, unknown> | undefined,
):
  | { status: "success"; ref: string; isRemote: boolean }
  | { status: "error"; error: string } {
  const { directory, requireRemote, remoteData } = library;
  const newFilename = Internal.createFilename(
    res.src,
    res.filename ?? null,
    metadata,
    res.fileHash,
  );
  if (!newFilename) {
    return {
      status: "error",
      error: "Failed to create filename for the uploaded file.",
    };
  }
  const filePath = `${directory}/${newFilename}`;
  let ref: string;
  let isRemote: boolean;
  if (requireRemote) {
    if (!remoteData) {
      return {
        status: "error",
        error:
          "Remote uploads are not available. Please try again later. This could be a temporary issue with the Val server. If the problem persists, please contact support.",
      };
    }
    const remoteFileHash = Internal.remote.hashToRemoteFileHash(res.fileHash);
    const validationHash = Internal.remote.getValidationHash(
      remoteData.coreVersion,
      syntheticSchema,
      getFileExt(newFilename),
      metadata,
      remoteFileHash,
      textEncoder,
    );
    ref = Internal.remote.createRemoteRef(remoteData.remoteHost, {
      publicProjectId: remoteData.publicProjectId,
      coreVersion: remoteData.coreVersion,
      bucket: remoteData.bucket,
      validationHash,
      fileHash: remoteFileHash,
      filePath: `${directory.slice(1)}/${newFilename}` as `public/${string}`,
    });
    isRemote = true;
  } else {
    ref = filePath;
    isRemote = false;
  }
  return {
    status: "success",
    ref,
    isRemote,
  };
}
