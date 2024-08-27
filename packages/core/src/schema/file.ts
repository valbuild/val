import { Json } from "../Json";
import { FILE_REF_PROP, FileSource } from "../source/file";
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { VAL_EXTENSION } from "../source";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";
import { Internal } from "..";

export type FileOptions = {
  accept?: string;
};

export type SerializedFileSchema = {
  type: "file";
  options?: FileOptions;
  opt: boolean;
};

export type FileMetadata = {
  sha256: string;
  mimeType?: string;
};
export class FileSchema<
  Src extends FileSource<FileMetadata | undefined> | null
> extends Schema<Src> {
  constructor(readonly options?: FileOptions, readonly opt: boolean = false) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (src === null || src === undefined) {
      return {
        [path]: [
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
          {
            message: `File did not have a file reference string. Got: ${typeof src[
              FILE_REF_PROP
            ]}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }

    if (src[VAL_EXTENSION] !== "file") {
      return {
        [path]: [
          {
            message: `File did not have the valid file extension type. Got: ${src[VAL_EXTENSION]}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }

    const { accept } = this.options || {};
    const { mimeType } = src.metadata || {};

    if (accept && mimeType && !mimeType.includes("/")) {
      return {
        [path]: [
          {
            message: `Invalid mime type format. Got: ${mimeType}`,
            value: src,
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
            {
              message: `Mime type mismatch. Found '${mimeType}' but schema accepts '${accept}'`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    }

    const fileMimeType = Internal.filenameToMimeType(src[FILE_REF_PROP]);
    if (!fileMimeType) {
      return {
        [path]: [
          {
            message: `Could not determine mime type from file extension. Got: ${src[FILE_REF_PROP]}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }

    if (fileMimeType !== mimeType) {
      return {
        [path]: [
          {
            message: `Mime type and file extension not matching. Mime type is '${mimeType}' but file extension is '${fileMimeType}'`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }

    if (src.metadata) {
      return {
        [path]: [
          {
            message: `Found metadata, but it could not be validated. File metadata must be an object with the required props: width (positive number), height (positive number) and sha256 (string of length 64 of the base16 hash).`, // These validation errors will have to be picked up by logic outside of this package and revalidated. Reasons: 1) we have to read files to verify the metadata, which is handled differently in different runtimes (Browser, QuickJS, Node.js); 2) we want to keep this package dependency free.
            value: src,
            fixes: ["file:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    return {
      [path]: [
        {
          message: `Missing File metadata.`,
          value: src,
          fixes: ["file:add-metadata"],
        },
      ],
    } as ValidationErrors;
  }

  assert(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return src?.[FILE_REF_PROP] === "file" && src?.[VAL_EXTENSION] === "file";
  }

  nullable(): Schema<Src | null> {
    return new FileSchema<Src | null>(this.options, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "file",
      options: this.options,
      opt: this.opt,
    };
  }
}

export const file = (
  options?: FileOptions
): Schema<FileSource<FileMetadata>> => {
  return new FileSchema(options);
};

export function convertFileSource<
  Metadata extends { readonly [key: string]: Json } | undefined =
    | { readonly [key: string]: Json }
    | undefined
>(src: FileSource<Metadata>): { url: string; metadata?: Metadata } {
  // TODO: /public should be configurable
  if (!src[FILE_REF_PROP].startsWith("/public")) {
    return {
      url:
        src[FILE_REF_PROP] +
        (src.metadata?.sha256 ? `?sha256=${src.metadata?.sha256}` : "") + // TODO: remove sha256? we do not need anymore
        (src.patch_id
          ? `${src.metadata?.sha256 ? "&" : "?"}patch_id=${src["patch_id"]}`
          : ""),
      metadata: src.metadata,
    };
  }

  return {
    url:
      src[FILE_REF_PROP].slice("/public".length) +
      (src.metadata?.sha256 ? `?sha256=${src.metadata?.sha256}` : "") +
      (src.patch_id
        ? `${src.metadata?.sha256 ? "&" : "?"}patch_id=${src["patch_id"]}`
        : ""),
    metadata: src.metadata,
  };
}
