import { Schema } from ".";
import type { SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema } from "./string";

/**
 * Options for s.fileset()
 */
export type FilesetOptions = {
  /**
   * The accepted mime type pattern (e.g., "application/pdf", "text/*", "*\/*")
   */
  accept: string;
  /**
   * The directory where files should be stored.
   * Must start with "/public" (e.g., "/public/val/files")
   *
   * Required, and deliberately so: it decides where every uploaded file in this
   * collection lands, and it used to default to "/public/val" — which meant a
   * collection that had simply not said where it wanted its files silently shared
   * a directory with every other one.
   */
  dir: "/public" | `/public/${string}`;
};

/**
 * Metadata for a file entry in the files record
 */
export type FilesetEntryMetadata = {
  mimeType: string;
};

export type SerializedFilesetSchema = SerializedRecordSchema;

type FilesetItemProps = { mimeType: StringSchema<string> };
type FilesetItemSrc = { mimeType: string };

/**
 * Define a collection of files.
 *
 * Remote is off by default: call `.remote()` on the result to allow remote files.
 *
 * @example
 * ```typescript
 * const schema = s.fileset({
 *   accept: "application/pdf",
 *   dir: "/public/val/documents",
 * });
 * export default c.define("/content/documents.val.ts", schema, {
 *   "/public/val/documents/report.pdf": {
 *     mimeType: "application/pdf",
 *   },
 * });
 * ```
 */
export const fileset = (
  options: FilesetOptions,
): RecordSchema<
  ObjectSchema<FilesetItemProps, FilesetItemSrc>,
  Schema<string>,
  Record<string, FilesetEntryMetadata>
> => {
  const dir = options.dir;
  const itemSchema = new ObjectSchema<FilesetItemProps, FilesetItemSrc>(
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
