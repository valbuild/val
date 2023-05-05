import { Source } from "../Source";
import { Val as UnknownVal } from ".";

export type Val<T extends readonly Source[]> = {
  readonly [key in keyof T]: UnknownVal<T[key]>;
} & {
  readonly valPath: string;
  readonly val: T;
};
