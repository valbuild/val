export type SourceObject = { readonly [key: string]: Source };
export type SourcePrimitive = string | number | boolean | null;

declare const brand: unique symbol;

export const FILE_REF_PROP = "ref" as const;
export type FileSource<Ref extends string> = {
  readonly [FILE_REF_PROP]: Ref;
  readonly type: "file";
  readonly [brand]: "ValFileSource";
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
