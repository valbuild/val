import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedRender, RenderSelector } from "../render";
import { splitRemoteRef } from "../remote/splitRemoteRef";
import { SelectorSource } from "../selector";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { ModuleFilePath, SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { StringSchema, string } from "./string";
import { RecordSchema } from "./record";
import { ImageSource } from "../source/image";
import { RemoteSource } from "../source/remote";
import { ImageMetadata } from "./image";

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

export type SerializedImagesSchema = {
  type: "images";
  accept: string;
  directory: string;
  alt: SerializedSchema;
  opt: boolean;
  remote: boolean;
  customValidate?: boolean;
};

export class ImagesSchema<
  Accept extends `image/${string}`,
  Src extends Record<string, ImagesEntryMetadata> | null,
> extends Schema<Src> {
  private readonly directory: "/public" | `/public/${string}`;
  private readonly altSchema: AltSchema;

  constructor(
    private readonly options: ImagesOptions<Accept>,
    private readonly opt: boolean = false,
    private readonly isRemote: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
  ) {
    super();
    this.directory = options.directory ?? "/public/val";
    this.altSchema = options.alt ?? string().nullable();
  }

  remote(): ImagesSchema<Accept, Src> {
    return new ImagesSchema(
      this.options,
      this.opt,
      true,
      this.customValidateFunctions,
    );
  }

  validate(
    validationFunction: CustomValidateFunction<Src>,
  ): ImagesSchema<Accept, Src> {
    return new ImagesSchema(this.options, this.opt, this.isRemote, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;
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
          { message: `Non-optional images was null or undefined.`, value: src },
        ],
      } as ValidationErrors;
    }

    if (typeof src !== "object") {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }

    if (Array.isArray(src)) {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got 'array'`, value: src },
        ],
      } as ValidationErrors;
    }

    for (const customValidationError of customValidationErrors) {
      error = this.appendValidationError(
        error,
        path,
        customValidationError.message,
        src,
        customValidationError.schemaError,
      );
    }

    // Validate each entry
    for (const [key, entry] of Object.entries(src)) {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${path} for key ${key}`,
          src,
        );
        continue;
      }

      // Validate key is either a valid local path or remote URL
      const keyError = this.validateKey(subPath, key);
      if (keyError) {
        if (error) {
          error = { ...error, ...keyError };
        } else {
          error = keyError;
        }
      }

      // Validate entry metadata
      const entryError = this.validateEntry(
        subPath,
        entry as ImagesEntryMetadata,
      );
      if (entryError) {
        if (error) {
          error = { ...error, ...entryError };
        } else {
          error = entryError;
        }
      }
    }

    return error;
  }

  private isRemoteUrl(url: string): boolean {
    return url.startsWith("https://") || url.startsWith("http://");
  }

  private validateKey(path: SourcePath, key: string): ValidationErrors {
    const isRemoteUrl = this.isRemoteUrl(key);
    const isLocalPath = key.startsWith(this.directory);

    if (this.isRemote) {
      // When remote is enabled, accept either remote URLs or local paths
      if (isRemoteUrl) {
        // Validate remote URL format using splitRemoteRef
        const remoteResult = splitRemoteRef(key);
        if (remoteResult.status === "error") {
          return {
            [path]: [
              {
                message: `Invalid remote URL format. Use Val tooling (CLI, VS Code extension, or Val Studio) to upload images. Got: ${key}`,
                value: key,
                fixes: ["images:check-remote"],
              },
            ],
          };
        }
        // Check that the file path in the remote URL matches our directory constraint
        const remotePath = "/" + remoteResult.filePath;
        if (!remotePath.startsWith(this.directory)) {
          return {
            [path]: [
              {
                message: `Remote file path '${remotePath}' is not in expected directory '${this.directory}'. Use Val tooling to upload images to the correct directory.`,
                value: key,
                fixes: ["images:check-remote"],
              },
            ],
          };
        }
        return false;
      }
      if (!isLocalPath) {
        return {
          [path]: [
            {
              message: `Expected a remote URL (https://...) or a local path starting with ${this.directory}/. Got: ${key}`,
              value: key,
            },
          ],
        };
      }
    } else {
      // When remote is disabled, only accept local paths
      if (isRemoteUrl) {
        return {
          [path]: [
            {
              message: `Remote URLs are not allowed. Use .remote() to enable remote images. Got: ${key}`,
              value: key,
              fixes: ["images:check-remote"],
            },
          ],
        };
      }
      if (!isLocalPath) {
        return {
          [path]: [
            {
              message: `File path must be within the ${this.directory}/ directory. Got: ${key}`,
              value: key,
            },
          ],
        };
      }
    }

    return false;
  }

  private validateEntry(
    path: SourcePath,
    entry: ImagesEntryMetadata,
  ): ValidationErrors {
    if (typeof entry !== "object" || entry === null) {
      return {
        [path]: [
          { message: `Expected 'object', got '${typeof entry}'`, value: entry },
        ],
      };
    }

    const errors: ValidationError[] = [];

    // Validate width
    if (typeof entry.width !== "number" || entry.width <= 0) {
      errors.push({
        message: `Expected 'width' to be a positive number, got '${entry.width}'`,
        value: entry,
      });
    }

    // Validate height
    if (typeof entry.height !== "number" || entry.height <= 0) {
      errors.push({
        message: `Expected 'height' to be a positive number, got '${entry.height}'`,
        value: entry,
      });
    }

    // Validate mimeType
    if (typeof entry.mimeType !== "string") {
      errors.push({
        message: `Expected 'mimeType' to be a string, got '${typeof entry.mimeType}'`,
        value: entry,
      });
    } else {
      // Validate against accept pattern
      const mimeTypeError = this.validateMimeType(entry.mimeType);
      if (mimeTypeError) {
        errors.push({ message: mimeTypeError, value: entry });
      }
    }

    // Validate hotspot if present
    if (entry.hotspot !== undefined) {
      if (
        typeof entry.hotspot !== "object" ||
        typeof entry.hotspot.x !== "number" ||
        typeof entry.hotspot.y !== "number"
      ) {
        errors.push({
          message: `Hotspot must be an object with x and y as numbers.`,
          value: entry,
        });
      }
    }

    // Validate alt using the alt schema
    const altPath = createValPathOfItem(path, "alt");
    if (altPath) {
      // Cast to Schema to access protected method
      const altSchemaAsSchema = this
        .altSchema as unknown as Schema<SelectorSource>;
      const altError = altSchemaAsSchema["executeValidate"](
        altPath,
        entry.alt as SelectorSource,
      );
      if (altError) {
        return altError;
      }
    }

    if (errors.length > 0) {
      return { [path]: errors };
    }

    return false;
  }

  private validateMimeType(mimeType: string): string | null {
    const { accept } = this.options;

    if (!mimeType.includes("/")) {
      return `Invalid mime type format. Got: '${mimeType}'`;
    }

    const acceptedTypes = accept.split(",").map((type) => type.trim());

    const isValidMimeType = acceptedTypes.some((acceptedType) => {
      if (acceptedType === "image/*") {
        return mimeType.startsWith("image/");
      }
      if (acceptedType.endsWith("/*")) {
        const baseType = acceptedType.slice(0, -2);
        return mimeType.startsWith(baseType);
      }
      return acceptedType === mimeType;
    });

    if (!isValidMimeType) {
      return `Mime type mismatch. Found '${mimeType}' but schema accepts '${accept}'`;
    }

    return null;
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

    if (Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'array'`, typeError: true },
          ],
        },
      };
    }

    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): ImagesSchema<Accept, Src | null> {
    return new ImagesSchema<Accept, Src | null>(
      this.options,
      true,
      this.isRemote,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
    );
  }

  protected executeSerialize(): SerializedImagesSchema {
    // Cast to Schema to access protected method
    const altSchemaAsSchema = this
      .altSchema as unknown as Schema<SelectorSource>;
    return {
      type: "images",
      accept: this.options.accept,
      directory: this.directory,
      alt: altSchemaAsSchema["executeSerialize"](),
      opt: this.opt,
      remote: this.isRemote,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  private renderInput: {
    layout: "list";
    select: (input: {
      key: string;
      val: RenderSelector<Schema<ImagesEntryMetadata>>;
    }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    };
  } | null = null;

  protected executeRender(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
  ): ReifiedRender {
    const res: ReifiedRender = {};
    if (src === null) {
      return res;
    }
    // Images don't have nested render logic, so we just return empty
    return res;
  }

  render(input: {
    as: "list";
    select: (input: {
      key: string;
      val: RenderSelector<Schema<ImagesEntryMetadata>>;
    }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    };
  }) {
    this.renderInput = {
      layout: input.as,
      select: input.select,
    };
    return this;
  }
}

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
): ImagesSchema<Accept, Record<string, ImagesEntryMetadata>> => {
  return new ImagesSchema(options);
};
