import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import {
  GalleryImageSource,
  ImageSource,
  isRemoteMediaPath,
} from "../source/media";
import { getValPath, ModulePath, SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { Internal, ValModule } from "..";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { ImagesEntryMetadata } from "./images";
import { getSource } from "../module";
import { mimeTypeMatchesAccept } from "../mimeType";

/**
 * How an uploaded image is re-encoded in the browser, before it is uploaded.
 *
 * Off unless a schema asks for it. When it is on, the image is converted to
 * `type` and scaled down to fit `maxWidth` x `maxHeight` - unless the result
 * would be BIGGER than the original and no downscale was needed, in which case
 * the original bytes are kept. See `architecture/media.md`.
 *
 * `type` is required so that adding a format later is additive: a schema
 * written today keeps saying exactly which format it asked for.
 */
export type ImageEncodeOptions = {
  type: "webp";
  /** Passed to `canvas.toBlob`. Between 0 and 1. @default 0.8 */
  quality?: number;
  /** @default 2560 */
  maxWidth?: number;
  /** @default 2560 */
  maxHeight?: number;
};

/** `false` (or absent) uploads the bytes exactly as the editor picked them. */
export type ImageEncodeOption = false | ImageEncodeOptions;

/**
 * What a GALLERY-BACKED field may say for itself.
 *
 * Not `ImageOptions`: `directory` and `accept` belong to the gallery, and a
 * field repeating them is how two copies of one fact get to disagree. `encode`
 * is different — it describes what happens to the bytes on their way IN, so a
 * field that wants the original where its gallery re-encodes has to be able to
 * say `encode: false`, and there is nowhere else to say it.
 */
export type GalleryImageOptions = {
  encode?: ImageEncodeOption;
};

export type ImageOptions = {
  directory?: string;
  accept?: string;
  encode?: ImageEncodeOption;
};

export type SerializedImageSchema = {
  type: "image";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: ImageOptions;
  opt: boolean;
  remote?: boolean;
  customValidate?: boolean;
  referencedModule?: string;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export type ImageMetadata = {
  width?: number;
  height?: number;
  mimeType?: string;
  alt?: string;
  hotspot?: {
    x: number;
    y: number;
  };
};
export class ImageSchema<Src extends ImageSource | null> extends Schema<Src> {
  constructor(
    private readonly options?: ImageOptions,
    private readonly opt: boolean = false,
    protected readonly isRemote: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly moduleMetadata: Record<
      ModulePath,
      Record<string, ImagesEntryMetadata>
    > = {},
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
  ) {
    super();
  }

  describe(description: string | null): ImageSchema<Src> {
    return new ImageSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
    );
  }

  remote(): ImageSchema<Src> {
    return new ImageSchema(
      this.options,
      this.opt,
      true,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  validate(validationFunction: CustomValidateFunction<Src>): ImageSchema<Src> {
    return new ImageSchema(
      this.options,
      this.opt,
      this.isRemote,
      [...this.customValidateFunctions, validationFunction],
      this.moduleMetadata,
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
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (src === null || src === undefined) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Non-optional image was null or undefined.`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (typeof src.path !== "string") {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Image did not have a path string. Got: ${typeof src.path}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    // Remote-ness is a property of the path, not of a marker on the value:
    // anything outside /public is remote.
    const isRemotePath = isRemoteMediaPath(src.path);
    if (this.isRemote && !isRemotePath) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected a remote image, but got a local image.`,
            value: src,
            fixes: ["image:upload-remote"],
          },
        ],
      } as ValidationErrors;
    }
    if (this.isRemote && isRemotePath) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Remote image was not checked.`,
            value: src,
            fixes: ["image:check-remote"],
          },
        ],
      } as ValidationErrors;
    }
    if (!this.isRemote && isRemotePath) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected local image, but found remote.`,
            value: src,
            fixes: ["image:download-remote"],
          },
        ],
      } as ValidationErrors;
    }

    if (src.hotspot !== undefined) {
      if (
        typeof src.hotspot !== "object" ||
        src.hotspot === null ||
        typeof src.hotspot.x !== "number" ||
        typeof src.hotspot.y !== "number"
      ) {
        return {
          [path]: [
            ...customValidationErrors,
            {
              message: `Hotspot must be an object with x and y as numbers.`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    }

    const galleryEntries = this.galleryEntries();
    if (galleryEntries) {
      // The dimensions and mime type of a gallery image are stored once, in the
      // gallery. Repeating them on the field is how the two get to disagree.
      const repeated = (["width", "height", "mimeType"] as const).filter(
        (key) => src[key] !== undefined,
      );
      if (repeated.length > 0) {
        return {
          [path]: [
            ...customValidationErrors,
            {
              message: `An image from a gallery must not carry its own ${repeated.join(", ")}: ${repeated.length === 1 ? "it is" : "they are"} stored in the gallery module.`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
      if (!(src.path in galleryEntries)) {
        return {
          [path]: [
            ...customValidationErrors,
            {
              message: `The gallery does not have an image at '${src.path}'.`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
      return customValidationErrors.length > 0
        ? ({ [path]: customValidationErrors } as ValidationErrors)
        : false;
    }

    const { accept } = this.options || {};
    const mimeType = src.mimeType ?? "";

    if (accept && mimeType && !mimeType.includes("/")) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Invalid mime type format. Got: '${mimeType}'`,
            value: src,
            fixes: ["image:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    if (accept && mimeType && mimeType.includes("/")) {
      if (!mimeTypeMatchesAccept(mimeType, accept)) {
        return {
          [path]: [
            ...customValidationErrors,
            {
              message: `Mime type mismatch. Found '${mimeType}' but schema accepts '${accept}'`,
              value: src,
              fixes: ["image:check-metadata"],
            },
          ],
        } as ValidationErrors;
      }
    }

    const fileMimeType = Internal.filenameToMimeType(src.path);
    if (!fileMimeType) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Could not determine mime type from file extension. Got: ${src.path}`,
            value: src,
            fixes: ["image:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    if (fileMimeType && mimeType && fileMimeType !== mimeType) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Mime type and file extension not matching. Mime type is '${mimeType}' but file extension is '${fileMimeType}'`,
            value: src,
            fixes: ["image:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    // Whether the dimensions match the bytes can only be answered by reading
    // the file, which this package deliberately cannot do — so it is always
    // handed on as a fix.
    if (
      src.width !== undefined ||
      src.height !== undefined ||
      src.mimeType !== undefined
    ) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Image metadata has not been checked against the file.`,
            value: src,
            fixes: ["image:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    return {
      [path]: [
        ...customValidationErrors,
        {
          message: `Image metadata is missing: width, height and mimeType.`,
          value: src,
          fixes: ["image:add-metadata"],
        },
      ],
    } as ValidationErrors;
  }

  /**
   * The entries of the gallery this field points at, or null when it is a
   * standalone field.
   */
  private galleryEntries(): Record<string, ImagesEntryMetadata> | null {
    const modulePaths = Object.keys(this.moduleMetadata);
    if (modulePaths.length === 0) {
      return null;
    }
    return this.moduleMetadata[modulePaths[0] as ModulePath];
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
              message: `Expected 'object', got '${typeof src}'`,
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
              message: `An image must be an object with a 'path' (error type: missing_path)`,
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

  nullable(): ImageSchema<Src | null> {
    return new ImageSchema<Src | null>(
      this.options,
      true,
      this.isRemote,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(): ImageSchema<Src> {
    return new ImageSchema<Src>(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      true,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(): ImageSchema<Src> {
    return new ImageSchema<Src>(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      true,
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
   */
  render(input: FieldRender): ImageSchema<Src> {
    return new ImageSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
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
   */
  preview(select: ItemPreviewInput<Src>): ImageSchema<Src> {
    return new ImageSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
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
    const modulePaths = this.moduleMetadata
      ? Object.keys(this.moduleMetadata)
      : [];
    return {
      type: "image",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      options: this.options,
      opt: this.opt,
      remote: this.isRemote,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      referencedModule:
        modulePaths.length > 0 ? (modulePaths[0] as string) : undefined,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

/**
 * An image picked from a gallery. Its dimensions and mime type live in the
 * gallery, so the field carries only what a person typed.
 */
export function image(
  galleryModule: ValModule<Record<string, ImagesEntryMetadata>>,
  galleryOptions?: GalleryImageOptions,
): ImageSchema<GalleryImageSource>;
/** An image of its own, carrying its own dimensions and mime type. */
export function image(options?: ImageOptions): ImageSchema<ImageSource>;
export function image(
  options?: ImageOptions | ValModule<Record<string, ImagesEntryMetadata>>,
  galleryOptions?: GalleryImageOptions,
): ImageSchema<ImageSource> | ImageSchema<GalleryImageSource> {
  const isModule =
    !!options &&
    !!Internal.getValPath(
      options as ValModule<Record<string, ImagesEntryMetadata>>,
    );
  if (isModule) {
    const allModules: Record<string, Record<string, ImagesEntryMetadata>> = {};
    for (const valModule of [
      options as ValModule<Record<string, ImagesEntryMetadata>>,
    ]) {
      const modulePath = getValPath(valModule) as ModulePath | undefined;
      if (modulePath === undefined) {
        throw new Error(
          `Invalid argument passed to s.image(). Expected a ValModule constructed through c.define, but got an object without a valid module path.`,
        );
      }
      allModules[modulePath] = getSource(valModule) as Record<
        string,
        ImagesEntryMetadata
      >;
    }
    return new ImageSchema<GalleryImageSource>(
      galleryOptions?.encode !== undefined
        ? { encode: galleryOptions.encode }
        : {},
      false,
      false,
      [],
      allModules,
    );
  }
  return new ImageSchema(options as ImageOptions);
}
