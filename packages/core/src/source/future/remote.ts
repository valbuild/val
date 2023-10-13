import { SourcePrimitive, VAL_EXTENSION, PhantomType } from "..";
import { FileSource } from "../file";
import { I18nCompatibleSource, I18nSource } from "./i18n";
import { AnyRichTextOptions, RichTextSource } from "../richtext";

/**
 * Remote sources cannot include other remote sources.
 */
export type RemoteCompatibleSource =
  | SourcePrimitive
  | RemoteObject
  | RemoteArray
  | RichTextSource<AnyRichTextOptions>
  | FileSource
  | I18nSource<string[], I18nCompatibleSource>;
export type RemoteObject = { [key in string]: RemoteCompatibleSource };
export type RemoteArray = readonly RemoteCompatibleSource[];

export const REMOTE_REF_PROP = "_ref" as const; // TODO: same as FILE_REF_PROP so use same prop?

declare const brand: unique symbol;
export type RemoteRef = string & { readonly [brand]: "RemoteRef" };

/**
 * A remote source is a hash that represents a remote object.
 *
 * It will be resolved into a ValRemote object.
 */
export type RemoteSource<Src extends RemoteCompatibleSource> = {
  readonly [REMOTE_REF_PROP]: RemoteRef;
  readonly [VAL_EXTENSION]: "remote";
} & PhantomType<Src>;

export function remote<Src extends RemoteCompatibleSource>(
  ref: string
): RemoteSource<Src> {
  return {
    [REMOTE_REF_PROP]: ref as RemoteRef,
    [VAL_EXTENSION]: "remote",
  } as RemoteSource<Src>;
}

export function isRemote(
  obj: unknown
): obj is RemoteSource<RemoteCompatibleSource> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    VAL_EXTENSION in obj &&
    obj[VAL_EXTENSION] === "remote" &&
    REMOTE_REF_PROP in obj &&
    typeof obj[REMOTE_REF_PROP] === "string"
  );
}
