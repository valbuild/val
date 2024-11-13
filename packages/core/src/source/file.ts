import { VAL_EXTENSION } from ".";
import { ValConfig } from "../initVal";
import { Json } from "../Json";

export const FILE_REF_PROP = "_ref" as const;
export const FILE_REF_SUBTYPE_TAG = "_tag" as const; // TODO: used earlier by c.rt.image, when we remove c.rt we can remove this

export type FileMetadata = { readonly [key: string]: Json };

/**
 * A file source represents the path to a (local) file.
 *
 * It will be resolved into a Asset object.
 *
 */
export type FileSource<
  Metadata extends FileMetadata | undefined = FileMetadata | undefined,
> = {
  readonly [FILE_REF_PROP]: string;
  readonly [VAL_EXTENSION]: "file";
  readonly [FILE_REF_SUBTYPE_TAG]?: string;
  readonly metadata?: Metadata;
  readonly patch_id?: string;
};

export const initFile = (config?: ValConfig) => {
  const fileDirectory = config?.files?.directory ?? "/public/val";

  type FileDirectory = typeof fileDirectory;

  function file<Metadata extends { readonly [key: string]: Json }>(
    ref: `${FileDirectory}/${string}`,
    metadata: Metadata,
  ): FileSource<Metadata>;

  function file(
    ref: `${FileDirectory}/${string}`,
    metadata?: undefined,
  ): FileSource<undefined>;

  function file<Metadata extends { readonly [key: string]: Json } | undefined>(
    ref: `${FileDirectory}/${string}`,
    metadata?: Metadata,
  ): FileSource<Metadata> {
    return {
      [FILE_REF_PROP]: ref,
      [VAL_EXTENSION]: "file",
      metadata,
    } as FileSource<Metadata>;
  }

  return file;
};

// type Directory =
//   | (typeof config extends { files: { directory: infer D } } ? D : never)
//   | `/public/val`;
// console.log("path", config);
// const userSpecifiedDirectory: Directory = config ?? "/public/val";

// const directory = userSpecifiedDirectory;

// export function file<Metadata extends { readonly [key: string]: Json }>(
//   ref: `${typeof directory}/${string}`,
//   metadata: Metadata
// ): FileSource<Metadata>;
// export function file(
//   ref: `${typeof directory}/${string}`,
//   metadata?: undefined
// ): FileSource<undefined>;
// export function file<
//   Metadata extends { readonly [key: string]: Json } | undefined
// >(
//   ref: `${typeof directory}/${string}`,
//   metadata?: Metadata
// ): FileSource<Metadata> {
//   return {
//     [FILE_REF_PROP]: ref,
//     [VAL_EXTENSION]: "file",
//     metadata,
//   } as FileSource<Metadata>;
// }

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
