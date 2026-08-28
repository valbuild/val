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
import { ReifiedPreview } from "../preview";
import { ImagesEntryMetadata } from "./images";
import { getSource } from "../module";

export type ImageOptions = {
  ext?: ["jpg"] | ["webp"];
  directory?: string;
  prefix?: string;
  accept?: string;
};

export type SerializedImageSchema = {
  type: "image";
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
      const acceptedTypes = accept.split(",").map((type) => type.trim());

      const isValidMimeType = acceptedTypes.some((acceptedType) => {
        if (acceptedType === "*/*") {
          return true;
        }
        if (acceptedType.endsWith("/*")) {
          const baseType = acceptedType.slice(0, -2);
          return mimeType.startsWith(baseType);
        }
        return acceptedType === mimeType;
      });

      if (!isValidMimeType) {
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
            message: `Found image metadata, but it could not be validated. An image must have a width (positive number), a height (positive number) and a mime type.`,
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
          message: `Could not validate Image metadata.`,
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

  protected executeSerialize(): SerializedSchema {
    const modulePaths = this.moduleMetadata
      ? Object.keys(this.moduleMetadata)
      : [];
    return {
      type: "image",
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
): ImageSchema<GalleryImageSource>;
/** An image of its own, carrying its own dimensions and mime type. */
export function image(options?: ImageOptions): ImageSchema<ImageSource>;
export function image(
  options?: ImageOptions | ValModule<Record<string, ImagesEntryMetadata>>,
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
      {},
      false,
      false,
      [],
      allModules,
    );
  }
  return new ImageSchema(options as ImageOptions);
}
