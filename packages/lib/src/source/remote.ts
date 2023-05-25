import { SourcePrimitive, ValExtension, PhantomType } from ".";
import { FileSource } from "./file";
import { I18nCompatibleSource, I18nSource } from "./i18n";

/**
 * Remote sources cannot include other remote sources.
 */
export type RemoteCompatibleSource =
  | SourcePrimitive
  | RemoteObject
  | RemoteArray
  | FileSource<string>
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
  readonly [ValExtension]: "remote";
} & PhantomType<Src>;

export function remote<Src extends RemoteCompatibleSource>(
  ref: string
): RemoteSource<Src> {
  return {
    [REMOTE_REF_PROP]: ref as RemoteRef,
    [ValExtension]: "remote",
  } as RemoteSource<Src>;
}

export function isRemote(
  obj: unknown
): obj is RemoteSource<RemoteCompatibleSource> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    ValExtension in obj &&
    obj[ValExtension] === "remote" &&
    REMOTE_REF_PROP in obj &&
    typeof obj[REMOTE_REF_PROP] === "string"
  );
}
