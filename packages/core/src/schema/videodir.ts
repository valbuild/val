import { Schema } from ".";
import type { MediaDir, SerializedRecordSchema } from "./record";
import { RecordSchema } from "./record";
import { ObjectSchema } from "./object";
import { StringSchema, string } from "./string";
import { NumberSchema } from "./number";
import type { AltSchema, AltSource, AltSourceOf } from "./imagedir";
import type { SerializedVideoSchema, VideoStreamOption } from "./video";
import { DEFAULT_VIDEO_ACCEPT } from "./video";
import type {
  MediaHotspot,
  VideoCaptionSource,
  VideoPosterSource,
} from "../source/media";

/**
 * Options for `s.videodir(dir, options)`: everything but the directory, which
 * is the first argument.
 */
export type VideodirOptions<
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
> = VideodirOptionsBase<Accept> & VideodirAltOption<Alt>;

/**
 * Options for the deprecated `s.videoset(options)`, which took the directory
 * as `dir`.
 *
 * @deprecated Use `s.videodir(dir, options)` and `VideodirOptions`.
 */
export type VideosetOptions<
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
> = VideodirOptions<Accept, Alt> & {
  /** The directory where videos are stored. Must start with "/public". */
  dir: MediaDir;
};

/** See `ImagedirAltOption`: `alt` is optional only when it is the default. */
type VideodirAltOption<Alt extends AltSchema> = [
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

/** See `ImagedirOptionsArg`: the options are optional only when `alt` is. */
type VideodirOptionsArg<
  Accept extends `video/${string}`,
  Alt extends AltSchema,
> = [StringSchema<string | null>] extends [Alt]
  ? [options?: VideodirOptions<Accept, Alt>]
  : [options: VideodirOptions<Accept, Alt>];

type VideodirOptionsBase<Accept extends `video/${string}`> = {
  /**
   * What may be UPLOADED, in `<input accept>` syntax. Must be a video type.
   * Not checked against an HLS stream: see `VideoOptions.accept`.
   * @default "video/*"
   */
  accept?: Accept;
  /**
   * Turn every upload into an HLS stream, in the browser. See
   * `VideoStreamOptions`. A field backed by this directory
   * (`s.video(videosVal)`) inherits it, as it inherits `accept` and the
   * directory.
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
export type VideodirEntryMetadata<Alt extends AltSource = string | null> = {
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

/** @deprecated Use `VideodirEntryMetadata`. */
export type VideosetEntryMetadata<Alt extends AltSource = string | null> =
  VideodirEntryMetadata<Alt>;

export type SerializedVideodirSchema = SerializedRecordSchema;

/** @deprecated Use `SerializedVideodirSchema`. */
export type SerializedVideosetSchema = SerializedVideodirSchema;

type VideodirItemProps<Alt extends AltSchema> = {
  mimeType: StringSchema<string>;
  width: NumberSchema<number>;
  height: NumberSchema<number>;
  duration: NumberSchema<number>;
  alt: Alt;
};
type VideodirItemSrc<Alt extends AltSchema> = {
  mimeType: string;
  width: number;
  height: number;
  duration: number;
  alt: AltSourceOf<Alt>;
};

type VideodirSchema<Alt extends AltSchema> = RecordSchema<
  ObjectSchema<VideodirItemProps<Alt>, VideodirItemSrc<Alt>>,
  Schema<string>,
  Record<string, VideodirEntryMetadata<AltSourceOf<Alt>>>
>;

/**
 * Define a directory of videos — the video twin of `s.imagedir()`.
 *
 * A field picks from it with `s.video(videosVal)`. An entry may hold the
 * description, poster, start and end, focal point and captions as defaults,
 * and a field overrides any of them by setting its own. Uploading in such a
 * field adds to the directory. Call `.remote()` on the result to store the
 * videos on Val Remote.
 *
 * @example
 * ```typescript
 * const schema = s.videodir("/public/val/videos", {
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
export const videodir = <
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  dir: MediaDir,
  ...[options]: VideodirOptionsArg<Accept, Alt>
): VideodirSchema<Alt> => videodirOf<Accept, Alt>(dir, options);

/**
 * `s.videodir()` with `.remote()` applied: what `s.videodir` is under
 * `files: { remote: true }`.
 */
export const remoteVideodir = <
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  dir: MediaDir,
  ...[options]: VideodirOptionsArg<Accept, Alt>
): VideodirSchema<Alt> => videodirOf<Accept, Alt>(dir, options).remote();

/**
 * Define a collection of videos.
 *
 * @deprecated Use `s.videodir(dir, options)`: the directory moved out of the
 * options and into the first argument, and nothing else changed.
 *
 * @example
 * ```typescript
 * // was: s.videoset({ dir: "/public/val/videos", stream: { type: "hls" } })
 * const schema = s.videodir("/public/val/videos", { stream: { type: "hls" } });
 * ```
 */
export const videoset = <
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  options: VideosetOptions<Accept, Alt>,
): VideodirSchema<Alt> => videodirOf<Accept, Alt>(options.dir, options);

function videodirOf<
  Accept extends `video/${string}`,
  Alt extends AltSchema = StringSchema<string | null>,
>(
  dir: MediaDir,
  options: VideodirOptions<Accept, Alt> | undefined,
): VideodirSchema<Alt> {
  // The same assertion as in `imagedir()`, and sound for the same reason:
  // `VideodirAltOption` makes `alt` required unless `Alt` is the default.
  const altSchema = (options?.alt ?? string().nullable()) as Alt;
  const itemSchema = new ObjectSchema<
    VideodirItemProps<Alt>,
    VideodirItemSrc<Alt>
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
    accept: options?.accept ?? DEFAULT_VIDEO_ACCEPT,
    dir,
    remote: false,
    altSchema,
    stream: options?.stream,
  });
}

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
