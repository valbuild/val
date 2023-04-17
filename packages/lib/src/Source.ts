import { FileSrc } from "./file";

export type SourceObject = { readonly [key: string]: Source };
export type SourcePrimitive = string | number | boolean | null;
export type Source =
  | SourcePrimitive
  | SourceObject
  | readonly Source[]
  | FileSrc<string>;

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
