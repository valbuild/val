import { Schema } from ".";
import type { SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema } from "./string";

/**
 * Options for s.files()
 */
export type FilesOptions = {
  /**
   * The accepted mime type pattern (e.g., "application/pdf", "text/*", "*\/*")
   */
  accept: string;
  /**
   * The directory where files should be stored.
   * Must start with "/public" (e.g., "/public/val/files")
   * @default "/public/val"
   */
  directory?: "/public" | `/public/${string}`;
  /**
   * Whether remote files are allowed
   * @default false
   */
  remote?: boolean;
};

/**
 * Metadata for a file entry in the files record
 */
export type FilesEntryMetadata = {
  mimeType: string;
};

export type SerializedFilesSchema = SerializedRecordSchema;

type FilesItemProps = { mimeType: StringSchema<string> };
type FilesItemSrc = { mimeType: string };

/**
 * Define a collection of files.
 *
 * @example
 * ```typescript
 * const schema = s.files({
 *   accept: "application/pdf",
 *   directory: "/public/val/documents",
 * });
 * export default c.define("/content/documents.val.ts", schema, {
 *   "/public/val/documents/report.pdf": {
 *     mimeType: "application/pdf",
 *   },
 * });
 * ```
 */
export const files = (
  options: FilesOptions,
): RecordSchema<
  ObjectSchema<FilesItemProps, FilesItemSrc>,
  Schema<string>,
  Record<string, FilesEntryMetadata>
> => {
  const directory = options.directory ?? "/public/val";
  const itemSchema = new ObjectSchema<FilesItemProps, FilesItemSrc>(
    { mimeType: new StringSchema({}, false) },
    false,
  );
  return new RecordSchema(itemSchema, false, [], null, null, {
    type: "files",
    accept: options.accept,
    directory,
    remote: options.remote ?? false,
  });
};
