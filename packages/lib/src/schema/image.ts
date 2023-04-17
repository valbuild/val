import { OptIn, OptOut, Schema } from "./Schema";
import * as path from "path";
import { FileSource } from "../Source";

/**
 * Common image types supported by the browser
 * https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types
 *
 * Currently this is what we support.
 */
export const ImageExtensions = [
  // "apng",
  // "avif",
  "gif",
  "jpg",
  "jpeg",
  // "jfif",
  // "pjpeg",
  // "pjp",
  "png",
  "svg",
  "webp",
  // "bmp",
  // "ico",
  // "cur",
  // "tif",
  // "tiff",
] as const;
export type ImageExtensions = (typeof ImageExtensions)[number];

export type ImageOptions = {
  extensions: ImageExtensions[];
  staticFilesFolder?: string;
};

export type SerializedImageSchema = {
  type: "image";
  options?: ImageOptions;
  opt: boolean;
};

/**
 *
 * TODO:
 * @deprecated name might change
 */
export type ValImage = {
  url: string;
};

const DEFAULT_STATIC_FILES_FOLDER = "/public";

export class ImageSchema<Opt extends boolean> extends Schema<
  OptIn<FileSource<string>, Opt>,
  OptOut<ValImage, Opt>
> {
  private readonly staticFilesFolder;

  constructor(
    private readonly options: ImageOptions | undefined,
    public readonly opt: Opt
  ) {
    super(opt);
    this.staticFilesFolder =
      this.options?.staticFilesFolder || DEFAULT_STATIC_FILES_FOLDER;
  }

  protected validate(src: OptIn<FileSource<string>, Opt>): false | string[] {
    if (!this.opt) {
      if (src === null) return ["Required image cannot be null"];
    }
    if (
      src &&
      this.options?.extensions &&
      (this.options.extensions as string[]).includes(path.extname(src.ref))
    ) {
      return [
        `Found image extension: ${path.extname(
          src.ref
        )} which is not supported. Supported image extensions are: ${this.options.extensions.join(
          ", "
        )}`,
      ];
    }
    if (src && !src.ref.startsWith(this.staticFilesFolder)) {
      return [
        `Image path: ${src.ref} is not in the static files folder: ${this.staticFilesFolder}`,
      ];
    }
    return false;
  }

  hasI18n(): false {
    return false;
  }

  protected localize(
    src: OptIn<FileSource<string>, Opt>
  ): OptOut<{ url: string }, Opt> {
    if (src === null) {
      if (!this.opt) throw Error("Required object cannot be null");
      return null as OptOut<{ url: string }, Opt>;
    }
    return {
      url: src.ref.slice(this.staticFilesFolder.length, src.ref.length),
    };
  }

  protected delocalizePath(
    _src: OptIn<FileSource<string>, Opt>,
    localPath: string[]
  ): string[] {
    if (localPath.length !== 0) {
      throw Error("Invalid path: Cannot access property of image");
    }
    return localPath;
  }

  serialize(): SerializedImageSchema {
    return {
      type: "image",
      options: this.options,
      opt: this.opt,
    };
  }

  optional(): ImageSchema<true> {
    if (this.opt) console.warn("Schema is already optional");
    return new ImageSchema(this.options, true);
  }

  static deserialize(schema: SerializedImageSchema): ImageSchema<boolean> {
    return new ImageSchema(schema.options, schema.opt);
  }
}
export const image = (options?: ImageOptions): ImageSchema<false> => {
  return new ImageSchema(options, false);
};
