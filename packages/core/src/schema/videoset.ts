import { Schema } from ".";
import type { SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema, string } from "./string";
import { NumberSchema } from "./number";
import type { AltSchema, AltSource, AltSourceOf } from "./imageset";
import type { SerializedVideoSchema, VideoStreamOption } from "./video";
import { DEFAULT_VIDEO_ACCEPT } from "./video";
import type {
  MediaHotspot,
  VideoCaptionSource,
  VideoPosterSource,
} from "../source/media";

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
 * Two kinds of thing are here. What is TRUE OF THE FILE — what it is, how
 * big, how long — is read from the bytes and is the set's alone. The rest —
 * the description, focal point, poster, start and end, and captions — is what
 * a page chooses about a video, and an entry holds it as the DEFAULT: every
 * field picked from the set (`s.video(videosVal)`) starts from it and may
 * override it key by key, so a video described and trimmed once is described
 * and trimmed everywhere it is used. `fillFromGallery` is the one merge.
 *
 * The poster is also the set's thumbnail of the entry: there is no separate
 * still for the gallery, because two stills of one video would disagree.
 */
export type VideosetEntryMetadata<Alt extends AltSource = string | null> = {
  mimeType: string;
  width: number;
  height: number;
  /** In seconds. */
  duration: number;
  alt: Alt;
  hotspot?: MediaHotspot;
  /** Seconds. The frame the poster was taken from. */
  posterTime?: number;
  poster?: VideoPosterSource;
  /** Seconds. Where playback starts. */
  startTime?: number;
  /** Seconds. Where playback stops. */
  endTime?: number;
  /** Overridden as a whole: a field with its own tracks has none of these. */
  captions?: readonly VideoCaptionSource[];
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
 * A field picks from it with `s.video(videosVal)`. An entry may hold the
 * description, poster, start and end, focal point and captions as defaults,
 * and a field overrides any of them by setting its own. Uploading in such a
 * field adds to the set. Call `.remote()` on the result
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
 *     startTime: 1.5,
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

/**
 * The video schema a set's entry is hashed against, for a remote ref.
 *
 * The set's item schema is an object, but a remote ref's validation hash is
 * computed over a MEDIA schema, so one is synthesized from the set — the one
 * definition the CLI's upload (`videos:upload-remote`) and the Studio's (the
 * set's gallery) both use, because two copies are two hashes for the same
 * file. `stream` is left out: it says what is done to an upload on its way
 * in, not whether the bytes that arrived are valid.
 */
export function videosetEntryVideoSchema(set: {
  accept?: string;
  dir?: string;
}): SerializedVideoSchema {
  return {
    type: "video",
    opt: false,
    options: {
      ...(set.accept ? { accept: set.accept } : {}),
      ...(set.dir ? { dir: set.dir } : {}),
    },
  };
}
