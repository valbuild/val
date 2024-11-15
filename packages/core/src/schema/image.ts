/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { VAL_EXTENSION } from "../source";
import { FileSource, FILE_REF_PROP } from "../source/file";
import { ImageSource } from "../source/image";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";
import { Internal } from "..";

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
};

export type ImageMetadata = {
  width: number;
  height: number;
  mimeType: string;
  hotspot?: {
    x: number;
    y: number;
  };
};
export class ImageSchema<
  Src extends FileSource<ImageMetadata | undefined> | null,
> extends Schema<Src> {
  constructor(
    readonly options?: ImageOptions,
    readonly opt: boolean = false,
  ) {
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
            message: `Non-optional image was null or undefined.`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (typeof src[FILE_REF_PROP] !== "string") {
      return {
        [path]: [
          {
            message: `Image did not have a file reference string. Got: ${typeof src[
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
            message: `Image did not have the valid file extension type. Got: ${src[VAL_EXTENSION]}`,
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
            message: `Invalid mime type format. Got: '${mimeType}'`,
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

    if (fileMimeType && mimeType && fileMimeType !== mimeType) {
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
      if (src.metadata.hotspot) {
        if (
          typeof src.metadata.hotspot !== "object" ||
          typeof src.metadata.hotspot.x !== "number" ||
          typeof src.metadata.hotspot.y !== "number"
        ) {
          return {
            [path]: [
              {
                message: `Hotspot must be an object with x and y as numbers.`,
                value: src,
              },
            ],
          } as ValidationErrors;
        }
      }
      return {
        [path]: [
          {
            message: `Found metadata, but it could not be validated. Image metadata must be an object with the required props: width (positive number), height (positive number) and the mime type.`, // These validation errors will have to be picked up by logic outside of this package and revalidated. Reasons: 1) we have to read files to verify the metadata, which is handled differently in different runtimes (Browser, QuickJS, Node.js); 2) we want to keep this package dependency free.
            value: src,
            fixes: ["image:replace-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    return {
      [path]: [
        {
          message: `Could not validate Image metadata.`,
          value: src,
          fixes: ["image:add-metadata"],
        },
      ],
    } as ValidationErrors;
  }

  assert(path: SourcePath, src: unknown): SchemaAssertResult<Src> {
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
    if (!(FILE_REF_PROP in src)) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Value of this schema must use: 'c.image' (error type: missing_ref_prop)`,
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
              message: `Value of this schema must use: 'c.image' (error type: missing_file_extension)`,
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
    return new ImageSchema<Src | null>(this.options, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "image",
      options: this.options,
      opt: this.opt,
    };
  }
}

export const image = (options?: ImageOptions): Schema<ImageSource> => {
  return new ImageSchema(options);
};
