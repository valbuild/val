import { ValModule } from "..";
import { isFontMimeType } from "../mimeType/font";
import { getSchema } from "../selector";
import { getValPath } from "../val";
import { file, FileSchema, remoteFile } from "./file";
import { FilesetEntryMetadata } from "./fileset";
import { GalleryFileSource } from "../source/media";

/**
 * A font picked from an `s.fontset()`.
 *
 * The same field `s.file(fontsVal)` is — it stores `{ path }` and serializes
 * identically — with one thing more: it refuses a set that is not a font set,
 * at definition, so a field called a font cannot end up offering PDFs. What the
 * Studio does with it (a specimen in its parent, the set to pick from when
 * opened) it does for any file field backed by a font set.
 */
export function font(
  fontsetModule: ValModule<Record<string, FilesetEntryMetadata>>,
): FileSchema<GalleryFileSource> {
  assertFontset(fontsetModule);
  return file(fontsetModule);
}

/** `s.font()` with `.remote()` applied: see `files.remote` in `initSchema`. */
export function remoteFont(
  fontsetModule: ValModule<Record<string, FilesetEntryMetadata>>,
): FileSchema<GalleryFileSource> {
  assertFontset(fontsetModule);
  return remoteFile(fontsetModule);
}

function assertFontset(
  fontsetModule: ValModule<Record<string, FilesetEntryMetadata>>,
): void {
  const modulePath = getValPath(fontsetModule);
  const serialized = getSchema(fontsetModule)?.["executeSerialize"]();
  const accept =
    serialized?.type === "record" && serialized.mediaType === "files"
      ? serialized.accept
      : undefined;
  const isFontset =
    !!accept && accept.split(",").every((type) => isFontMimeType(type.trim()));
  if (!isFontset) {
    throw new Error(
      `s.font(${modulePath ?? "?"}): the module must be an s.fontset(). Use s.file() to pick from a set of other files.`,
    );
  }
}
