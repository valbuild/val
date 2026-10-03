import { isHlsVideo, isRemoteMediaPath, VideoSource } from "../source/media";
import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { ItemPreviewInput, PreviewItem } from "../preview";
import { FieldRender } from "../render";
import { filenameToMimeType, mimeTypeMatchesAccept } from "../mimeType";

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

export class VideoSchema<Src extends VideoSource | null> extends Schema<Src> {
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

    const isRemotePath = isRemoteMediaPath(src.path);
    if (this.isRemote && !isRemotePath) {
      return report([
        {
          message: `Expected a remote video, but got a local file. Upload it again in the Val Studio to store it remotely.`,
          value: src,
        },
      ]);
    }
    if (!this.isRemote && isRemotePath) {
      return report([
        {
          message: `Expected a local video (a path under /public), but found a remote one.`,
          value: src,
        },
      ]);
    }

    const errors: ValidationError[] = [];
    const isHls = isHlsVideo(src);
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
      src.mimeType !== undefined &&
      extensionMimeType !== src.mimeType
    ) {
      errors.push({
        message: `Mime type and file extension not matching. Mime type is '${src.mimeType}' but file extension is '${extensionMimeType}'`,
        value: src,
      });
    }

    if (src.mimeType !== undefined && typeof src.mimeType !== "string") {
      errors.push({ message: `'mimeType' must be a string.`, value: src });
    } else if (src.mimeType !== undefined && !isHls) {
      const accept = this.options?.accept ?? DEFAULT_VIDEO_ACCEPT;
      if (!mimeTypeMatchesAccept(src.mimeType, accept)) {
        errors.push({
          message: `Mime type mismatch. Found '${src.mimeType}' but schema accepts '${accept}'`,
          value: src,
        });
      }
    }

    for (const key of ["width", "height", "duration"] as const) {
      const value = src[key];
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
    errors.push(...validateTimes(src));
    errors.push(...validateHotspot(src));
    errors.push(...validatePoster(src));
    errors.push(...validateCaptions(src));
    if (errors.length > 0) {
      return report(errors);
    }

    // Everything authored is fine. What is left is what is read from the
    // bytes, which this package cannot do — so it is handed on as a fix. A
    // remote video's bytes are on the content host, where the Studio read them
    // before uploading; nothing local can re-read them.
    if (!isRemotePath) {
      const missing = (
        ["mimeType", "width", "height", "duration"] as const
      ).filter((key) => src[key] === undefined);
      if (missing.length > 0) {
        return report([
          {
            message: `Video metadata is missing: ${missing.join(", ")}.`,
            value: src,
            fixes: ["video:add-metadata"],
          },
        ]);
      }
    } else if (src.mimeType === undefined) {
      return report([
        { message: `A video must have a 'mimeType'.`, value: src },
      ]);
    }
    return report([]);
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
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }
}

function stripQuery(path: string): string {
  return path.split("?")[0];
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateTimes(src: VideoSource): ValidationError[] {
  const errors: ValidationError[] = [];
  const duration =
    typeof src.duration === "number" && src.duration > 0
      ? src.duration
      : undefined;
  for (const key of ["posterTime", "startTime", "endTime"] as const) {
    const value = src[key];
    if (value === undefined) {
      continue;
    }
    if (!isNonNegativeNumber(value)) {
      errors.push({
        message: `'${key}' must be a number of seconds, 0 or more. Got: ${JSON.stringify(value)}`,
        value: src,
      });
    } else if (duration !== undefined && value > duration) {
      errors.push({
        message: `'${key}' (${value}s) is after the end of the video (${duration}s).`,
        value: src,
      });
    }
  }
  if (
    isNonNegativeNumber(src.startTime) &&
    isNonNegativeNumber(src.endTime) &&
    src.startTime >= src.endTime
  ) {
    errors.push({
      message: `'startTime' (${src.startTime}s) must be before 'endTime' (${src.endTime}s).`,
      value: src,
    });
  }
  return errors;
}

function validateHotspot(src: VideoSource): ValidationError[] {
  if (src.hotspot === undefined) {
    return [];
  }
  const { hotspot } = src;
  if (
    typeof hotspot !== "object" ||
    hotspot === null ||
    typeof hotspot.x !== "number" ||
    typeof hotspot.y !== "number" ||
    hotspot.x < 0 ||
    hotspot.x > 1 ||
    hotspot.y < 0 ||
    hotspot.y > 1
  ) {
    return [
      {
        message: `'hotspot' must be { x, y } with both between 0 and 1.`,
        value: src,
      },
    ];
  }
  return [];
}

function validatePoster(src: VideoSource): ValidationError[] {
  if (src.poster === undefined) {
    return [];
  }
  const { poster } = src;
  if (
    typeof poster !== "object" ||
    poster === null ||
    typeof poster.path !== "string"
  ) {
    return [
      {
        message: `'poster' must be an image object with a 'path'.`,
        value: src,
      },
    ];
  }
  const mimeType = filenameToMimeType(stripQuery(poster.path));
  if (!mimeType || !mimeType.startsWith("image/")) {
    return [
      {
        message: `The poster must be an image. Got: ${poster.path}`,
        value: src,
      },
    ];
  }
  if (isRemoteMediaPath(poster.path) !== isRemoteMediaPath(src.path)) {
    return [
      {
        message: `The poster must be stored where the video is (${isRemoteMediaPath(src.path) ? "remote" : "local"}).`,
        value: src,
      },
    ];
  }
  return [];
}

const CAPTION_KINDS = ["subtitles", "captions"];

function validateCaptions(src: VideoSource): ValidationError[] {
  if (src.captions === undefined) {
    return [];
  }
  if (!Array.isArray(src.captions)) {
    return [{ message: `'captions' must be an array.`, value: src }];
  }
  const errors: ValidationError[] = [];
  let defaults = 0;
  const seen = new Set<string>();
  src.captions.forEach((track: unknown, i) => {
    const at = `Caption track ${i + 1}`;
    if (typeof track !== "object" || track === null || Array.isArray(track)) {
      errors.push({ message: `${at} must be an object.`, value: src });
      return;
    }
    const t = track as Record<string, unknown>;
    if (typeof t.path !== "string") {
      errors.push({ message: `${at} has no 'path'.`, value: src });
    } else if (filenameToMimeType(stripQuery(t.path)) !== "text/vtt") {
      errors.push({
        message: `${at} must be a WebVTT (.vtt) file. Got: ${t.path}`,
        value: src,
      });
    } else if (isRemoteMediaPath(t.path) !== isRemoteMediaPath(src.path)) {
      errors.push({
        message: `${at} must be stored where the video is (${isRemoteMediaPath(src.path) ? "remote" : "local"}).`,
        value: src,
      });
    }
    if (typeof t.srclang !== "string" || t.srclang.trim() === "") {
      errors.push({
        message: `${at} needs a language ('srclang'), e.g. "en".`,
        value: src,
      });
    }
    if (t.label !== undefined && typeof t.label !== "string") {
      errors.push({ message: `${at}: 'label' must be a string.`, value: src });
    }
    if (
      t.kind !== undefined &&
      (typeof t.kind !== "string" || !CAPTION_KINDS.includes(t.kind))
    ) {
      errors.push({
        message: `${at}: 'kind' must be "subtitles" or "captions".`,
        value: src,
      });
    }
    if (t.default !== undefined && typeof t.default !== "boolean") {
      errors.push({
        message: `${at}: 'default' must be true or false.`,
        value: src,
      });
    }
    if (t.default === true) {
      defaults++;
    }
    if (typeof t.srclang === "string") {
      const key = `${t.kind ?? "subtitles"}:${t.srclang}`;
      if (seen.has(key)) {
        errors.push({
          message: `${at} repeats the language '${t.srclang}'.`,
          value: src,
        });
      }
      seen.add(key);
    }
  });
  if (defaults > 1) {
    errors.push({
      message: `At most one caption track can be the default. ${defaults} are.`,
      value: src,
    });
  }
  return errors;
}

/**
 * Define a video: an `.mp4` / `.webm` file, or an HLS stream the Studio makes
 * from an upload when `stream` is set.
 */
export function video(options?: VideoOptions): VideoSchema<VideoSource> {
  return new VideoSchema(options);
}
