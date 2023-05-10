import { Schema } from "./schema";

export type Source =
  | SourcePrimitive
  | SourceObject
  | SourceTuple
  | I18nSource<
      string,
      SourcePrimitive | SourceObject | SourceTuple | FileSource<string>
    >
  | RemoteSource<
      | SourcePrimitive
      | SourceObject
      | SourceTuple
      | FileSource<string>
      | I18nSource<
          string,
          SourcePrimitive | SourceObject | SourceTuple | FileSource<string>
        >
    >
  | FileSource<string>;

export type SourceObject = { [key in string]: Source } & {
  // TODO: update these restricted parameters:
  match?: never;
  andThen?: never;
  _ref?: never;
  _type?: never;
  val?: never;
  valPath?: never;
};
export type SourceTuple = readonly Source[];
export type SourcePrimitive = string | number | boolean | undefined;

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
export type RemoteSource<
  Src extends
    | SourcePrimitive
    | SourceObject
    | SourceTuple
    | FileSource<string>
    | I18nSource<
        string,
        SourcePrimitive | SourceObject | SourceTuple | FileSource<string>
      >
> = {
  readonly [REMOTE_REF_PROP]: RemoteRef;
  readonly _schema: Schema<Src>; // TODO: figure out if this is ok
  readonly _type: "remote"; // TODO: figure out if this is ok
  readonly [brand]: "ValRemoteSource";
};

/**
 * An i18n source is a map of locales to sources.
 *
 * Its selector will default to the underlying source. It is possible to call `.all` on i18n sources, which returns an object with all the locales
 *
 */
export type I18nSource<
  Locales extends string,
  T extends SourcePrimitive | SourceObject | SourceTuple | FileSource<string>
> = {
  readonly [locale in Locales]: T;
} & {
  readonly [brand]: "I18nDescriptor";
};
