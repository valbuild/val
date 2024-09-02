import { ImageMetadata } from "../schema/image";
import { FileSource } from "./file";

/**
 * A image source represents the path to a (local) image.
 *
 */
export type ImageSource<
  Metadata extends ImageMetadata | undefined = ImageMetadata,
> = FileSource<Metadata>;
