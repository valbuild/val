import { ValExtension } from ".";

export const FILE_REF_PROP = "_ref" as const;

/**
 * A file source represents the path to a (local) file.
 *
 * It will be resolved into a Asset object.
 *
 * The reference must point to a file that is in a 'public' directory (which is overridable),
 * where the url is the reference without the 'public' directory prefix.
 *
 */
export type FileSource<Ref extends string> = {
  readonly [FILE_REF_PROP]: Ref;
  readonly [ValExtension]: "file";
};

export const REMOTE_REF_PROP = "_ref" as const; // TODO: same as FILE_REF_PROP so use same prop?

export function file<F extends string>(ref: F): FileSource<F> {
  return {
    [FILE_REF_PROP]: ref,
    [ValExtension]: "file",
  } as FileSource<F>;
}

export function isFile(obj: unknown): obj is FileSource<string> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    ValExtension in obj &&
    obj[ValExtension] === "file" &&
    FILE_REF_PROP in obj &&
    typeof obj[FILE_REF_PROP] === "string"
  );
}
