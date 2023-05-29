/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { FileSource, FILE_REF_PROP } from "../source/file";
import { SourcePath } from "../val";

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

export class ImageSchema<Src extends FileSource | null> extends Schema<Src> {
  constructor(readonly options?: ImageOptions, readonly opt: boolean = false) {
    super();
  }

  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
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

export const image = (options?: ImageOptions): Schema<FileSource> => {
  return new ImageSchema(options);
};

export const convertImageSource = (src: FileSource): { url: string } => {
  // TODO: /public should be configurable
  return { url: src[FILE_REF_PROP].slice("/public".length) };
};
