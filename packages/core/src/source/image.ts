import { VAL_EXTENSION } from ".";
import { ValConfig } from "../initVal";
import { ImageMetadata } from "../schema/image";
import { FILE_REF_PROP, FILE_REF_SUBTYPE_TAG } from "./file";

/**
 * A image source represents the path to a (local) image.
 *
 */
export type ImageSource<
  Metadata extends ImageMetadata | undefined = ImageMetadata | undefined,
> = {
  readonly [FILE_REF_PROP]: string;
  readonly [VAL_EXTENSION]: "file";
  readonly [FILE_REF_SUBTYPE_TAG]: "image";
  readonly metadata?: Metadata;
  readonly patch_id?: string;
};

export const initImage = (config?: ValConfig) => {
  const fileDirectory = config?.files?.directory ?? "/public/val";

  type FileDirectory = typeof fileDirectory;

  /**
   * Define the source of an image file.
   *
   * @example
   * c.image("/public/val/example.png", {
   *   width: 944,
   *   height: 944,
   *   mimeType: "image/png",
   *})
   *
   * @param ref /public/val/example.png
   * @param metadata Image metadata: width, height, mimeType and optionally a hotspot.
   */
  function image(
    ref: `${FileDirectory}/${string}`,
    metadata: ImageMetadata,
  ): ImageSource<ImageMetadata>;

  /**
   * Define the source of an image file.
   *
   * NOTE: this will **not** validate since metadata has not been defined.
   *
   * Run `npx -p @valbuild/cli val validate --fix` to automatically add metadata.
   *
   * @example
   * c.image("/public/val/example.png")
   *
   * @param ref /public/val/example.png
   * @param metadata Image metadata: width, height, mimeType and optionally a hotspot.
   */
  function image(
    ref: `${FileDirectory}/${string}`,
    metadata?: undefined,
  ): ImageSource<undefined>;

  /**
   * Define the source of an image file.
   *
   * @example
   * c.image("/public/val/example.png", {
   *   width: 944,
   *   height: 944,
   *   mimeType: "image/png",
   *})
   *
   * @param ref /public/val/example.png
   * @param metadata Image metadata: width, height, mimeType and optionally a hotspot.
   */
  function image<Metadata extends ImageMetadata | undefined>(
    ref: `${FileDirectory}/${string}`,
    metadata?: ImageMetadata,
  ): ImageSource<Metadata> {
    return {
      [FILE_REF_PROP]: ref,
      [VAL_EXTENSION]: "file",
      [FILE_REF_SUBTYPE_TAG]: "image",
      metadata,
    } as ImageSource<Metadata>;
  }

  return image;
};
