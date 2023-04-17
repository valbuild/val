export type SourceObject = { readonly [key: string]: Source };
export type SourcePrimitive = string | number | boolean | null;

declare const brand: unique symbol;

export type FileSource<Ref extends string> = {
  readonly ref: Ref;
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
