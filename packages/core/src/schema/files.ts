import { CustomValidateFunction, Schema, SchemaAssertResult } from ".";
import { ReifiedRender, RenderSelector } from "../render";
import { splitRemoteRef } from "../remote/splitRemoteRef";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { ModuleFilePath, SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { ImageSource } from "../source/image";
import { RemoteSource } from "../source/remote";
import { ImageMetadata } from "./image";

/**
 * Options for s.files()
 */
export type FilesOptions = {
  /**
   * The accepted mime type pattern (e.g., "application/pdf", "text/*", "*\/*")
   */
  accept: string;
  /**
   * The directory where files should be stored.
   * Must start with "/public" (e.g., "/public/val/files")
   * @default "/public/val"
   */
  directory?: "/public" | `/public/${string}`;
  /**
   * Whether remote files are allowed
   * @default false
   */
  remote?: boolean;
};

/**
 * Metadata for a file entry in the files record
 */
export type FilesEntryMetadata = {
  mimeType: string;
};

export type SerializedFilesSchema = {
  type: "files";
  accept: string;
  directory: string;
  opt: boolean;
  remote: boolean;
  customValidate?: boolean;
};

export class FilesSchema<
  Src extends Record<string, FilesEntryMetadata> | null,
> extends Schema<Src> {
  private readonly directory: "/public" | `/public/${string}`;

  constructor(
    private readonly options: FilesOptions,
    private readonly opt: boolean = false,
    private readonly isRemote: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
  ) {
    super();
    this.directory = options.directory ?? "/public/val";
  }

  remote(): FilesSchema<Src> {
    return new FilesSchema(
      this.options,
      this.opt,
      true,
      this.customValidateFunctions,
    );
  }

  validate(validationFunction: CustomValidateFunction<Src>): FilesSchema<Src> {
    return new FilesSchema(this.options, this.opt, this.isRemote, [
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
          { message: `Non-optional files was null or undefined.`, value: src },
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
        entry as FilesEntryMetadata,
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
                message: `Invalid remote URL format. Use Val tooling (CLI, VS Code extension, or Val Studio) to upload files. Got: ${key}`,
                value: key,
                fixes: ["files:check-remote"],
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
                message: `Remote file path '${remotePath}' is not in expected directory '${this.directory}'. Use Val tooling to upload files to the correct directory.`,
                value: key,
                fixes: ["files:check-remote"],
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
              message: `Remote URLs are not allowed. Use .remote() to enable remote files. Got: ${key}`,
              value: key,
              fixes: ["files:check-remote"],
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
    entry: FilesEntryMetadata,
  ): ValidationErrors {
    if (typeof entry !== "object" || entry === null) {
      return {
        [path]: [
          { message: `Expected 'object', got '${typeof entry}'`, value: entry },
        ],
      };
    }

    const errors: ValidationError[] = [];

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

  nullable(): FilesSchema<Src | null> {
    return new FilesSchema<Src | null>(
      this.options,
      true,
      this.isRemote,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
    );
  }

  protected executeSerialize(): SerializedFilesSchema {
    return {
      type: "files",
      accept: this.options.accept,
      directory: this.directory,
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
      val: RenderSelector<Schema<FilesEntryMetadata>>;
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
    // Files don't have nested render logic, so we just return empty
    return res;
  }

  render(input: {
    as: "list";
    select: (input: {
      key: string;
      val: RenderSelector<Schema<FilesEntryMetadata>>;
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
 * Define a collection of files.
 *
 * @example
 * ```typescript
 * const schema = s.files({
 *   accept: "application/pdf",
 *   directory: "/public/val/documents",
 * });
 * export default c.define("/content/documents.val.ts", schema, {
 *   "/public/val/documents/report.pdf": {
 *     mimeType: "application/pdf",
 *   },
 * });
 * ```
 */
export const files = (
  options: FilesOptions,
): FilesSchema<Record<string, FilesEntryMetadata>> => {
  return new FilesSchema(options);
};
