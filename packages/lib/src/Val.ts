import { ValidObject, ValidTypes } from "./ValidTypes";

export type ValString = {
  val: string;
  id: string;
};

export type ValObject<T extends ValidObject> = {
  [key in keyof T]: Val<T[key]>;
};

export type Val<T extends ValidTypes> = T extends string
  ? ValString
  : T extends ValidObject
  ? ValObject<T>
  : never;
