import type { SerializedFileSchema } from "./file";
import type { SerializedImageSchema } from "./image";

/**
 * The image or file schema an `s.imagedir()` / `s.filedir()` entry's remote
 * ref is hashed against.
 *
 * A directory's item schema is an object, but a remote ref's validation hash
 * is computed over a MEDIA schema, so one is synthesized from the directory:
 * its `accept`, and for images its `dir`. The one definition every uploader
 * of an entry uses -- the CLI's `--fix`, the Studio's Validate page and the
 * MCP image tool -- because two copies are two hashes for the same file, and
 * a ref hashed with the wrong one uploads and then never validates. The video
 * set's equivalent is `videosetEntryVideoSchema`.
 */
export function galleryEntryMediaSchema(
  type: "image",
  record: { accept?: string; dir?: string },
): SerializedImageSchema;
export function galleryEntryMediaSchema(
  type: "file",
  record: { accept?: string; dir?: string },
): SerializedFileSchema;
export function galleryEntryMediaSchema(
  type: "image" | "file",
  record: { accept?: string; dir?: string },
): SerializedImageSchema | SerializedFileSchema;
export function galleryEntryMediaSchema(
  type: "image" | "file",
  record: { accept?: string; dir?: string },
): SerializedImageSchema | SerializedFileSchema {
  if (type === "file") {
    return {
      type: "file",
      opt: false,
      options: { ...(record.accept ? { accept: record.accept } : {}) },
    };
  }
  return {
    type: "image",
    opt: false,
    options: {
      ...(record.accept ? { accept: record.accept } : {}),
      ...(record.dir ? { dir: record.dir } : {}),
    },
  };
}
