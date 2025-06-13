import { Json } from "../Json";
import { FILE_REF_PROP, FileSource } from "../source/file";
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { VAL_EXTENSION } from "../source";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { Internal, RemoteSource } from "..";
import { ReifiedPreview } from "../preview";

export type FileOptions = {
  accept?: string;
};

export type SerializedFileSchema = {
  type: "file";
  options?: FileOptions;
  remote?: boolean;
  opt: boolean;
};

export type FileMetadata = {
  mimeType?: string;
};
export class FileSchema<
  Src extends
    | FileSource<FileMetadata | undefined>
    | RemoteSource<FileMetadata | undefined>
    | null,
> extends Schema<Src> {
  constructor(
    private readonly options?: FileOptions,
    private readonly opt: boolean = false,
    protected readonly isRemote: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
  ) {
    super();
  }

  remote(): FileSchema<Src | RemoteSource<FileMetadata | undefined>> {
    return new FileSchema(this.options, this.opt, true);
  }

  validate(validationFunction: CustomValidateFunction<Src>): FileSchema<Src> {
    return new FileSchema(this.options, this.opt, this.isRemote, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions);
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
            message: `Non-optional file was null or undefined.`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (typeof src[FILE_REF_PROP] !== "string") {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `File did not have a file reference string. Got: ${typeof src[
              FILE_REF_PROP
            ]}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (this.isRemote && src[VAL_EXTENSION] !== "remote") {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected a remote file, but got a local file.`,
            value: src,
            fixes: ["file:upload-remote"],
          },
        ],
      } as ValidationErrors;
    }
    if (this.isRemote && src[VAL_EXTENSION] === "remote") {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Remote file was not checked.`,
            value: src,
            fixes: ["file:check-remote"],
          },
        ],
      } as ValidationErrors;
    }
    if (!this.isRemote && src[VAL_EXTENSION] === "remote") {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected locale file, but found remote.`,
            value: src,
            fixes: ["file:download-remote"],
          },
        ],
      } as ValidationErrors;
    }

    if (src[VAL_EXTENSION] !== "file") {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `File did not have the valid file extension type. Got: ${src[VAL_EXTENSION]}`,
            value: src,
            fixes: ["file:change-extension", "file:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    const { accept } = this.options || {};
    const { mimeType } = src.metadata || {};

    if (accept && mimeType && !mimeType.includes("/")) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Invalid mime type format. Got: ${mimeType}`,
            value: src,
            fixes: ["file:change-extension", "file:check-metadata"],
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
              fixes: ["file:change-extension", "file:check-metadata"],
            },
          ],
        } as ValidationErrors;
      }
    }

    const fileMimeType = Internal.filenameToMimeType(src[FILE_REF_PROP]);
    if (!fileMimeType) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Could not determine mime type from file extension. Got: ${src[FILE_REF_PROP]}`,
            value: src,
            fixes: ["file:change-extension", "file:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    if (fileMimeType !== mimeType) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Mime type and file extension not matching. Mime type is '${mimeType}' but file extension is '${fileMimeType}'`,
            value: src,
            fixes: ["file:change-extension", "file:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    if (src.metadata) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Found metadata, but it could not be validated. File metadata must be an object with the mimeType.`, // These validation errors will have to be picked up by logic outside of this package and revalidated. Reasons: 1) we have to read files to verify the metadata, which is handled differently in different runtimes (Browser, QuickJS, Node.js); 2) we want to keep this package dependency free.
            value: src,
            fixes: ["file:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    return {
      [path]: [
        ...customValidationErrors,
        {
          message: `Missing File metadata.`,
          value: src,
          fixes: ["file:add-metadata"],
        },
      ],
    } as ValidationErrors;
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
    if (!(FILE_REF_PROP in src)) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Value of this schema must use: 'c.file' (error type: missing_ref_prop)`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (!(VAL_EXTENSION in src && src[VAL_EXTENSION] === "file")) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Value of this schema must use: 'c.file' (error type: missing_file_extension)`,
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

  nullable(): Schema<Src | null> {
    return new FileSchema<Src | null>(this.options, true);
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "file",
      options: this.options,
      opt: this.opt,
      remote: this.isRemote,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const file = (
  options?: FileOptions,
): FileSchema<FileSource<FileMetadata>> => {
  return new FileSchema(options);
};

export function convertFileSource<
  Metadata extends { readonly [key: string]: Json } | undefined =
    | { readonly [key: string]: Json }
    | undefined,
>(src: FileSource<Metadata>): { url: string; metadata?: Metadata } {
  // TODO: /public should be configurable
  if (!src[FILE_REF_PROP].startsWith("/public")) {
    return {
      url:
        src[FILE_REF_PROP] +
        (src.patch_id ? `?patch_id=${src["patch_id"]}` : ""),
      metadata: src.metadata,
    };
  }

  if (src.patch_id) {
    return {
      url:
        "/api/val/files" + src[FILE_REF_PROP] + `?patch_id=${src["patch_id"]}`,
      metadata: src.metadata,
    };
  }
  return {
    url: src[FILE_REF_PROP].slice("/public".length),
    metadata: src.metadata,
  };
}
