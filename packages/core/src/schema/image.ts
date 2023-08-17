/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { FileSource, FILE_REF_PROP } from "../source/file";
import { ValidationError } from "./validation/ValidationError";

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

  validate(src: Src): ValidationError {
    throw new Error("Method not implemented.");
  }

  assert(src: Src): boolean {
    // TODO:
    return true;
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
