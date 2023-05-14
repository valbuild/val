import { Json, JsonPrimitive } from "./Json";

export type Source =
  | SourcePrimitive
  | SourceObject
  | SourceArray
  | I18nSource<readonly string[], I18nCompatibleSource>
  | RemoteSource<RemoteCompatibleSource>
  | FileSource<string>;

/**
 * Remote must be serializable to a Val.
 */
export type RemoteCompatibleSource = Json;

/**
 * I18n sources cannot have nested remote sources.
 */
export type I18nCompatibleSource =
  | SourcePrimitive
  | I18nObject
  | I18nArray
  | FileSource<string>;
export type I18nObject = { [key in string]: I18nCompatibleSource };
export type I18nArray = readonly I18nCompatibleSource[];

export type SourceObject = { [key in string]: Source } & {
  // TODO: update these restricted parameters:
  fold?: never;
  andThen?: never;
  _ref?: never;
  _type?: never;
  val?: never;
  valPath?: never;
};
export type SourceArray = readonly Source[];
export type SourcePrimitive = JsonPrimitive;

/* Val specific types: file, remote, i18n  */
declare const brand: unique symbol;

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
  readonly [brand]: "ValFileSource";
};

export const REMOTE_REF_PROP = "_ref" as const; // TODO: same as FILE_REF_PROP so use same prop?

export type RemoteRef = string & { readonly [brand]: "RemoteRef" };
/**
 * A remote source is a hash that represents a remote object.
 *
 * It will be resolved into a ValRemote object.
 */
export type RemoteSource<Src extends RemoteCompatibleSource> = {
  readonly [REMOTE_REF_PROP]: RemoteRef;
  readonly _todo: Src; // TODO
  readonly _type: "remote"; // TODO: figure out if this is ok
  readonly [brand]: "ValRemoteSource";
};

export function remote<Src extends RemoteCompatibleSource>(
  ref: string
): RemoteSource<Src> {
  throw Error("Not implemented");
}

/**
 * An i18n source is a map of locales to sources.
 *
 * Its selector will default to the underlying source. It is possible to call `.all` on i18n sources, which returns an object with all the locales
 *
 */
export type I18nSource<
  Locales extends readonly string[],
  T extends I18nCompatibleSource
> = {
  readonly [locale in Locales[number]]: T;
} & {
  readonly [brand]: "I18nSource";
};
