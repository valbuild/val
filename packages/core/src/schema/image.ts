/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { VAL_EXTENSION } from "../source";
import { FileSource, FILE_REF_PROP } from "../source/file";
import { ImageSource } from "../source/image";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type ImageOptions = {
  ext?: ["jpg"] | ["webp"];
  directory?: string;
  prefix?: string;
};

export type SerializedImageSchema = {
  type: "image";
  options?: ImageOptions;
  opt: boolean;
};

export type ImageMetadata = {
  width: number;
  height: number;
  sha256: string;
  mimeType: string;
  hotspot?: {
    x: number;
    y: number;
    height: number;
    width: number;
  };
};
export class ImageSchema<
  Src extends FileSource<ImageMetadata | undefined> | null
> extends Schema<Src> {
  constructor(readonly options?: ImageOptions, readonly opt: boolean = false) {
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
    if (src.metadata) {
      return {
        [path]: [
          {
            message: `Found metadata, but it could not be validated. Image metadata must be an object with the required props: width (positive number), height (positive number) and sha256 (string of length 64 of the base16 hash).`, // These validation errors will have to be picked up by logic outside of this package and revalidated. Reasons: 1) we have to read files to verify the metadata, which is handled differently in different runtimes (Browser, QuickJS, Node.js); 2) we want to keep this package dependency free.
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

  assert(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return src?.[FILE_REF_PROP] === "image" && src?.[VAL_EXTENSION] === "file";
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
