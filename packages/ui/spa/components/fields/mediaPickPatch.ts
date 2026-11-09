import type { Patch } from "@valbuild/core/patch";

/**
 * The patch a media field writes when a library entry is picked (an image,
 * file, video or font from an `s.imagedir`/`s.filedir`/`s.videodir`/
 * `s.fontdir`): only the path. What is true of the file -- its size, type,
 * default alt, poster and times -- stays in the library, the one place that
 * has it, and is filled in when the field is read (`fillFromGallery`).
 *
 * Its own function so every picker writes the same thing, and so the
 * scenario harness (`scenarios/`) picks exactly as a field does.
 */
export function mediaPickPatch(patchPath: string[], filePath: string): Patch {
  return [{ op: "replace", path: patchPath, value: { path: filePath } }];
}
