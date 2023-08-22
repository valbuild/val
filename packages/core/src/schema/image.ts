/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { VAL_EXTENSION } from "../source";
import { FileSource, FILE_REF_PROP } from "../source/file";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type ImageOptions = {
  ext: ["jpg"] | ["webp"];
  directory?: string;
  prefix?: string;
};

export type SerializedImageSchema = {
  type: "image";
  options?: ImageOptions;
  opt: boolean;
};

export type ImageMetadata =
  | {
      width: number;
      height: number;
      sha256: string;
    }
  | undefined;
export class ImageSchema<
  Src extends FileSource<ImageMetadata> | null
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
    if (typeof src.metadata !== "object") {
      return {
        [path]: [
          {
            message: `Image files must include a metadata object with the sha256, width, height.`,
            value: src,
            fixes: ["image:add-metadata"],
          },
        ],
      } as ValidationErrors;
    }
    if (
      typeof src.metadata !== "object" ||
      typeof src.metadata.sha256 !== "string" ||
      src.metadata.sha256.length !== 64 ||
      !/^[a-f0-9]+$/.test(src.metadata.sha256) ||
      typeof src.metadata.width !== "number" ||
      typeof src.metadata.height !== "number" ||
      src.metadata.width < 0 || // TODO: accept 0 or not?
      src.metadata.height < 0
    ) {
      return {
        [path]: [
          {
            message: `Image metadata must be an object with the required props: width (positive number), height (positive number) and sha256 (string of length 64 of the base16 hash). Got: ${JSON.stringify(
              src.metadata
            )}`,
            value: src,
            fixes: ["image:add-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    return {
      [path]: [
        {
          message: `Could not validate Image metadata.`, // These validation errors will have to be picked up by logic outside of this package and revalidated. Reasons: 1) we have to read files to verify the metadata, which is handled differently in different runtimes (Browser, QuickJS, Node.js); 2) we want to keep this package dependency free.
          value: src,
          fixes: ["image:check-metadata"],
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

  optional(): Schema<Src | null> {
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

export const image = (
  options?: ImageOptions
): Schema<FileSource<ImageMetadata>> => {
  return new ImageSchema(options);
};

export const convertImageSource = (
  src: FileSource<ImageMetadata>
): { url: string; metadata?: ImageMetadata } => {
  // TODO: /public should be configurable
  return {
    url:
      src[FILE_REF_PROP].slice("/public".length) +
      `?sha256=${src.metadata?.sha256}`,
    metadata: src.metadata,
  };
};
