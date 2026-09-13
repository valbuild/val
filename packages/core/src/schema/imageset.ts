import { Schema } from ".";
import type { SelectorOfSchema } from ".";
import type { SerializedRecordSchema } from "./record";
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
 * Options for s.imageset()
 */
export type ImagesetOptions<
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
> = ImagesetOptionsBase<Accept> & ImagesetAltOption<Alt>;

/**
 * `alt` is optional only when it is the default schema.
 *
 * Naming a different `Alt` and then leaving `alt` out would make the fallback
 * in `imageset()` a lie — `Alt` would say `s.string()` while the value was a
 * nullable one. Requiring it in that case is what makes the fallback sound:
 * the branch that uses it is reachable only when `Alt` IS the default.
 */
type ImagesetAltOption<Alt extends AltSchema> = [
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

type ImagesetOptionsBase<Accept extends `image/${string}`> = {
  /**
   * The accepted mime type pattern. Must be an image type (e.g., "image/png", "image/webp", "image/*")
   * @default "image/*"
   */
  accept?: Accept;
  /**
   * The directory where images should be stored.
   * Must start with "/public" (e.g., "/public/val/images")
   *
   * Required, and deliberately so: it decides where every uploaded file in this
   * collection lands, and it used to default to "/public/val" — which meant a
   * gallery that had simply not said where it wanted its files silently shared a
   * directory with every other one.
   */
  dir: "/public" | `/public/${string}`;
  /**
   * Re-encode uploads in the browser before they are uploaded.
   *
   * Off unless set. A field backed by this gallery (`s.image(galleryVal)`)
   * inherits it, the same way it inherits `accept` and `directory`.
   */
  encode?: ImageEncodeOption;
};

/**
 * Metadata for an image entry in the images record.
 *
 * `alt` follows the schema's `alt` option, so it defaults to `string | null`
 * and becomes `string` under `s.string()` or `Record<string, string>` under
 * `s.record(s.string())`. Write `ImagesetEntryMetadata<AltSource>` where a
 * gallery of any alt shape is acceptable.
 */
export type ImagesetEntryMetadata<Alt extends AltSource = string | null> = {
  width: number;
  height: number;
  mimeType: string;
  alt: Alt;
  hotspot?: {
    x: number;
    y: number;
  };
};

export type SerializedImagesetSchema = SerializedRecordSchema;

type ImagesetItemProps<Alt extends AltSchema> = {
  width: NumberSchema<number>;
  height: NumberSchema<number>;
  mimeType: StringSchema<string>;
  alt: Alt;
};
type ImagesetItemSrc<Alt extends AltSchema> = {
  width: number;
  height: number;
  mimeType: string;
  alt: AltSourceOf<Alt>;
};

/**
 * Define a collection of images.
 *
 * `directory` is required — it decides where uploads land, so it is not something
 * to be inferred. The rest defaults: any image type (`"image/*"`), nullable alt
 * text, remote disabled. Call `.remote()` on the result to allow remote images.
 *
 * @example
 * ```typescript
 * const schema = s.imageset({
 *   accept: "image/webp",
 *   dir: "/public/val/images",
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
export const imageset = <
  Accept extends `image/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  options: ImagesetOptions<Accept, Alt>,
): RecordSchema<
  ObjectSchema<ImagesetItemProps<Alt>, ImagesetItemSrc<Alt>>,
  Schema<string>,
  Record<string, ImagesetEntryMetadata<AltSourceOf<Alt>>>
> => {
  const dir = options.dir;
  // `options.alt` is `Alt | undefined`, and the fallback is exactly the schema
  // `Alt` defaults to when `alt` is omitted. TypeScript will not narrow a type
  // parameter from the absence of a value, so it cannot see that the two agree,
  // and the fallback is asserted here.
  //
  // Sound, not merely convenient: `ImagesetAltOption` makes `alt` REQUIRED
  // unless `Alt` is the default, so this branch is unreachable for any other
  // `Alt`. The one assertion in this file, and it replaces the wider one that
  // used to sit on the ObjectSchema below.
  const altSchema = (options.alt ?? string().nullable()) as Alt;
  const itemSchema = new ObjectSchema<
    ImagesetItemProps<Alt>,
    ImagesetItemSrc<Alt>
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
    accept: options.accept ?? "image/*",
    dir,
    remote: false,
    altSchema,
    encode: options.encode,
  });
};
