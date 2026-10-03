import { Schema } from ".";
import type { SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema, string } from "./string";
import { NumberSchema } from "./number";
import type { AltSchema, AltSource, AltSourceOf } from "./imageset";
import type { VideoStreamOption } from "./video";
import { DEFAULT_VIDEO_ACCEPT } from "./video";

/**
 * Options for s.videoset()
 */
export type VideosetOptions<
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
> = VideosetOptionsBase<Accept> & VideosetAltOption<Alt>;

/** See `ImagesetAltOption`: `alt` is optional only when it is the default. */
type VideosetAltOption<Alt extends AltSchema> = [
  StringSchema<string | null>,
] extends [Alt]
  ? {
      /**
       * Description schema. Can be:
       * - s.string() for a required description
       * - s.string().nullable() for an optional one (default)
       * - s.record(s.string(), s.string()) for one per locale
       */
      alt?: Alt;
    }
  : {
      /** Description schema — required, because it is not the default one. */
      alt: Alt;
    };

type VideosetOptionsBase<Accept extends `video/${string}`> = {
  /**
   * What may be UPLOADED, in `<input accept>` syntax. Must be a video type.
   * Not checked against an HLS stream: see `VideoOptions.accept`.
   * @default "video/*"
   */
  accept?: Accept;
  /**
   * The directory where videos are stored. Must start with "/public".
   *
   * Required for the same reason it is on `s.imageset()`: it decides where
   * every upload in the set lands, and a default is a directory shared with
   * every other set that did not say.
   */
  dir: "/public" | `/public/${string}`;
  /**
   * Turn every upload into an HLS stream, in the browser. See
   * `VideoStreamOptions`. A field backed by this set (`s.video(videosVal)`)
   * inherits it, as it inherits `accept` and `dir`.
   */
  stream?: VideoStreamOption;
};

/**
 * One video of a set, keyed by its file path (an HLS stream by its master
 * playlist).
 *
 * Only what is TRUE OF THE FILE is here: what it is, how big, how long, and
 * the description. The poster, the start and end, the focal point and the
 * captions are choices one page makes about a video and another may not, so
 * they stay on the field — `GalleryVideoSource` — the same way an image's
 * hotspot is the field's own.
 */
export type VideosetEntryMetadata<Alt extends AltSource = string | null> = {
  mimeType: string;
  width: number;
  height: number;
  /** In seconds. */
  duration: number;
  alt: Alt;
};

export type SerializedVideosetSchema = SerializedRecordSchema;

type VideosetItemProps<Alt extends AltSchema> = {
  mimeType: StringSchema<string>;
  width: NumberSchema<number>;
  height: NumberSchema<number>;
  duration: NumberSchema<number>;
  alt: Alt;
};
type VideosetItemSrc<Alt extends AltSchema> = {
  mimeType: string;
  width: number;
  height: number;
  duration: number;
  alt: AltSourceOf<Alt>;
};

/**
 * Define a collection of videos — the video twin of `s.imageset()`.
 *
 * A field picks from it with `s.video(videosVal)`, and carries only what is
 * its own: the description, poster, start and end, focal point and captions.
 * Uploading in such a field adds to the set. Call `.remote()` on the result
 * to store the set on Val Remote.
 *
 * @example
 * ```typescript
 * const schema = s.videoset({
 *   dir: "/public/val/videos",
 *   stream: { type: "hls" },
 * });
 * export default c.define("/content/videos.val.ts", schema, {
 *   "/public/val/videos/intro_51df2.mp4": {
 *     mimeType: "video/mp4",
 *     width: 1280,
 *     height: 720,
 *     duration: 12.5,
 *     alt: "The team, introducing itself",
 *   },
 * });
 * ```
 */
export const videoset = <
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  options: VideosetOptions<Accept, Alt>,
): RecordSchema<
  ObjectSchema<VideosetItemProps<Alt>, VideosetItemSrc<Alt>>,
  Schema<string>,
  Record<string, VideosetEntryMetadata<AltSourceOf<Alt>>>
> => {
  // The same assertion as in `imageset()`, and sound for the same reason:
  // `VideosetAltOption` makes `alt` required unless `Alt` is the default.
  const altSchema = (options.alt ?? string().nullable()) as Alt;
  const itemSchema = new ObjectSchema<
    VideosetItemProps<Alt>,
    VideosetItemSrc<Alt>
  >(
    {
      mimeType: new StringSchema<string>({}, false),
      width: new NumberSchema<number>(undefined, false),
      height: new NumberSchema<number>(undefined, false),
      duration: new NumberSchema<number>(undefined, false),
      alt: altSchema,
    },
    false,
  );
  return new RecordSchema(itemSchema, false, [], null, null, {
    type: "videos",
    accept: options.accept ?? DEFAULT_VIDEO_ACCEPT,
    dir: options.dir,
    remote: false,
    altSchema,
    stream: options.stream,
  });
};
