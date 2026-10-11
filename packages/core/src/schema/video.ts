import {
  GalleryVideoSource,
  isHlsVideo,
  isRemoteMediaPath,
  VideoSource,
} from "../source/media";
import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { getValPath, SourcePath } from "../val";
import type { ValModule } from "../module";
import { getSource } from "../module";
import { GetSchema } from "../selector";
import type { AltSource } from "./imageset";
import type { VideosetEntryMetadata } from "./videoset";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { ItemPreviewInput, PreviewItem } from "../preview";
import { FieldRender } from "../render";
import { filenameToMimeType, mimeTypeMatchesAccept } from "../mimeType";
import {
  validateCaptions,
  validateHotspot,
  validatePoster,
  validateTimes,
} from "./videoDefaults";

/**
 * Turn an upload into an HLS stream, in the browser, before it is uploaded.
 *
 * The Studio transcodes the picked file with WebCodecs into one rendition per
 * entry of `renditions` (never upscaled: a 720p upload gets no 1080p
 * rendition), segments each into CMAF and writes the playlists. What is stored
 * is a directory beside the other uploads; the field's `path` is its master
 * playlist. See `architecture/media.md`.
 *
 * `type` is required for the same reason it is on `ImageEncodeOptions`: a
 * second kind of stream would then be additive.
 */
export type VideoStreamOptions = {
  type: "hls";
  /**
   * The heights of the renditions, in pixels. A rendition taller than the
   * upload is skipped; if every one is, the upload's own height is used.
   * @default [1080, 720, 480]
   */
  renditions?: number[];
  /** Target length of each segment, in seconds. @default 6 */
  segmentDuration?: number;
};

/** `false` (or absent) uploads the file as it was picked. */
export type VideoStreamOption = false | VideoStreamOptions;

export type VideoOptions = {
  /** Where uploads land. @default "/public/val" */
  dir?: string;
  /**
   * What may be UPLOADED, in `<input accept>` syntax. @default "video/*"
   *
   * Not checked against an HLS stream: the playlist is what the Studio made of
   * an upload that was accepted, not something an editor picked.
   */
  accept?: string;
  stream?: VideoStreamOption;
};

/**
 * What a SET-BACKED field (`s.video(videosVal)`) may say for itself.
 *
 * Not `VideoOptions`: `dir` and `accept` belong to the set. `stream` is the
 * exception, as `encode` is for an image: it is about what happens to an
 * upload on its way in, so a field that wants the file as it was picked,
 * where its set streams, has to be able to say `stream: false`.
 */
export type GalleryVideoOptions = {
  stream?: VideoStreamOption;
};

/**
 * The set a field picks from: its entries as they were when the module was
 * evaluated (the published set — see `GalleryImageSource` for why that is
 * enough), and whether it stores its videos on Val Remote.
 */
export type VideoGallery = {
  modulePath: string;
  /**
   * `null` for a schema that was DESERIALIZED: the serialized form names the
   * set, not its contents, so whether the set has the entry is a question
   * for the set's own module — which the Studio validates anyway.
   */
  entries: Record<string, VideosetEntryMetadata<AltSource>> | null;
  remote: boolean;
};

export type SerializedVideoSchema = {
  type: "video";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: VideoOptions;
  opt: boolean;
  remote?: boolean;
  customValidate?: boolean;
  /** The `s.videoset()` module this field picks from, if it is set-backed. */
  referencedModule?: string;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export type VideoMetadata = {
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
};

export const DEFAULT_VIDEO_ACCEPT = "video/*";
export const DEFAULT_VIDEO_RENDITIONS = [1080, 720, 480];
export const DEFAULT_VIDEO_SEGMENT_DURATION = 6;

export class VideoSchema<
  Src extends GalleryVideoSource | null,
> extends Schema<Src> {
  constructor(
    private readonly options?: VideoOptions,
    private readonly opt: boolean = false,
    protected readonly isRemote: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
    private readonly gallery: VideoGallery | null = null,
  ) {
    super();
  }

  /**
   * Describe this field.
   *
   * The description is INPUT HELP: it is shown where this field's value is
   * entered — beside its input in the Val editor, and for a record's key
   * schema in every form that asks for a key — so it is where you say what an
   * editor needs to know to fill it in RIGHT, which the field name cannot
   * carry. It is not a name for the value: that is `.preview(...)`, and it is
   * read somewhere else. The description also travels in the serialized
   * schema, which is what the AI assistant and the MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s.video().describe("Plays muted behind the headline");
   * export default c.define("/example.val.ts", schema, {
   *   path: "/public/val/example.mp4",
   *   mimeType: "video/mp4",
   * });
   */
  describe(description: string | null): VideoSchema<Src> {
    return new VideoSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
      this.gallery,
    );
  }

  /**
   * Store the video on Val's remote content host instead of in your
   * repository.
   *
   * The bytes still go into the patch store when the video is uploaded — the
   * push to the remote host happens at publish. What changes is where the
   * published video lives: `path` (and the poster's, and each caption track's)
   * becomes a remote URL rather than a path under `/public`, so the repository
   * does not grow with every upload. Upload remote videos in the Studio.
   *
   * @example
   * const schema = s.video().remote();
   * export default c.define("/example.val.ts", schema, {
   *   path: "https://remote.val.build/file/p/my-project/b/01/v/1.0.0/h/8f2a1c/f/3b9d70/p/public/val/example.mp4",
   *   mimeType: "video/mp4",
   * });
   */
  remote(): VideoSchema<Src> {
    return new VideoSchema(
      this.options,
      this.opt,
      true,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
      this.gallery,
    );
  }

  /**
   * Add a custom validation rule to this field.
   *
   * The function is called with the field's value and returns `false` when the
   * value is fine, or a STRING with the message to show when it is not. Call it
   * more than once to add more rules — they all run, and every message is
   * reported.
   *
   * Write the check as a ternary, not as `ok || "message"`: that returns `true`
   * when the value is fine, and `true` is not one of the two answers.
   *
   * Validation runs in the Studio as you type, in `npx val validate` and
   * before a publish.
   *
   * The second argument carries the `path` of the field being validated, for
   * when the message needs to say where the problem is.
   *
   * @example
   * const schema = s.video().validate((val) =>
   *   (val.duration ?? 0) <= 30 ? false : "Keep it under 30 seconds",
   * );
   * export default c.define("/example.val.ts", schema, {
   *   path: "/public/val/example.mp4",
   *   mimeType: "video/mp4",
   *   duration: 12,
   * });
   */
  validate(validationFunction: CustomValidateFunction<Src>): VideoSchema<Src> {
    return new VideoSchema(
      this.options,
      this.opt,
      this.isRemote,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
      this.gallery,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    const report = (errors: ValidationError[]): ValidationErrors => {
      const all = [...customValidationErrors, ...errors];
      return all.length > 0 ? { [path]: all } : false;
    };
    if (src === null || src === undefined) {
      if (this.opt) {
        return report([]);
      }
      return report([
        { message: `Non-optional video was null or undefined.`, value: src },
      ]);
    }
    if (typeof src !== "object" || typeof src.path !== "string") {
      return report([
        {
          message: `A video must be an object with a 'path' string.`,
          value: src,
        },
      ]);
    }

    if (this.gallery) {
      return report(this.validateFromGallery(src, this.gallery));
    }
    return report(this.validateOwn(src));
  }

  /**
   * A set-backed field: the file and what was read from it are the set's,
   * so the field is checked for what is its own, and for pointing at an
   * entry the set has.
   */
  private validateFromGallery(
    src: GalleryVideoSource,
    gallery: VideoGallery,
  ): ValidationError[] {
    const own = ownMetadataOf(src);
    const repeated = (
      ["mimeType", "width", "height", "duration"] as const
    ).filter((key) => own[key] !== undefined);
    if (repeated.length > 0) {
      return [
        {
          message: `A video from a set must not carry its own ${repeated.join(", ")}: ${repeated.length === 1 ? "it is" : "they are"} stored in the set.`,
          value: src,
        },
      ];
    }
    const entry = gallery.entries === null ? null : gallery.entries[src.path];
    if (entry === undefined) {
      return [
        {
          message: `The set does not have a video at '${src.path}'.`,
          value: src,
        },
      ];
    }
    // The poster and the captions are the field's own files, and live where
    // the set keeps its videos. The video itself is the set's to move.
    const misplaced = filesOfVideoSource(src)
      .slice(1)
      .filter((file) => isRemoteMediaPath(file) !== gallery.remote);
    if (misplaced.length > 0) {
      return [misplacedError(src, misplaced, gallery.remote)];
    }
    const duration =
      entry !== null && typeof entry.duration === "number" && entry.duration > 0
        ? entry.duration
        : undefined;
    return [
      ...validateTimes(src, duration),
      ...validateMixedTimes(src, entry),
      ...validateHotspot(src),
      ...validatePoster(src),
      ...validateCaptions(src),
    ];
  }

  /** A video of its own: it carries the file, and what was read from it. */
  private validateOwn(src: GalleryVideoSource): ValidationError[] {
    const own = ownMetadataOf(src);
    // Every file the video names has to be where the schema says, and one fix
    // moves them all — a video on the content host with its poster still in
    // the repository is half a migration, not a choice. The error is reported
    // once for the whole video, never per file.
    const misplaced = filesOfVideoSource(src).filter(
      (file) => isRemoteMediaPath(file) !== this.isRemote,
    );
    if (misplaced.length > 0) {
      return [misplacedError(src, misplaced, this.isRemote)];
    }

    const errors: ValidationError[] = [];
    const isHls = isHlsVideo({
      path: src.path,
      mimeType: stringOrUndefined(own.mimeType),
    });
    const extensionMimeType = filenameToMimeType(stripQuery(src.path));
    if (isHls) {
      if (!stripQuery(src.path).toLowerCase().endsWith(".m3u8")) {
        errors.push({
          message: `An HLS video's path must be its master playlist (.m3u8). Got: ${src.path}`,
          value: src,
        });
      }
    } else if (!extensionMimeType || !extensionMimeType.startsWith("video/")) {
      errors.push({
        message: `Could not tell this is a video from its file extension. Got: ${src.path}`,
        value: src,
      });
    } else if (
      own.mimeType !== undefined &&
      extensionMimeType !== own.mimeType
    ) {
      errors.push({
        message: `Mime type and file extension not matching. Mime type is '${String(own.mimeType)}' but file extension is '${extensionMimeType}'`,
        value: src,
      });
    }

    if (own.mimeType !== undefined && typeof own.mimeType !== "string") {
      errors.push({ message: `'mimeType' must be a string.`, value: src });
    } else if (own.mimeType !== undefined && !isHls) {
      const accept = this.options?.accept ?? DEFAULT_VIDEO_ACCEPT;
      if (!mimeTypeMatchesAccept(own.mimeType, accept)) {
        errors.push({
          message: `Mime type mismatch. Found '${own.mimeType}' but schema accepts '${accept}'`,
          value: src,
        });
      }
    }

    for (const key of ["width", "height", "duration"] as const) {
      const value = own[key];
      if (
        value !== undefined &&
        (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      ) {
        errors.push({
          message: `'${key}' must be a positive number. Got: ${JSON.stringify(value)}`,
          value: src,
        });
      }
    }
    const duration =
      typeof own.duration === "number" && own.duration > 0
        ? own.duration
        : undefined;
    errors.push(...validateTimes(src, duration));
    errors.push(...validateHotspot(src));
    errors.push(...validatePoster(src));
    errors.push(...validateCaptions(src));
    if (errors.length > 0) {
      return errors;
    }

    // Everything authored is fine. What is left is what is read from the
    // bytes, which this package cannot do — so it is handed on as a fix. The
    // CLI reads a local file's headers from disk and a remote one's over
    // HTTP, with Range requests, so neither is downloaded whole.
    const missing = (
      ["mimeType", "width", "height", "duration"] as const
    ).filter((key) => own[key] === undefined);
    if (missing.length > 0) {
      return [
        {
          message: `Video metadata is missing: ${missing.join(", ")}.`,
          value: src,
          fixes: ["video:add-metadata"],
        },
      ];
    }
    return [];
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'null'`, typeError: true },
          ],
        },
      };
    }
    if (typeof src !== "object") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected object, got '${typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (!("path" in src) || typeof src.path !== "string") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `A video must be an object with a 'path' (error type: missing_path)`,
              typeError: true,
            },
          ],
        },
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): VideoSchema<Src | null> {
    return new VideoSchema<Src | null>(
      this.options,
      true,
      this.isRemote,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
      this.gallery,
    );
  }

  readonly(isReadonly: boolean = true): VideoSchema<Src> {
    return new VideoSchema<Src>(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
      this.gallery,
    );
  }

  hidden(isHidden: boolean = true): VideoSchema<Src> {
    return new VideoSchema<Src>(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
      this.gallery,
    );
  }

  protected override executeCustomValidateAt(
    path: SourcePath,
    src: Src,
  ): ValidationError[] {
    return this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
  }

  /**
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   *
   * @example
   * const schema = s.array(s.video().render({ as: "inline" }));
   * export default c.define("/example.val.ts", schema, [
   *   { path: "/public/val/example.mp4", mimeType: "video/mp4" },
   * ]);
   */
  render(input: FieldRender): VideoSchema<Src> {
    return new VideoSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
      this.previewInput,
      this.gallery,
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   *
   * @example
   * const schema = s.array(
   *   s.video().preview(({ val }) => ({
   *     title: val.alt ?? val.path,
   *     image: val.poster,
   *   })),
   * );
   * export default c.define("/example.val.ts", schema, [
   *   { path: "/public/val/example.mp4", mimeType: "video/mp4" },
   * ]);
   */
  preview(select: ItemPreviewInput<Src>): VideoSchema<Src> {
    return new VideoSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      select,
      this.gallery,
    );
  }

  protected override executePreviewItem(
    src: NonNullable<Src>,
  ): PreviewItem | null {
    if (this.previewInput === null) {
      return null;
    }
    return this.previewInput({ val: src });
  }

  protected override declaresItemPreview(): boolean {
    return this.previewInput !== null;
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "video",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      options: this.options,
      opt: this.opt,
      remote: this.isRemote,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      referencedModule: this.gallery?.modulePath,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }
}

/**
 * Every file a video value names: the video, its poster and each caption
 * track. An HLS stream's segments are not here — they are named by its
 * playlists, not by the value.
 */
export function filesOfVideoSource(src: GalleryVideoSource): string[] {
  const files = [src.path];
  if (
    src.poster &&
    typeof src.poster === "object" &&
    typeof src.poster.path === "string"
  ) {
    files.push(src.poster.path);
  }
  if (Array.isArray(src.captions)) {
    for (const track of src.captions) {
      if (
        track &&
        typeof track === "object" &&
        typeof track.path === "string"
      ) {
        files.push(track.path);
      }
    }
  }
  return files;
}

/**
 * What the value says about its file, typed as what it IS rather than what
 * it should be: a set-backed field's type has none of these, and is checked
 * for carrying them anyway, because hand-written JSON never saw the type.
 */
function ownMetadataOf(
  src: GalleryVideoSource,
): Record<"mimeType" | "width" | "height" | "duration", unknown> {
  const value: Record<string, unknown> = { ...src };
  return {
    mimeType: value.mimeType,
    width: value.width,
    height: value.height,
    duration: value.duration,
  };
}

/**
 * A start the field set against an end the set holds, or the reverse: each is
 * fine alone, and the field's own times and the set's are each checked where
 * they are written, so what is left is the pair the page will actually play.
 */
function validateMixedTimes(
  src: GalleryVideoSource,
  entry: VideosetEntryMetadata<AltSource> | null,
): ValidationError[] {
  if (
    entry === null ||
    (src.startTime === undefined) === (src.endTime === undefined)
  ) {
    return [];
  }
  const start = src.startTime ?? entry.startTime;
  const end = src.endTime ?? entry.endTime;
  if (typeof start !== "number" || typeof end !== "number" || start < end) {
    return [];
  }
  const whose =
    src.startTime === undefined
      ? "the start is the set's"
      : "the end is the set's";
  return [
    {
      message: `'startTime' (${start}s) must be before 'endTime' (${end}s) — ${whose}.`,
      value: src,
    },
  ];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function misplacedError(
  src: GalleryVideoSource,
  misplaced: string[],
  shouldBeRemote: boolean,
): ValidationError {
  const these =
    misplaced.length === 1 ? "this file is" : `${misplaced.length} files are`;
  return shouldBeRemote
    ? {
        message: `Expected a remote video, but ${these} stored locally: ${misplaced.join(", ")}`,
        value: src,
        fixes: ["video:upload-remote"],
      }
    : {
        message: `Expected a local video (files under /public), but ${these} remote: ${misplaced.join(", ")}`,
        value: src,
        fixes: ["video:download-remote"],
      };
}

function stripQuery(path: string): string {
  return path.split("?")[0];
}

/**
 * A video picked from a set (`s.videoset()`). What is true of the file —
 * its type, size and length — lives in the set; the field carries what one
 * page chose about it.
 */
export function video(
  videosetModule: ValModule<Record<string, VideosetEntryMetadata<AltSource>>>,
  galleryOptions?: GalleryVideoOptions,
): VideoSchema<GalleryVideoSource>;
/**
 * Define a video: an `.mp4` / `.webm` file, or an HLS stream the Studio makes
 * from an upload when `stream` is set.
 */
export function video(options?: VideoOptions): VideoSchema<VideoSource>;
export function video(
  options?:
    | VideoOptions
    | ValModule<Record<string, VideosetEntryMetadata<AltSource>>>,
  galleryOptions?: GalleryVideoOptions,
): VideoSchema<VideoSource> | VideoSchema<GalleryVideoSource> {
  return videoOf(options, galleryOptions);
}

/**
 * `s.video()` for a project whose media is all remote (`files.remote` in
 * `val.config.ts`): the same schema, with `.remote()` already applied. See
 * `initSchema`.
 */
export function remoteVideo(
  videosetModule: ValModule<Record<string, VideosetEntryMetadata<AltSource>>>,
  galleryOptions?: GalleryVideoOptions,
): VideoSchema<GalleryVideoSource>;
export function remoteVideo(options?: VideoOptions): VideoSchema<VideoSource>;
export function remoteVideo(
  options?:
    | VideoOptions
    | ValModule<Record<string, VideosetEntryMetadata<AltSource>>>,
  galleryOptions?: GalleryVideoOptions,
): VideoSchema<VideoSource> | VideoSchema<GalleryVideoSource> {
  return videoOf(options, galleryOptions).remote();
}

function videoOf(
  options?:
    | VideoOptions
    | ValModule<Record<string, VideosetEntryMetadata<AltSource>>>,
  galleryOptions?: GalleryVideoOptions,
): VideoSchema<VideoSource> | VideoSchema<GalleryVideoSource> {
  if (options === undefined || !isVideosetModule(options)) {
    return new VideoSchema<VideoSource>(options);
  }
  const modulePath = getValPath(options);
  if (modulePath === undefined) {
    throw new Error(
      `Invalid argument passed to s.video(). Expected a ValModule constructed through c.define, but got an object without a valid module path.`,
    );
  }
  const setSchema = options[GetSchema]?.["executeSerialize"]();
  if (setSchema?.type !== "record" || setSchema.mediaType !== "videos") {
    throw new Error(
      `s.video(${modulePath}): the module must be an s.videoset(). Got ${setSchema?.type === "record" ? `a record of ${setSchema.mediaType ?? "values"}` : (setSchema?.type ?? "no schema")}.`,
    );
  }
  return new VideoSchema<GalleryVideoSource>(
    galleryOptions?.stream !== undefined
      ? { stream: galleryOptions.stream }
      : undefined,
    false,
    setSchema.remote ?? false,
    [],
    false,
    false,
    undefined,
    null,
    null,
    {
      modulePath,
      entries: getSource(options),
      remote: setSchema.remote ?? false,
    },
  );
}

function isVideosetModule(
  value:
    | VideoOptions
    | ValModule<Record<string, VideosetEntryMetadata<AltSource>>>,
): value is ValModule<Record<string, VideosetEntryMetadata<AltSource>>> {
  return GetSchema in value;
}
