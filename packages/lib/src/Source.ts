export type SourceObject = { readonly [key: string]: Source };
export type SourcePrimitive = string | number | boolean | null;

declare const brand: unique symbol;

export const FILE_REF_PROP = "ref" as const;
export type FileSource<Ref extends string> = {
  readonly [FILE_REF_PROP]: Ref;
  readonly type: "file"; // TODO: type is a very common property name, does that matter here?
  readonly [brand]: "ValFileSource";
};

export const REMOTE_REF_PROP = "ref" as const; // TODO: same as FILE_REF_PROP so use same prop?
export type RemoteSource<Ref extends string> = {
  readonly [REMOTE_REF_PROP]: Ref;
  readonly type: "remote"; // TODO: type is a very common property name, does that matter here?
  readonly [brand]: "ValRemoteSource";
};

export type Source =
  | SourcePrimitive
  | SourceObject
  | readonly Source[]
  | FileSource<string>;

type ToReadonlySourceArray<T extends readonly Source[]> = {
  readonly [P in keyof T]: AsReadonlySource<T[P]>;
};
export type AsReadonlySource<T extends Source> = Source extends T
  ? Source
  : T extends SourceObject
  ? { readonly [P in keyof T]: AsReadonlySource<T[P]> }
  : T extends readonly Source[]
  ? ToReadonlySourceArray<T>
  : T;
