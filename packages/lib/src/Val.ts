import { ValidObject, ValidTypes, ValProps } from "./ValidTypes";

export type ValString = ValProps<string>;

export type ValObject<T extends ValidObject> = {
  [key in keyof T]: Val<T[key]>;
} & ValProps<T>;

export type Val<T extends ValidTypes> = T extends string
  ? ValString
  : T extends (infer T extends ValidTypes)[] // FIXME: infer T extends is only supported from 4.9+
  ? Val<T>[]
  : T extends ValidObject
  ? ValObject<T>
  : never;
