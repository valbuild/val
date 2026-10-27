import { Schema } from ".";
import type { SelectorOfSchema } from ".";
import type { MediaDir, SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema, string } from "./string";
import { NumberSchema } from "./number";
import type { ImageEncodeOption } from "./image";

/**
 * Alt schema type - can be a string, nullable string, or a record of locale to string
 */
export type AltSchema =
  | StringSchema<string>
  | StringSchema<string | null>
  | RecordSchema<StringSchema<string>, Schema<string>, Record<string, string>>;

/**
 * What an entry's `alt` holds, for a given `alt` schema.
 *
 * This is the schema's own source type, not a second list that has to be kept
 * in step with `AltSchema`: `s.string()` gives `string`, `s.string().nullable()`
 * gives `string | null`, and `s.record(s.string())` gives
 * `Record<string, string>`.
 */
export type AltSourceOf<Alt extends AltSchema> = SelectorOfSchema<Alt>;

/** Every `alt` value any `AltSchema` can produce. */
export type AltSource = AltSourceOf<AltSchema>;

/**
 * Options for `s.imagedir(dir, options)`: everything but the directory, which
 * is the first argument.
 */
export type ImagedirOptions<
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
> = ImagedirOptionsBase<Accept> & ImagedirAltOption<Alt>;

/**
 * Options for the deprecated `s.imageset(options)`, which took the directory
 * as `dir`.
 *
 * @deprecated Use `s.imagedir(dir, options)` and `ImagedirOptions`.
 */
export type ImagesetOptions<
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
> = ImagedirOptions<Accept, Alt> & {
  /**
   * The directory where images should be stored.
   * Must start with "/public" (e.g., "/public/val/images")
   */
  dir: MediaDir;
};

/**
 * `alt` is optional only when it is the default schema.
 *
 * Naming a different `Alt` and then leaving `alt` out would make the fallback
 * in `imagedir()` a lie — `Alt` would say `s.string()` while the value was a
 * nullable one. Requiring it in that case is what makes the fallback sound:
 * the branch that uses it is reachable only when `Alt` IS the default.
 */
type ImagedirAltOption<Alt extends AltSchema> = [
  StringSchema<string | null>,
] extends [Alt]
  ? {
      /**
       * Alt text schema. Can be:
       * - s.string() for required alt text
       * - s.string().nullable() for optional alt text (default)
       * - s.record(s.string(), s.string()) for locale-based alt text
       */
      alt?: Alt;
    }
  : {
      /** Alt text schema — required, because it is not the default one. */
      alt: Alt;
    };

/**
 * The options argument of `s.imagedir()`: optional only when `alt` is, for
 * the reason `ImagedirAltOption` gives — leaving the whole object out leaves
 * `alt` out with it.
 */
type ImagedirOptionsArg<
  Accept extends `image/${string}`,
  Alt extends AltSchema,
> = [StringSchema<string | null>] extends [Alt]
  ? [options?: ImagedirOptions<Accept, Alt>]
  : [options: ImagedirOptions<Accept, Alt>];

type ImagedirOptionsBase<Accept extends `image/${string}`> = {
  /**
   * The accepted mime type pattern. Must be an image type (e.g., "image/png", "image/webp", "image/*")
   * @default "image/*"
   */
  accept?: Accept;
  /**
   * Re-encode uploads in the browser before they are uploaded.
   *
   * Off unless set. A field backed by this gallery (`s.image(galleryVal)`)
   * inherits it, the same way it inherits `accept` and the directory.
   */
  encode?: ImageEncodeOption;
};

/**
 * Metadata for an image entry in the images record.
 *
 * `alt` follows the schema's `alt` option, so it defaults to `string | null`
 * and becomes `string` under `s.string()` or `Record<string, string>` under
 * `s.record(s.string())`. Write `ImagedirEntryMetadata<AltSource>` where a
 * gallery of any alt shape is acceptable.
 */
export type ImagedirEntryMetadata<Alt extends AltSource = string | null> = {
  width: number;
  height: number;
  mimeType: string;
  alt: Alt;
  hotspot?: {
    x: number;
    y: number;
  };
};

/** @deprecated Use `ImagedirEntryMetadata`. */
export type ImagesetEntryMetadata<Alt extends AltSource = string | null> =
  ImagedirEntryMetadata<Alt>;

export type SerializedImagedirSchema = SerializedRecordSchema;

/** @deprecated Use `SerializedImagedirSchema`. */
export type SerializedImagesetSchema = SerializedImagedirSchema;

type ImagedirItemProps<Alt extends AltSchema> = {
  width: NumberSchema<number>;
  height: NumberSchema<number>;
  mimeType: StringSchema<string>;
  alt: Alt;
};
type ImagedirItemSrc<Alt extends AltSchema> = {
  width: number;
  height: number;
  mimeType: string;
  alt: AltSourceOf<Alt>;
};

type ImagedirSchema<Alt extends AltSchema> = RecordSchema<
  ObjectSchema<ImagedirItemProps<Alt>, ImagedirItemSrc<Alt>>,
  Schema<string>,
  Record<string, ImagedirEntryMetadata<AltSourceOf<Alt>>>
>;

/**
 * Define a directory of images: a whole module that holds many images, keyed
 * by their file path, that fields pick from with `s.image(galleryVal)`.
 *
 * The directory is the first argument and is required — it decides where
 * uploads land, so it is not something to be inferred. The rest defaults: any
 * image type (`"image/*"`), nullable alt text, remote disabled. Call
 * `.remote()` on the result to allow remote images.
 *
 * @example
 * ```typescript
 * const schema = s.imagedir("/public/val/images", {
 *   accept: "image/webp",
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
export const imagedir = <
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  dir: MediaDir,
  ...[options]: ImagedirOptionsArg<Accept, Alt>
): ImagedirSchema<Alt> => {
  return imagedirOf<Accept, Alt>(dir, options);
};

function imagedirOf<
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  dir: MediaDir,
  options: ImagedirOptions<Accept, Alt> | undefined,
): ImagedirSchema<Alt> {
  // `options?.alt` is `Alt | undefined`, and the fallback is exactly the schema
  // `Alt` defaults to when `alt` is omitted. TypeScript will not narrow a type
  // parameter from the absence of a value, so it cannot see that the two agree,
  // and the fallback is asserted here.
  //
  // Sound, not merely convenient: `ImagedirAltOption` makes `alt` REQUIRED
  // unless `Alt` is the default, and `ImagedirOptionsArg` makes the options
  // object required with it, so this branch is unreachable for any other
  // `Alt`. The one assertion in this file, and it replaces the wider one that
  // used to sit on the ObjectSchema below.
  const altSchema = (options?.alt ?? string().nullable()) as Alt;
  const itemSchema = new ObjectSchema<
    ImagedirItemProps<Alt>,
    ImagedirItemSrc<Alt>
  >(
    {
      width: new NumberSchema<number>(undefined, false),
      height: new NumberSchema<number>(undefined, false),
      mimeType: new StringSchema<string>({}, false),
      alt: altSchema,
    },
    false,
  );
  return new RecordSchema(itemSchema, false, [], null, null, {
    type: "images",
    accept: options?.accept ?? "image/*",
    dir,
    remote: false,
    altSchema,
    encode: options?.encode,
  });
}

/**
 * `s.imagedir()` with `.remote()` applied: what `s.imagedir` is under
 * `files: { remote: true }`.
 */
export const remoteImagedir = <
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  dir: MediaDir,
  ...[options]: ImagedirOptionsArg<Accept, Alt>
): ImagedirSchema<Alt> => imagedirOf<Accept, Alt>(dir, options).remote();

/**
 * Define a collection of images.
 *
 * @deprecated Use `s.imagedir(dir, options)`: the directory moved out of the
 * options and into the first argument, and nothing else changed.
 *
 * @example
 * ```typescript
 * // was: s.imageset({ dir: "/public/val/images", accept: "image/webp" })
 * const schema = s.imagedir("/public/val/images", { accept: "image/webp" });
 * ```
 */
export const imageset = <
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  options: ImagesetOptions<Accept, Alt>,
): ImagedirSchema<Alt> => {
  return imagedirOf<Accept, Alt>(options.dir, options);
};
