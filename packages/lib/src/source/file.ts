import { VAL_EXTENSION } from ".";

export const FILE_REF_PROP = "_ref" as const;

/**
 * A file source represents the path to a (local) file.
 *
 * It will be resolved into a Asset object.
 *
 */
export type FileSource<
  Metadata extends { readonly [key: string]: unknown } | undefined =
    | { readonly [key: string]: unknown }
    | undefined
> = {
  readonly [FILE_REF_PROP]: string;
  readonly [VAL_EXTENSION]: "file";
  readonly metadata?: Metadata;
};

export function file<Metadata extends { readonly [key: string]: unknown }>(
  ref: string,
  metadata: Metadata
): FileSource<Metadata>;
export function file(ref: string, metadata?: undefined): FileSource<undefined>;
export function file<
  Metadata extends { readonly [key: string]: unknown } | undefined
>(ref: string, metadata?: Metadata): FileSource<Metadata> {
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
