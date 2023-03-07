export type SourceObject = { [key: string]: Source };
export type SourcePrimitive = string;
export type Source = SourcePrimitive | SourceObject | Source[];
