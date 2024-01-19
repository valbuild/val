import { VAL_EXTENSION } from ".";
import { Json } from "../Json";

export const FILE_REF_PROP = "_ref" as const;
export const FILE_REF_SUBTYPE_TAG = "_tag" as const;

export type FileMetadata = { readonly [key: string]: Json };

/**
 * A file source represents the path to a (local) file.
 *
 * It will be resolved into a Asset object.
 *
 */
export type FileSource<
  Metadata extends FileMetadata | undefined = FileMetadata | undefined
> = {
  readonly [FILE_REF_PROP]: string;
  readonly [VAL_EXTENSION]: "file";
  readonly metadata?: Metadata;
};

export function file<Metadata extends { readonly [key: string]: Json }>(
  ref: `/public/${string}`,
  metadata: Metadata
): FileSource<Metadata>;
export function file(
  ref: `/public/${string}`,
  metadata?: undefined
): FileSource<undefined>;
export function file<
  Metadata extends { readonly [key: string]: Json } | undefined
>(ref: `/public/${string}`, metadata?: Metadata): FileSource<Metadata> {
  return {
    [FILE_REF_PROP]: ref,
    [VAL_EXTENSION]: "file",
    metadata,
  } as FileSource<Metadata>;
}

export function isFile(obj: unknown): obj is FileSource {
  return (
    typeof obj === "object" &&
    obj !== null &&
    VAL_EXTENSION in obj &&
    obj[VAL_EXTENSION] === "file" &&
    FILE_REF_PROP in obj &&
    typeof obj[FILE_REF_PROP] === "string"
  );
}
