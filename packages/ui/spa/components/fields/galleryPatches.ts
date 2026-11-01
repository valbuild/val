import type { JSONValue, Patch } from "@valbuild/core/patch";
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
