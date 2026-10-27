import { Schema } from ".";
import type { MediaDir, SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema } from "./string";

/**
 * Options for `s.filedir(dir, options)`: everything but the directory, which
 * is the first argument.
 */
export type FiledirOptions = {
  /**
   * The accepted mime type pattern (e.g., "application/pdf", "text/*", "*\/*")
   */
  accept: string;
};

/**
 * Options for the deprecated `s.fileset(options)`, which took the directory
 * as `dir`.
 *
 * @deprecated Use `s.filedir(dir, options)` and `FiledirOptions`.
 */
export type FilesetOptions = FiledirOptions & {
  /**
   * The directory where files should be stored.
   * Must start with "/public" (e.g., "/public/val/files")
   */
  dir: MediaDir;
};

/**
 * Metadata for a file entry in the files record
 */
export type FiledirEntryMetadata = {
  mimeType: string;
};

/** @deprecated Use `FiledirEntryMetadata`. */
export type FilesetEntryMetadata = FiledirEntryMetadata;

export type SerializedFiledirSchema = SerializedRecordSchema;

/** @deprecated Use `SerializedFiledirSchema`. */
export type SerializedFilesetSchema = SerializedFiledirSchema;

type FiledirItemProps = { mimeType: StringSchema<string> };
type FiledirItemSrc = { mimeType: string };

type FiledirSchema = RecordSchema<
  ObjectSchema<FiledirItemProps, FiledirItemSrc>,
  Schema<string>,
  Record<string, FiledirEntryMetadata>
>;

/**
 * Define a directory of files: a whole module that holds many files, keyed by
 * their file path, that fields pick from with `s.file(filesVal)`.
 *
 * The directory is the first argument and is required — it decides where
 * uploads land. Remote is off by default: call `.remote()` on the result to
 * allow remote files.
 *
 * @example
 * ```typescript
 * const schema = s.filedir("/public/val/documents", {
 *   accept: "application/pdf",
 * });
 * export default c.define("/content/documents.val.ts", schema, {
 *   "/public/val/documents/report.pdf": {
 *     mimeType: "application/pdf",
 *   },
 * });
 * ```
 */
export const filedir = (
  dir: MediaDir,
  options: FiledirOptions,
): FiledirSchema => {
  const itemSchema = new ObjectSchema<FiledirItemProps, FiledirItemSrc>(
    { mimeType: new StringSchema({}, false) },
    false,
  );
  return new RecordSchema(itemSchema, false, [], null, null, {
    type: "files",
    accept: options.accept,
    dir,
    remote: false,
  });
};

/**
 * Define a collection of files.
 *
 * @deprecated Use `s.filedir(dir, options)`: the directory moved out of the
 * options and into the first argument, and nothing else changed.
 *
 * @example
 * ```typescript
 * // was: s.fileset({ dir: "/public/val/documents", accept: "application/pdf" })
 * const schema = s.filedir("/public/val/documents", {
 *   accept: "application/pdf",
 * });
 * ```
 */
export const fileset = (options: FilesetOptions): FiledirSchema =>
  filedir(options.dir, options);
