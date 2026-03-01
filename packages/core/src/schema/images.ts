import { Schema } from ".";
import type { SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema, string } from "./string";
import { NumberSchema } from "./number";

/**
 * Alt schema type - can be a string, nullable string, or a record of locale to string
 */
export type AltSchema =
  | StringSchema<string>
  | StringSchema<string | null>
  | RecordSchema<StringSchema<string>, Schema<string>, Record<string, string>>;

/**
 * Options for s.images()
 */
export type ImagesOptions<Accept extends `image/${string}`> = {
  /**
   * The accepted mime type pattern. Must be an image type (e.g., "image/png", "image/webp", "image/*")
   */
  accept: Accept;
  /**
   * The directory where images should be stored.
   * Must start with "/public" (e.g., "/public/val/images")
   * @default "/public/val"
   */
  directory?: "/public" | `/public/${string}`;
  /**
   * Alt text schema. Can be:
   * - s.string() for required alt text
   * - s.string().nullable() for optional alt text (default)
   * - s.record(s.string(), s.string()) for locale-based alt text
   */
  alt?: AltSchema;
  /**
   * Whether remote images are allowed
   * @default false
   */
  remote?: boolean;
};

/**
 * Metadata for an image entry in the images record
 */
export type ImagesEntryMetadata = {
  width: number;
  height: number;
  mimeType: string;
  alt: string | null;
  hotspot?: {
    x: number;
    y: number;
  };
};

export type SerializedImagesSchema = SerializedRecordSchema;

// Item schema types for images (alt simplified to string | null for typing)
type ImagesItemProps = {
  width: NumberSchema<number>;
  height: NumberSchema<number>;
  mimeType: StringSchema<string>;
  alt: StringSchema<string | null>;
};
type ImagesItemSrc = {
  width: number;
  height: number;
  mimeType: string;
  alt: string | null;
};

/**
 * Define a collection of images.
 *
 * @example
 * ```typescript
 * const schema = s.images({
 *   accept: "image/webp",
 *   directory: "/public/val/images",
 *   alt: s.string().minLength(4),
 * });
 * export default c.define("/content/images.val.ts", schema, {
 *   "/public/val/images/hero.webp": {
 *     width: 1920,
 *     height: 1080,
 *     mimeType: "image/webp",
 *     alt: "Hero image",
 *   },
 * });
 * ```
 */
export const images = <Accept extends `image/${string}`>(
  options: ImagesOptions<Accept>,
): RecordSchema<
  ObjectSchema<ImagesItemProps, ImagesItemSrc>,
  Schema<string>,
  Record<string, ImagesEntryMetadata>
> => {
  const directory = options.directory ?? "/public/val";
  const altSchema = options.alt ?? string().nullable();
  const itemSchema = new ObjectSchema(
    {
      width: new NumberSchema<number>(undefined, false),
      height: new NumberSchema<number>(undefined, false),
      mimeType: new StringSchema<string>({}, false),
      alt: altSchema,
    },
    false,
  ) as ObjectSchema<ImagesItemProps, ImagesItemSrc>;
  return new RecordSchema(itemSchema, false, [], null, null, {
    type: "images",
    accept: options.accept,
    directory,
    remote: options.remote ?? false,
    altSchema,
  });
};
