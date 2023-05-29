import { VAL_EXTENSION } from ".";

export const FILE_REF_PROP = "_ref" as const;

/**
 * A file source represents the path to a (local) file.
 *
 * It will be resolved into a Asset object.
 *
 */
export type FileSource = {
  readonly [FILE_REF_PROP]: string;
  readonly [VAL_EXTENSION]: "file";
};

type FileInDirectory<Dir extends string, Path extends string> = `${Dir}${Path}`;

export function file<Dir extends string, Path extends string = string>(
  ref: FileInDirectory<Dir, Path>
): FileSource {
  return {
    [FILE_REF_PROP]: ref,
    [VAL_EXTENSION]: "file",
  } as FileSource;
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
