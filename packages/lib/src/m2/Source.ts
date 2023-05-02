import { Schema } from "./schema";

export type Source =
  | SourcePrimitive
  | SourceObject
  | SourceArray
  | I18nSource<
      string,
      SourcePrimitive | SourceObject | SourceArray | FileSource<string>
    >
  | RemoteSource<
      | SourcePrimitive
      | SourceObject
      | SourceArray
      | FileSource<string>
      | I18nSource<
          string,
          SourcePrimitive | SourceObject | SourceArray | FileSource<string>
        >
    >
  | FileSource<string>;

export type SourceObject = { [key in string]: Source } & {
  match?: never;
  andThen?: never;
};
export type SourceArray = Source[];
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

/**
 * A remote source is a hash that represents a remote object.
 *
 * It will be resolved into a ValRemote object.
 */
export type RemoteSource<Src extends Source> = {
  readonly [REMOTE_REF_PROP]: Schema<Src>;
  readonly [brand]: "ValRemoteSource";
};

/**
 * An i18n source is a map of locales to sources.
 *
 * Its selector will automatically be the underlying source.
 *
 */
export type I18nSource<
  Locales extends string,
  T extends
    | SourcePrimitive
    | SourceObject
    | SourceArray
    | FileSource<string>
    | RemoteSource<Source>
> = {
  readonly [locale in Locales]: T;
} & {
  readonly [brand]: "I18nDescriptor";
};
