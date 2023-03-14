import { SourceObject, Source, ValProps } from "./Source";

export type ValString = ValProps<string>;

export type ValObject<T extends SourceObject> = {
  [key in keyof T]: Val<T[key]>;
} & ValProps<T>;

export type Val<T extends Source> = T extends string
  ? ValString
  : T extends (infer T extends Source)[] // FIXME: infer T extends is only supported from 4.9+
  ? Val<T>[]
  : T extends SourceObject
  ? ValObject<T>
  : never;
