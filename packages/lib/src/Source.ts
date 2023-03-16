export type SourceObject = { [key: string]: Source };
export type SourcePrimitive = string | number;
export type Source = SourcePrimitive | SourceObject | Source[];
