export type SourceObject = { [key: string]: Source };
export type SourcePrimitive = string | number | null;
export type Source = SourcePrimitive | SourceObject | Source[];
