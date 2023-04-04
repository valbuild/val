export type SourceObject = { readonly [key: string]: Source };
export type SourcePrimitive = string | number | boolean | null;
export type Source = SourcePrimitive | SourceObject | readonly Source[];
